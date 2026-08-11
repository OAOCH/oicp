/**
 * Invariantes de INTEGRIDAD DE DATOS. Es la auditoría de datos convertida en pruebas: en vez
 * de comprobar los números una vez a mano, se fijan las propiedades que SIEMPRE deben
 * cumplirse y el CI las verifica en cada push.
 *
 * Cada invariante corresponde a algo que un auditor de datos comprobaría:
 *   - Lógica de agregación: ¿los subtotales suman el total?
 *   - Consistencia derivada: ¿el nivel de riesgo corresponde al score?
 *   - Sincronía de agregados: ¿a_* dice lo mismo que `procedures`? (regla 5)
 *   - Rangos y magnitudes: ¿hay scores fuera de 0-100, montos negativos, años imposibles?
 *   - Nulos: ¿los campos que la interfaz asume presentes lo están?
 *   - Definición única de monto: ¿MONTO_SQL y montoPlausible() dan lo mismo? (regla 11)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'oicp-integridad-'));
process.env.DB_PATH = path.join(TMP, 'integridad.db');
process.env.JWT_SECRET = '';

const { migrate, getDb, upsertProcedure, rebuildConcentrationIndex, MONTO_SQL } = await import('./db.js');
const { buildAnalytics, callTool } = await import('./mcp-server.js');
const { evaluateAllFlags, getRiskLevel, getInfimaThreshold } = await import('./flag-engine.js');
const { reflagChanged, buildConcentrationContext } = await import('./updater.js');

// Conjunto de datos de prueba deliberadamente HOSTIL: incluye los casos sucios que la fuente
// del SERCOP produce de verdad y que la plataforma tiene que sobrevivir.
const N = 400;
test('preparación: base con los casos sucios que produce la fuente real', () => {
  migrate();
  for (let i = 0; i < N; i++) {
    const anio = 2019 + (i % 8);
    const award = i % 37 === 0 ? 0 : 500 + i * 137;          // algunos sin monto adjudicado
    upsertProcedure({
      id: `p${String(i).padStart(4, '0')}`, ocid: `ocds-x-${i}`,
      title: i % 11 === 0 ? '' : `Proceso ${i}`,              // títulos vacíos
      description: i % 13 === 0 ? '' : `Objeto del proceso ${i} con texto suficiente`,
      status: ['complete', 'award', 'contract', 'active', 'cancelled'][i % 5],
      procurement_method: i % 3 === 0 ? 'direct' : 'open',
      procurement_method_details: ['Menor Cuantía', 'Subasta Inversa Electronica',
        'Catálogo electrónico - Compra directa', 'Régimen Especial'][i % 4],
      buyer_id: `EC-RUC-9999999990${i % 12}`, buyer_name: `ENTIDAD ${i % 12}`,
      budget_amount: award ? award * 1.02 : 0,
      award_amount: award,
      // Monto de contrato absurdo en algunos (la fuente publica ~210 casos así).
      contract_amount: i % 53 === 0 ? award * 900 : award,
      final_amount: null,
      published_date: `${anio}-0${(i % 9) + 1}-15T12:00:00-05:00`,
      submission_deadline: `${anio}-0${(i % 9) + 1}-18T12:00:00-05:00`,
      award_date: `${anio}-0${(i % 9) + 1}-19T12:00:00-05:00`,
      suppliers: i % 29 === 0
        ? [{ id: `EC-RUC-111111111${i % 5}`, name: `PROV ${i % 5}` }, { id: `EC-RUC-222222222${i % 3}`, name: `CONSORCIO ${i % 3}` }]
        : [{ id: `EC-RUC-111111111${i % 5}`, name: `PROV ${i % 5}` }],
      number_of_tenderers: i % 7 === 0 ? 1 : 3,
      flags: [], score: 0, risk_level: 'low',
      source_year: anio, regime: anio >= 2026 ? 'LOSNCP_REFORMADA' : 'LOSNCP_COEFICIENTES',
    });
  }
  assert.equal((getDb().prepare('SELECT COUNT(*) AS n FROM procedures').get() as any).n, N);
  rebuildConcentrationIndex();
  buildAnalytics(getDb());
});

test('preparación: reflag completo con el motor real', async () => {
  const cambiados = await reflagChanged(getDb());
  assert.ok(cambiados > 0, 'el reflag debe haber marcado procesos');
  buildAnalytics(getDb());   // los agregados se reconstruyen tras el reflag
});

// ── Lógica de agregación: los subtotales tienen que sumar el total ──
test('los niveles de riesgo suman el total de procesos', () => {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) AS n FROM procedures').get() as any).n;
  const porNivel = db.prepare(
    `SELECT SUM(n) AS n FROM a_risk_year`).get() as any;
  assert.equal(porNivel.n, total, 'a_risk_year debe cubrir todos los procesos, sin huecos ni duplicados');
});

test('los años suman el total y no hay años imposibles', () => {
  const db = getDb();
  const filas = db.prepare(`SELECT year, SUM(n) AS n FROM a_risk_year GROUP BY year`).all() as any[];
  const total = filas.reduce((s, f) => s + f.n, 0);
  assert.equal(total, N);
  for (const f of filas) {
    assert.ok(f.year >= 2019 && f.year <= 2100, `año fuera de rango: ${f.year}`);
  }
});

// ── Consistencia derivada: el nivel de riesgo TIENE que salir del score ──
test('risk_level corresponde siempre al corte del score (0 discrepancias)', () => {
  const db = getDb();
  const filas = db.prepare(`SELECT id, score, risk_level FROM procedures`).all() as any[];
  const malos = filas.filter(f => getRiskLevel(f.score) !== f.risk_level);
  assert.deepEqual(malos, [], `hay ${malos.length} procesos cuyo nivel no corresponde a su score`);
});

test('ningún score sale del rango 0-100', () => {
  const db = getDb();
  const fuera = db.prepare(
    `SELECT id, score FROM procedures WHERE score < 0 OR score > 100`).all() as any[];
  assert.deepEqual(fuera, []);
});

// ── Sincronía de agregados con procedures (regla 5) ──
test('a_flag_year coincide EXACTAMENTE con las banderas guardadas en procedures', () => {
  const db = getDb();
  const enAgregado = new Map<string, number>();
  for (const r of db.prepare(`SELECT code, SUM(n) AS n FROM a_flag_year GROUP BY code`).all() as any[]) {
    enAgregado.set(r.code, r.n);
  }
  const enProcedures = new Map<string, number>();
  for (const r of db.prepare(`SELECT flags FROM procedures`).all() as any[]) {
    for (const f of JSON.parse(r.flags || '[]')) {
      if (f.active) enProcedures.set(f.code, (enProcedures.get(f.code) || 0) + 1);
    }
  }
  for (const [code, n] of enProcedures) {
    assert.equal(enAgregado.get(code), n,
      `${code}: procedures dice ${n} y a_flag_year dice ${enAgregado.get(code)}. Los agregados están desincronizados (regla 5) y el MCP entregaría cifras distintas de la web.`);
  }
  for (const [code, n] of enAgregado) {
    assert.equal(enProcedures.get(code) || 0, n, `${code} sobra en a_flag_year`);
  }
});

test('a_suppliers coincide con el conteo real por proveedor', () => {
  const db = getDb();
  for (const s of db.prepare(`SELECT ruc10, n_procs, total_usd FROM a_suppliers`).all() as any[]) {
    const real = db.prepare(`
      SELECT COUNT(*) AS n, ROUND(SUM(${MONTO_SQL}), 2) AS total FROM procedures
      WHERE EXISTS (SELECT 1 FROM json_each(suppliers) j
                    WHERE json_extract(j.value, '$.id') LIKE '%' || ? || '%')`).get(s.ruc10) as any;
    assert.equal(s.n_procs, real.n, `a_suppliers.n_procs difiere del real para ${s.ruc10}`);
    assert.ok(Math.abs((s.total_usd || 0) - (real.total || 0)) < 1,
      `a_suppliers.total_usd (${s.total_usd}) difiere de SUM(MONTO_SQL) (${real.total}) para ${s.ruc10}: la web y el MCP darían cifras distintas (regla 11)`);
  }
});

// ── Definición única de monto (regla 11) ──
test('MONTO_SQL y montoPlausible() dan el MISMO valor en todas las filas', () => {
  const db = getDb();
  const montoPlausible = (fa: any, ca: any, aa: any) => {
    const num = (x: any) => { const n = typeof x === 'number' ? x : parseFloat(x); return Number.isFinite(n) ? n : 0; };
    const f = num(fa), c = num(ca), a = num(aa);
    const m = f || c || a;
    if (a > 0 && m > a * 100) return a;
    if (m > 1e10) return a > 0 ? a : 0;
    return m;
  };
  const filas = db.prepare(
    `SELECT id, final_amount, contract_amount, award_amount, ${MONTO_SQL} AS sql_monto FROM procedures`).all() as any[];
  const discrepancias = filas.filter(f =>
    Math.abs(f.sql_monto - montoPlausible(f.final_amount, f.contract_amount, f.award_amount)) > 0.005);
  assert.deepEqual(discrepancias.map(d => d.id), [],
    'MONTO_SQL (web) y montoPlausible() (MCP/updater) tienen que coincidir en cada fila: si no, web y MCP publican cifras distintas');
});

test('la regla de plausibilidad descarta los montos absurdos de la fuente', () => {
  const db = getDb();
  // Se sembraron contratos 900x el adjudicado: el monto saneado NO puede tomarlos.
  const absurdos = db.prepare(`
    SELECT id, award_amount, contract_amount, ${MONTO_SQL} AS monto FROM procedures
    WHERE COALESCE(award_amount,0) > 0 AND contract_amount > award_amount * 100`).all() as any[];
  assert.ok(absurdos.length > 0, 'el conjunto de prueba debe incluir montos absurdos');
  for (const a of absurdos) {
    assert.equal(a.monto, a.award_amount,
      `el proceso ${a.id} tiene contrato ${a.contract_amount} contra adjudicado ${a.award_amount}: el monto publicado debe ser el adjudicado`);
  }
});

test('ningún monto publicado es negativo', () => {
  const db = getDb();
  const neg = db.prepare(`SELECT id FROM procedures WHERE ${MONTO_SQL} < 0`).all();
  assert.deepEqual(neg, []);
});

// ── Concentración: el share es del año y suma coherente ──
test('share_of_buyer está entre 0 y 100 y los pares de un año suman ~100%', () => {
  const db = getDb();
  const fuera = db.prepare(
    `SELECT buyer_id, year, share_of_buyer FROM concentration_index
     WHERE share_of_buyer < 0 OR share_of_buyer > 100.01`).all();
  assert.deepEqual(fuera, [], 'un share fuera de 0-100 significa que el divisor está mal');

  for (const g of db.prepare(`SELECT buyer_id, year, ROUND(SUM(share_of_buyer),1) AS s
     FROM concentration_index GROUP BY buyer_id, year`).all() as any[]) {
    assert.ok(Math.abs(g.s - 100) < 0.5,
      `los shares del comprador ${g.buyer_id} en ${g.year} suman ${g.s}%, no 100%`);
  }
});

test('el contexto de concentración indexa por AÑO y no mezcla años', () => {
  const db = getDb();
  const ctx = buildConcentrationContext(db);
  assert.ok(ctx.byPairYear.size > 0, 'debe haber contexto por par-año');
  assert.ok(ctx.byPair.size > 0, 'debe haber contexto histórico por par');
  // Toda clave de byPairYear termina en un año de 4 dígitos.
  for (const clave of ctx.byPairYear.keys()) {
    assert.match(clave, /\|(19|20)\d{2}$/, `clave sin año: ${clave}`);
  }
  // Cada entrada por año debe coincidir con su fila de concentration_index.
  for (const [clave, v] of ctx.byPairYear) {
    const i = clave.lastIndexOf('|');
    const anio = Number(clave.slice(i + 1));
    const par = clave.slice(0, i);
    const j = par.indexOf('|');
    const fila = db.prepare(`SELECT share_of_buyer FROM concentration_index
      WHERE buyer_id = ? AND supplier_id = ? AND year = ?`).get(par.slice(0, j), par.slice(j + 1), anio) as any;
    assert.ok(fila, `no existe fila para ${clave}`);
    assert.ok(Math.abs(fila.share_of_buyer - v.share_of_buyer) < 0.001,
      `el contexto de ${clave} trae ${v.share_of_buyer} y la tabla ${fila.share_of_buyer}: se está mezclando el share de otro año`);
  }
});

// ── Umbrales de ínfima cuantía: cifras legales, no aproximaciones ──
test('los umbrales de ínfima son los valores legales exactos por fecha', () => {
  const esperado: [string, number][] = [
    ['2019-06-15', 7105.88], ['2020-06-15', 7099.68], ['2021-06-15', 6416.07],
    ['2022-06-15', 6779.95], ['2023-06-15', 6300.57], ['2024-06-15', 6658.78],
    // 2025 tiene TRES tramos. Verificado contra norma el 2026-08-11: el salto a USD 10.000
    // ocurre el 7 de JULIO de 2025 por la Resolución R.E-SERCOP-2025-0152 (R.O. 5S 69 de
    // 27-jun-2025), no el 7 de octubre. La versión anterior situaba el salto en octubre y
    // dejaba tres meses de procesos evaluados con el umbral equivocado.
    ['2025-06-15', 7212.60], ['2025-07-06', 7212.60],
    ['2025-07-07', 10000.00], ['2025-08-15', 10000.00],
    ['2025-10-06', 10000.00], ['2025-10-07', 10000.00],
    ['2026-06-15', 10000.00],
  ];
  for (const [fecha, valor] of esperado) {
    assert.equal(getInfimaThreshold(fecha), valor, `umbral incorrecto para ${fecha}`);
  }
});

// ── IP-03 está muerta por la fuente: no debe aparecer nunca ──
test('IP-03 no dispara en ningún proceso (el SERCOP no publica enmiendas)', () => {
  const db = getDb();
  const con = db.prepare(`SELECT COUNT(*) AS n FROM procedures WHERE flags LIKE '%IP-03%'`).get() as any;
  assert.equal(con.n, 0, 'si IP-03 dispara, la fuente cambió y hay que revisar el aviso de "inactiva"');
});

// ── Nulos: lo que la interfaz asume presente ──
test('ningún proceso tiene flags, score o risk_level nulos', () => {
  const db = getDb();
  const malos = db.prepare(`SELECT id FROM procedures
    WHERE flags IS NULL OR score IS NULL OR risk_level IS NULL OR risk_level = ''`).all();
  assert.deepEqual(malos, [], 'la interfaz asume estos campos presentes en toda fila');
});

test('el JSON de flags y suppliers es parseable en todas las filas', () => {
  const db = getDb();
  const rotos: string[] = [];
  for (const r of db.prepare(`SELECT id, flags, suppliers FROM procedures`).all() as any[]) {
    try { JSON.parse(r.flags || '[]'); JSON.parse(r.suppliers || '[]'); }
    catch { rotos.push(r.id); }
  }
  assert.deepEqual(rotos, [], 'un JSON roto revienta la ficha del proceso y las consultas json_each');
});

// ── El score es reproducible: recomputar tiene que dar lo mismo ──
test('recomputar el score de cada proceso da el MISMO resultado (determinismo)', () => {
  const db = getDb();
  const ctx = buildConcentrationContext(db);
  const discrepancias: string[] = [];
  for (const r of db.prepare(`SELECT * FROM procedures`).all() as any[]) {
    const proc = { ...r, suppliers: JSON.parse(r.suppliers || '[]'),
      has_amendments: !!r.has_amendments, budget_amount: Number(r.budget_amount) || 0 };
    const { score, riskLevel } = evaluateAllFlags(proc, ctx);
    if (score !== r.score || riskLevel !== r.risk_level) discrepancias.push(r.id);
  }
  assert.deepEqual(discrepancias, [],
    'el motor tiene que ser determinista: si recomputar cambia el score, lo publicado no es reproducible por un auditor');
});

// ── La web y el MCP no pueden discrepar ──
test('web y MCP coinciden en el conteo y el monto de cada proveedor', () => {
  const db = getDb();
  for (const s of db.prepare(`SELECT ruc10 FROM a_suppliers LIMIT 10`).all() as any[]) {
    const mcp: any = callTool(db, 'oicp_supplier_profile', { query: s.ruc10 });
    assert.equal(mcp.error, undefined, `el MCP falló para ${s.ruc10}: ${mcp.error}`);
    const agg = db.prepare(`SELECT n_procs, total_usd FROM a_suppliers WHERE ruc10 = ?`).get(s.ruc10) as any;
    assert.equal(mcp.n_procs, agg.n_procs);
    assert.equal(Math.round(mcp.total_usd), Math.round(agg.total_usd));
  }
});

test('toda salida del MCP con banderas lleva el disclaimer (regla 7)', () => {
  const db = getDb();
  const conBanderas = ['oicp_flag_stats', 'oicp_methodology', 'oicp_top_suppliers', 'oicp_info'];
  for (const nombre of conBanderas) {
    const r: any = callTool(db, nombre, {});
    assert.ok(typeof r.disclaimer === 'string' && /NO constituyen evidencia/.test(r.disclaimer),
      `${nombre} no lleva el disclaimer: un flag no es un hallazgo`);
  }
});

test('limpieza', () => {
  try { getDb().close(); } catch { /* ya cerrada */ }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* Windows retiene handles */ }
});
