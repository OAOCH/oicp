/**
 * Test manual del updater (NO corre en CI: usa red real del SERCOP).
 * Crea una base de prueba con el subset 2025-2026 del scratch calibrado,
 * construye agregados y corre una actualización acotada (1 término, 3 min).
 *
 *   TEST_DB=C:\ruta\test.db SRC_DB=C:\ruta\scratch.db npx tsx server/updater.test-manual.ts
 */
const TEST_DB = process.env.TEST_DB || 'C:/Users/oscar/AppData/Local/Temp/oicp-test/test.db';
const SRC_DB = process.env.SRC_DB || 'C:/Users/oscar/oicp-work/scratch.db';

process.env.DB_PATH = TEST_DB;
process.env.AUTO_UPDATE = '0';

import { mkdirSync, existsSync, rmSync } from 'fs';
import { dirname } from 'path';

async function main() {
  mkdirSync(dirname(TEST_DB), { recursive: true });
  const fresh = !existsSync(TEST_DB);
  if (process.env.RESET === '1' && existsSync(TEST_DB)) { rmSync(TEST_DB); }

  const { migrate, getDb, rebuildConcentrationIndex } = await import('./db.js');
  const { buildAnalytics, analyticsReady } = await import('./mcp-server.js');
  const { runUpdate, updateJob, refreshDataCutoff, getDataCutoff } = await import('./updater.js');

  migrate();
  const db = getDb();
  const n0 = (db.prepare('SELECT COUNT(*) AS n FROM procedures').get() as any).n;
  if (n0 === 0) {
    console.log('Poblando base de prueba (subset 2025-2026 de scratch.db)…');
    db.exec(`ATTACH DATABASE '${SRC_DB.replace(/\\/g, '/')}' AS src`);
    const dstCols = new Set((db.prepare(`PRAGMA table_info(procedures)`).all() as any[]).map(c => c.name));
    const srcCols = (db.prepare(`PRAGMA src.table_info(procedures)`).all() as any[]).map(c => c.name).filter(c => dstCols.has(c));
    const cols = srcCols.map(c => `"${c}"`).join(',');
    db.exec(`INSERT INTO procedures (${cols}) SELECT ${cols} FROM src.procedures WHERE source_year >= 2025`);
    const dstC2 = new Set((db.prepare(`PRAGMA table_info(concentration_index)`).all() as any[]).map(c => c.name));
    const srcC2 = (db.prepare(`PRAGMA src.table_info(concentration_index)`).all() as any[]).map(c => c.name).filter(c => dstC2.has(c));
    const cols2 = srcC2.map(c => `"${c}"`).join(',');
    db.exec(`INSERT INTO concentration_index (${cols2}) SELECT ${cols2} FROM src.concentration_index WHERE year >= 2025`);
    db.exec(`DETACH DATABASE src`);
    db.pragma('wal_checkpoint(TRUNCATE)');
  }
  console.log('procesos base:', (db.prepare('SELECT COUNT(*) AS n FROM procedures').get() as any).n);

  if (!analyticsReady(db)) {
    console.log('Construyendo agregados a_* en la base de prueba…');
    console.log(buildAnalytics(db));
  }

  refreshDataCutoff();
  console.log('corte inicial:', getDataCutoff());

  const kick = await runUpdate({ year: 2026, budgetMin: 3, terms: ['agua'] });
  console.log('kick:', kick);
  while (updateJob.running) {
    await new Promise(r => setTimeout(r, 5000));
    console.log(`  [${updateJob.phase}] ${updateJob.progress} (search=${updateJob.searched} skip=${updateJob.skipped} err=${updateJob.errors.length})`);
  }
  console.log('\nRESULTADO:', JSON.stringify({
    inserted: updateJob.inserted, skipped: updateJob.skipped, reflagged: updateJob.reflagged,
    errors: updateJob.errors.slice(0, 5), progress: updateJob.progress,
  }, null, 1));

  // ── Consistencia agregados vs verdad ───────────────────────
  const y = 2026;
  const truth = (db.prepare(`SELECT COUNT(*) AS n FROM procedures WHERE source_year=?`).get(y) as any).n;
  const agg = (db.prepare(`SELECT SUM(n) AS n FROM a_risk_year WHERE year=?`).get(y) as any).n;
  console.log(`consistencia a_risk_year ${y}: procedures=${truth} agregado=${agg} ${truth === agg ? 'OK ✅' : 'MISMATCH ❌'}`);

  const t2 = db.prepare(`SELECT risk_level, COUNT(*) AS n FROM procedures WHERE source_year=? GROUP BY risk_level`).all(y) as any[];
  const a2 = db.prepare(`SELECT risk, n FROM a_risk_year WHERE year=?`).all(y) as any[];
  const mapT = Object.fromEntries(t2.map(r => [r.risk_level, r.n]));
  const mapA = Object.fromEntries(a2.map(r => [r.risk, r.n]));
  let ok = true;
  for (const k of new Set([...Object.keys(mapT), ...Object.keys(mapA)])) {
    const match = (mapT[k] || 0) === (mapA[k] || 0);
    ok &&= match;
    console.log(`  riesgo ${k}: procedures=${mapT[k] || 0} agregado=${mapA[k] || 0} ${match ? 'OK' : '❌'}`);
  }

  // spot-check de un proveedor insertado en esta corrida
  const nuevo = db.prepare(`SELECT id, suppliers FROM procedures WHERE source_year=2026
    AND published_date > '2026-05-14' AND suppliers != '[]' LIMIT 1`).get() as any;
  if (nuevo) {
    const r10 = (JSON.parse(nuevo.suppliers)[0].id.match(/\d{10}/) || [])[0];
    if (r10) {
      const nA = (db.prepare(`SELECT n_procs FROM a_suppliers WHERE ruc10=?`).get(r10) as any)?.n_procs;
      const nT = (db.prepare(`SELECT COUNT(*) AS n FROM procedures WHERE suppliers LIKE ?`).get(`%${r10}%`) as any).n;
      console.log(`spot proveedor ${r10}: a_suppliers=${nA} procedures=${nT} ${nA === nT ? 'OK ✅' : 'MISMATCH ❌'}`);
    }
  }
  console.log('corte final:', getDataCutoff());
  console.log(ok ? '\nTEST OK' : '\nTEST CON DIFERENCIAS');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
