/**
 * Actualizador incremental OICP — descarga de SERCOP los procesos nuevos del año
 * en curso, re-evalúa banderas y parcha los agregados a_* sin reconstruirlos.
 *
 * Diseño (lecciones del incidente 2026-07-10 y revisión adversarial 2026-07-11):
 *  - Barrido search_ocds del año: los ocid ya presentes se saltan sin pedir el record.
 *  - Agregados parchados POR LOTES durante el barrido (crash pierde ≤1 lote, no todo)
 *    + reconciliación de huérfanos al arrancar si la corrida anterior murió sucia.
 *  - Re-evaluación de banderas con iterate() (nunca .all(): 1.46M filas = ~4GB RSS),
 *    cediendo el event loop, y escribiendo fila+deltas en la MISMA transacción por lote.
 *  - WAL acotado con wal_checkpoint(TRUNCATE) entre lotes en toda ruta de escritura.
 *  - Conexión NUNCA cacheada a través de awaits (upload-db/restore la reemplazan).
 *  - Presupuesto de tiempo y cursor resumible {year, termIdx, page}.
 */
import cron from 'node-cron';
import type Database from 'better-sqlite3';
import { getDb, rebuildConcentrationIndex, upsertProcedure } from './db.js';
import { evaluateAllFlags, getRegime } from './flag-engine.js';
import { analyticsReady } from './mcp-server.js';
import { invalidateStatsCache } from './cache.js';

const SEARCH_API = 'https://datosabiertos.compraspublicas.gob.ec/PLATAFORMA/api/search_ocds';
const RECORD_API = 'https://datosabiertos.compraspublicas.gob.ec/PLATAFORMA/api/record';
const MAX_PAGES = 5000;
const FLUSH_EVERY = 500;

const TERMS = [
  'adquisición', 'servicio', 'construcción', 'consultoría',
  'contratación', 'provisión', 'suministro', 'mantenimiento',
  'compra', 'obra', 'transporte', 'limpieza',
  'alimentación', 'medicamentos', 'equipos', 'mobiliario',
  'capacitación', 'seguridad', 'sistema', 'proyecto',
  'mejoramiento', 'rehabilitación', 'ampliación', 'reparación',
  'estudio', 'diseño', 'fiscalización', 'auditoría',
  'alquiler', 'arrendamiento', 'seguros', 'combustible',
  'uniformes', 'material', 'insumos', 'herramientas',
  'vehículos', 'tecnología', 'software', 'internet',
  'agua', 'eléctrico', 'electrónico', 'médico',
  'laboratorio', 'impresión', 'publicidad', 'comunicación',
  'para', 'del', 'los', 'con', 'por', 'las',
  'municipal', 'provincial', 'ministerio', 'hospital',
  'universidad', 'escuela', 'instituto', 'empresa',
  'infraestructura', 'instalación', 'implementación',
  'evaluación', 'supervisión', 'control', 'gestión',
];

// ── Estado del job (uno a la vez) ────────────────────────────
export const updateJob = {
  running: false, phase: '', year: 0, startedAt: '', finishedAt: '',
  searched: 0, inserted: 0, skipped: 0, reflagged: 0, reconciled: 0,
  errors: [] as string[], progress: '', lastRun: null as any,
};

function log(msg: string) { console.log(`[updater ${new Date().toISOString()}] ${msg}`); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const yieldLoop = () => new Promise(r => setImmediate(r));
function pushErr(msg: string) { if (updateJob.errors.length < 80) updateJob.errors.push(msg); }

// ── HTTP con throttle global (~3 req/s) y respeto del 429 ────
let lastReq = 0;
async function sercopFetch(url: string, retries = 6): Promise<any | null> {
  for (let a = 1; a <= retries; a++) {
    const gap = 350 - (Date.now() - lastReq);
    if (gap > 0) await sleep(gap);
    lastReq = Date.now();
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'OICP-updater' }, signal: AbortSignal.timeout(45000) });
      if (res.status === 429) {
        const ra = Number(res.headers.get('retry-after')) || Math.min(60, 4 * 2 ** (a - 1));
        await sleep(ra * 1000 + Math.random() * 1500);
        continue;
      }
      if (!res.ok) { if (a === retries) return null; await sleep(2000 * a); continue; }
      const text = await res.text();
      if (text.startsWith('<')) { if (a === retries) return null; await sleep(30000); continue; }
      return JSON.parse(text);
    } catch {
      if (a === retries) return null;
      await sleep(2000 * a);
    }
  }
  return null;
}

// ── Parse del record OCDS (la API devuelve releases al nivel superior;
//    se acepta también el formato antiguo records[0].releases) ─
function releaseFrom(recData: any): any | null {
  const rels = recData?.releases?.length ? recData.releases
    : recData?.records?.[0]?.releases?.length ? recData.records[0].releases : null;
  return rels ? rels[rels.length - 1] : null;
}

function releaseToProc(release: any, sr: any, year: number) {
  const t = release.tender || {}, aw = release.awards || [], co = release.contracts || [];
  const buyer = release.buyer || t.procuringEntity || {};
  const fa = aw[0] || {}, fc = co[0] || {};
  const suppliers: any[] = [];
  for (const a of aw) for (const s of (a.suppliers || [])) {
    const id = s.id || s.identifier?.id || '', name = s.name || '';
    if ((id || name) && !suppliers.find(x => x.id === id && x.name === name)) suppliers.push({ id, name });
  }
  if (!suppliers.length && sr?.suppliers && typeof sr.suppliers === 'string') suppliers.push({ id: '', name: sr.suppliers });
  const md = t.procurementMethodDetails || sr?.internal_type || '';
  let m = t.procurementMethod || sr?.method || '';
  if (!m) { const d = md.toLowerCase(); m = d.includes('ínfima') || d.includes('infima') ? 'limited' : d.includes('especial') ? 'selective' : d.includes('catálogo') || d.includes('catalogo') ? 'direct' : 'open'; }
  const bn = buyer.name || sr?.buyer || null;
  const bi = buyer.id || (bn ? 'EC-' + bn.substring(0, 30).replace(/[^A-Za-z0-9]/g, '-') : null);
  let ac = 0; for (const c of co) ac += (c.amendments || []).length;
  const pub = t.tenderPeriod?.startDate || release.date || sr?.date || null;
  return {
    id: release.ocid || sr?.ocid, ocid: release.ocid || sr?.ocid,
    title: t.title || t.description || sr?.title || '', description: t.description || sr?.description || '',
    status: release.tag?.includes('contract') ? 'contract' : release.tag?.includes('award') ? 'award' : 'tender',
    procurement_method: m, procurement_method_details: md, buyer_id: bi, buyer_name: bn,
    budget_amount: t.value?.amount || release.planning?.budget?.amount?.amount || (sr?.budget ? parseFloat(sr.budget) : null),
    budget_currency: 'USD', award_amount: fa.value?.amount || (sr?.amount ? parseFloat(sr.amount) : null),
    contract_amount: fc.value?.amount || null, final_amount: fc.implementation?.finalValue?.amount || null,
    published_date: pub, submission_deadline: t.tenderPeriod?.endDate || null,
    award_date: fa.date || null, contract_date: fc.dateSigned || null,
    suppliers, number_of_tenderers: t.numberOfTenderers || release.bids?.details?.length || null,
    items_classification: t.items?.[0]?.classification?.id || null,
    has_amendments: ac > 0, amendment_count: ac, source_year: year,
    regime: getRegime(pub || `${year}-06-15`),
  };
}

const rx10 = /\d{10,13}/;
function num(x: any): number { const n = typeof x === 'number' ? x : parseFloat(x); return Number.isFinite(n) ? n : 0; }
function montoPlausible(fa: any, ca: any, aa: any): number {
  const f = num(fa), c = num(ca), a = num(aa);
  const m = f || c || a;
  if (a > 0 && m > a * 100) return a;
  if (m > 1e10) return a > 0 ? a : 0;
  return m;
}
// RUC10 únicos de un proceso (misma semántica en patch, reflag y buildAnalytics)
export function uniqueRuc10(suppliers: any[]): { r10: string; name: string }[] {
  const out: { r10: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const s of (suppliers || [])) {
    const m = rx10.exec(s.id || ''); if (!m) continue;
    const r10 = m[0].slice(0, 10);
    if (seen.has(r10)) continue;
    seen.add(r10);
    out.push({ r10, name: s.name || '' });
  }
  return out;
}

// ── Cursor / settings ────────────────────────────────────────
function getSetting(db: Database.Database, key: string): string | null {
  db.exec(`CREATE TABLE IF NOT EXISTS mcp_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  const r = db.prepare(`SELECT value FROM mcp_settings WHERE key=?`).get(key) as any;
  return r ? r.value : null;
}
function setSetting(db: Database.Database, key: string, value: string | null) {
  db.exec(`CREATE TABLE IF NOT EXISTS mcp_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  if (value === null) db.prepare(`DELETE FROM mcp_settings WHERE key=?`).run(key);
  else db.prepare(`INSERT INTO mcp_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, value);
}

// ── Corte de datos (para /api/version y el footer) ───────────
let cachedCutoff: string | null = null;
let cachedCount: number | null = null;
export function getDataCutoff(): { cutoff: string | null; processes: number | null } {
  return { cutoff: cachedCutoff, processes: cachedCount };
}
export function refreshDataCutoff() {
  try {
    const db = getDb();
    const r = db.prepare(`SELECT MAX(substr(published_date,1,10)) AS c FROM procedures
                          WHERE published_date IS NOT NULL AND published_date <= datetime('now','+1 day')`).get() as any;
    const n = db.prepare(`SELECT COUNT(*) AS n FROM procedures`).get() as any;
    cachedCutoff = r?.c || null;
    cachedCount = n?.n ?? null;
  } catch { /* base aún no lista */ }
}

// ── Agregados: upsert incremental (mismo resultado que buildAnalytics) ──
export function patchAggregatesForNew(db: Database.Database, procs: any[]) {
  if (!analyticsReady(db) || !procs.length) return;
  const upSup = db.prepare(`INSERT INTO a_suppliers (ruc10,name,n_procs,total_usd,first_year,last_year,n_buyers,n_critical,n_high,n_moderate,n_low)
    VALUES (@r,@name,1,@m,@y,@y,1,@c,@h,@mo,@lo)
    ON CONFLICT(ruc10) DO UPDATE SET
      n_procs=n_procs+1, total_usd=ROUND(total_usd+@m,2),
      first_year=MIN(first_year,@y), last_year=MAX(last_year,@y),
      n_critical=n_critical+@c, n_high=n_high+@h, n_moderate=n_moderate+@mo, n_low=n_low+@lo,
      name=CASE WHEN name='' OR name IS NULL THEN @name ELSE name END`);
  const upSb = db.prepare(`INSERT INTO a_supplier_buyer (ruc10,buyer_id,buyer_name,n_procs,total_usd,last_year)
    VALUES (@r,@b,@bn,1,@m,@y)
    ON CONFLICT(ruc10,buyer_id) DO UPDATE SET n_procs=n_procs+1, total_usd=ROUND(total_usd+@m,2), last_year=MAX(last_year,@y)`);
  const upSy = db.prepare(`INSERT INTO a_supplier_year (ruc10,year,n_procs,total_usd) VALUES (@r,@y,1,@m)
    ON CONFLICT(ruc10,year) DO UPDATE SET n_procs=n_procs+1, total_usd=ROUND(total_usd+@m,2)`);
  const upBuy = db.prepare(`INSERT INTO a_buyers (buyer_id,name,n_procs,total_usd,first_year,last_year) VALUES (@b,@bn,1,@m,@y,@y)
    ON CONFLICT(buyer_id) DO UPDATE SET n_procs=n_procs+1, total_usd=ROUND(total_usd+@m,2),
      first_year=MIN(first_year,@y), last_year=MAX(last_year,@y)`);
  const upRy = db.prepare(`INSERT INTO a_risk_year (risk,year,n,total_usd) VALUES (@rl,@y,1,@m)
    ON CONFLICT(risk,year) DO UPDATE SET n=n+1, total_usd=ROUND(total_usd+@m,2)`);
  const upFy = db.prepare(`INSERT INTO a_flag_year (code,year,n) VALUES (@code,@y,1)
    ON CONFLICT(code,year) DO UPDATE SET n=n+1`);
  const nBuyers = db.prepare(`SELECT COUNT(*) AS n FROM a_supplier_buyer WHERE ruc10=?`);
  const setNb = db.prepare(`UPDATE a_suppliers SET n_buyers=? WHERE ruc10=?`);
  const insFts = db.prepare(`INSERT INTO a_fts (ocid,texto) VALUES (?,?)`);
  const insCrit = db.prepare(`INSERT INTO a_supplier_critical (ruc10,ocid,score,risk_level,year,monto_usd) VALUES (?,?,?,?,?,?)`);

  const tx = db.transaction((batch: any[]) => {
    for (const p of batch) {
      const monto = montoPlausible(p.final_amount, p.contract_amount, p.award_amount);
      const y = p.source_year || 0;
      const rl = p.risk_level || 'low';
      const cnt = { c: rl === 'critical' ? 1 : 0, h: rl === 'high' ? 1 : 0, mo: rl === 'moderate' ? 1 : 0, lo: (rl === 'low' || !rl) ? 1 : 0 };
      const sups = uniqueRuc10(p.suppliers);
      for (const { r10, name } of sups) {
        upSup.run({ r: r10, name, m: monto, y, ...cnt });
        if (p.buyer_id) {
          upSb.run({ r: r10, b: p.buyer_id, bn: p.buyer_name || '', m: monto, y });
          setNb.run((nBuyers.get(r10) as any).n, r10);
        }
        upSy.run({ r: r10, y, m: monto });
        if (rl === 'critical' || rl === 'high') insCrit.run(r10, p.id, p.score || 0, rl, y, Math.round(monto * 100) / 100);
      }
      if (p.buyer_id) upBuy.run({ b: p.buyer_id, bn: p.buyer_name || '', m: monto, y });
      upRy.run({ rl, y, m: monto });
      for (const f of (p.flags || [])) upFy.run({ code: f.code || '?', y });
      const texto = [(p.description || p.title || '').slice(0, 400), p.buyer_name || '', sups.map(s => s.name).join(' ')]
        .filter(Boolean).join(' ');
      if (texto.trim()) insFts.run(p.id, texto);
    }
  });
  for (let i = 0; i < procs.length; i += FLUSH_EVERY) {
    tx(procs.slice(i, i + FLUSH_EVERY));
    db.pragma('wal_checkpoint(TRUNCATE)');
  }
}

// ── Reconciliación de huérfanos (corrida anterior murió sucia) ──
// Un huérfano = fila de procedures sin entrada en a_fts (el marcador por-proceso).
async function reconcileOrphans(db: Database.Database): Promise<number> {
  if (!analyticsReady(db)) return 0;
  const inAgg = new Set<string>();
  for (const r of db.prepare(`SELECT ocid FROM a_fts`).iterate() as any) inAgg.add(r.ocid);
  await yieldLoop();
  const orphans: string[] = [];
  for (const r of db.prepare(`SELECT id FROM procedures`).iterate() as any) {
    if (!inAgg.has(r.id)) orphans.push(r.id);
  }
  inAgg.clear();
  await yieldLoop();
  if (!orphans.length) return 0;
  log(`reconciliación: ${orphans.length} procesos fuera de los agregados; reparando…`);
  const getRow = db.prepare(`SELECT * FROM procedures WHERE id=?`);
  for (let i = 0; i < orphans.length; i += FLUSH_EVERY) {
    const batch = orphans.slice(i, i + FLUSH_EVERY).map(id => {
      const row = getRow.get(id) as any;
      let suppliers: any[] = []; let flags: any[] = [];
      try { suppliers = JSON.parse(row.suppliers || '[]'); } catch { /* corrupto: sin proveedores */ }
      try { flags = JSON.parse(row.flags || '[]'); } catch { /* corrupto: sin banderas */ }
      return { ...row, suppliers, flags };
    });
    patchAggregatesForNew(db, batch);
    await yieldLoop();
  }
  return orphans.length;
}

// ── Contexto de concentración (misma semántica que /normalize) ─
// Construye DOS índices, y esa separación es el arreglo de fondo:
//   - byPairYear: los hechos del par comprador-proveedor EN CADA AÑO. CC-01, CC-02 y CC-05
//     los leen para el año del proceso que están evaluando.
//   - byPair: solo lo que por definición es histórico (años distintos, monto acumulado,
//     consorcios). Lo leen CC-03 y CC-04.
// Antes había un único índice por par en el que los años se colapsaban con Math.max, y ese
// máximo se aplicaba a TODOS los procesos del par. Efecto medido en producción: un proceso
// de marzo de 2019 marcado con CC-02 y el detalle "98.8% del gasto de este comprador",
// cuando el share real de 2019 fue 17,17% y el 98,85% era el de 2026. La bandera no debía
// existir y dejaba el proceso en score 100/crítico.
export function buildConcentrationContext(db: Database.Database) {
  const byPairYear = new Map<string, any>();
  const byPair = new Map<string, any>();
  const aniosPorPar = new Map<string, Set<number>>();

  for (const r of db.prepare(`
    SELECT buyer_id, supplier_id, supplier_name, year, contract_count, total_value,
           COALESCE(infima_count,0) AS infima_count, COALESCE(infima_total_value,0) AS infima_total_value,
           COALESCE(share_of_buyer,0) AS share_of_buyer
    FROM concentration_index WHERE supplier_id IS NOT NULL`).iterate() as any) {
    const par = `${r.buyer_id}|${r.supplier_id}`;

    byPairYear.set(`${par}|${r.year}`, {
      supplier_name: r.supplier_name,
      infima_count: r.infima_count,
      infima_total_value: r.infima_total_value,
      share_of_buyer: r.share_of_buyer,
      buyer_total_procs: 0,          // se completa abajo, por comprador Y AÑO
      _buyer: r.buyer_id, _year: r.year,
    });

    let hist = byPair.get(par);
    if (!hist) {
      hist = { supplier_name: r.supplier_name, years_active: 0, total_value: 0, consortium_count: 0 };
      byPair.set(par, hist);
      aniosPorPar.set(par, new Set());
    }
    hist.total_value += (r.total_value || 0);
    aniosPorPar.get(par)!.add(r.year);
  }
  for (const [par, anios] of aniosPorPar) byPair.get(par).years_active = anios.size;

  // Piso de volumen de CC-02: procesos del comprador EN ESE AÑO. Antes era el acumulado de
  // todos los años (GROUP BY buyer_id sin año), así que el piso de 10 se cumplía con la
  // suma del período aunque ese año el comprador hubiera tenido 1 solo proceso.
  const procsCompradorAnio = new Map<string, number>();
  for (const r of db.prepare(`SELECT buyer_id, year, SUM(contract_count) AS n FROM concentration_index
    WHERE supplier_id IS NOT NULL GROUP BY buyer_id, year`).iterate() as any) {
    procsCompradorAnio.set(`${r.buyer_id}|${r.year}`, r.n || 0);
  }
  for (const v of byPairYear.values()) {
    v.buyer_total_procs = procsCompradorAnio.get(`${v._buyer}|${v._year}`) || 0;
    delete v._buyer; delete v._year;
  }

  // Consorcios: se EXCLUYE el catálogo electrónico, igual que hace la propia bandera con el
  // proceso que evalúa. Antes el contador incluía procesos de catálogo (7 de los 41 del
  // dataset), o sea que contaba lo que la regla publicada dice excluir.
  // El patrón usa el comodín de un carácter en la vocal acentuada, igual que
  // SQL_NO_ES_CATALOGO en db.ts: UPPER() de SQLite solo convierte ASCII, así que 'catálogo'
  // pasaba a 'CATáLOGO' y el patrón con Á no lo alcanzaba. Hoy no cambia ninguna fila (los dos
  // patrones dan lo mismo sobre estos datos), pero era un filtro que dependía de cómo viniera
  // escrita la tilde en la fuente.
  for (const row of db.prepare(`
    SELECT buyer_id, suppliers FROM procedures
    WHERE json_array_length(suppliers) >= 2
      AND COALESCE(procurement_method_details,'') NOT LIKE '%cat_logo electr_nico%'
      AND COALESCE(procurement_method_details,'') NOT LIKE '%catalogo electronico%'
      AND COALESCE(title,'') NOT LIKE 'ORDEN DE COMPRA CE%'`).iterate() as any) {
    let sups: any[] = [];
    try { sups = JSON.parse(row.suppliers || '[]'); } catch { continue; }
    for (const s of sups) {
      if (!s.id) continue;
      const hist = byPair.get(`${row.buyer_id}|${s.id}`);
      if (hist) hist.consortium_count++;
    }
  }
  return { byPairYear, byPair };
}

// ── Re-evaluación global: iterate() + escritura ATÓMICA por lote
//    (fila de procedures y sus deltas de agregados en la misma transacción) ──
export async function reflagChanged(dbIn?: Database.Database): Promise<number> {
  const db = dbIn || getDb();
  const ctx = buildConcentrationContext(db);
  type Change = { id: string; flags: string; score: number; rl: string;
    oldRl: string; oldFlags: string; year: number; suppliers: string; monto: number };

  const hasAgg = analyticsReady(db);
  const upd = db.prepare(`UPDATE procedures SET flags=?, score=?, risk_level=? WHERE id=?`);
  const dRy = hasAgg ? db.prepare(`UPDATE a_risk_year SET n=n+?, total_usd=ROUND(total_usd+?,2) WHERE risk=? AND year=?`) : null;
  const iRy = hasAgg ? db.prepare(`INSERT OR IGNORE INTO a_risk_year (risk,year,n,total_usd) VALUES (?,?,0,0)`) : null;
  const dFy = hasAgg ? db.prepare(`UPDATE a_flag_year SET n=n+? WHERE code=? AND year=?`) : null;
  const iFy = hasAgg ? db.prepare(`INSERT OR IGNORE INTO a_flag_year (code,year,n) VALUES (?,?,0)`) : null;
  const dSup = hasAgg ? db.prepare(`UPDATE a_suppliers SET n_critical=n_critical+@dc, n_high=n_high+@dh,
    n_moderate=n_moderate+@dm, n_low=n_low+@dl WHERE ruc10=@r`) : null;
  const delCrit = hasAgg ? db.prepare(`DELETE FROM a_supplier_critical WHERE ocid=?`) : null;
  const insCrit = hasAgg ? db.prepare(`INSERT INTO a_supplier_critical (ruc10,ocid,score,risk_level,year,monto_usd) VALUES (?,?,?,?,?,?)`) : null;
  const updCrit = hasAgg ? db.prepare(`UPDATE a_supplier_critical SET score=?, risk_level=? WHERE ocid=?`) : null;
  const cnt = (rl: string) => ({ dc: rl === 'critical' ? 1 : 0, dh: rl === 'high' ? 1 : 0,
    dm: rl === 'moderate' ? 1 : 0, dl: (rl === 'low' || !rl) ? 1 : 0 });

  // Fila + deltas en la MISMA transacción: si el lote muere, procedures y a_* quedan
  // consistentes entre sí y el diff-only de la próxima corrida retoma lo pendiente.
  const applyBatch = db.transaction((batch: Change[]) => {
    for (const c of batch) {
      upd.run(c.flags, c.score, c.rl, c.id);
      if (!hasAgg) continue;
      let sups: { r10: string; name: string }[] = [];
      try { sups = uniqueRuc10(JSON.parse(c.suppliers)); } catch { pushErr(`suppliers ilegible en ${c.id}`); }
      if (c.rl !== c.oldRl) {
        iRy!.run(c.rl, c.year); iRy!.run(c.oldRl, c.year);
        dRy!.run(-1, -c.monto, c.oldRl, c.year);
        dRy!.run(1, c.monto, c.rl, c.year);
        const oldC = cnt(c.oldRl), newC = cnt(c.rl);
        for (const { r10 } of sups) {
          dSup!.run({ r: r10, dc: newC.dc - oldC.dc, dh: newC.dh - oldC.dh, dm: newC.dm - oldC.dm, dl: newC.dl - oldC.dl });
        }
        const wasCrit = c.oldRl === 'critical' || c.oldRl === 'high';
        const isCrit = c.rl === 'critical' || c.rl === 'high';
        if (wasCrit && !isCrit) delCrit!.run(c.id);
        else if (!wasCrit && isCrit) for (const { r10 } of sups) insCrit!.run(r10, c.id, c.score, c.rl, c.year, Math.round(c.monto * 100) / 100);
        else if (wasCrit && isCrit) updCrit!.run(c.score, c.rl, c.id);
      }
      try {
        const oldCodes = new Set<string>(JSON.parse(c.oldFlags).map((f: any) => f.code));
        const newCodes = new Set<string>(JSON.parse(c.flags).map((f: any) => f.code));
        for (const code of newCodes) if (!oldCodes.has(code)) { iFy!.run(code, c.year); dFy!.run(1, code, c.year); }
        for (const code of oldCodes) if (!newCodes.has(code)) { iFy!.run(code, c.year); dFy!.run(-1, code, c.year); }
      } catch { pushErr(`flags ilegibles en ${c.id}`); }
    }
  });
  // ── Recorrido por CURSOR, no por iterador abierto ──────────────────────────
  // Antes esta función acumulaba el conjunto COMPLETO de cambios en un array antes de
  // escribir nada. Con un cambio de regla que toque a casi todos los procesos, ese array
  // guarda 1,47 M objetos con el JSON de banderas nuevo, el viejo y los proveedores:
  // medido en el orden de los GB, y el contenedor muere por memoria a mitad del trabajo.
  //
  // No se puede simplemente intercalar las escrituras dentro del bucle de lectura: un
  // iterador abierto impide el `wal_checkpoint`, y un WAL sin control ya llenó el volumen
  // y tumbó producción (ver ESTADO.md). La salida es avanzar por CURSOR sobre la clave
  // primaria: cada lote se lee completo, el `SELECT` se cierra, se escribe, se consolida el
  // WAL y se sigue. Memoria acotada al lote y checkpoint garantizado entre lotes.
  //
  // El `.all()` de abajo NO viola la regla 3: está acotado a LOTE filas, no a la tabla.
  const LOTE = 5000;
  const leerLote = db.prepare(`
    SELECT id, ocid, procurement_method, procurement_method_details, buyer_id,
           budget_amount, award_amount, contract_amount, final_amount,
           published_date, submission_deadline, award_date, number_of_tenderers,
           title, description, items_classification, has_amendments, amendment_count,
           suppliers, source_year, flags, score, risk_level
    FROM procedures WHERE id > ? ORDER BY id LIMIT ?`);

  let cursor = '';
  let totalCambios = 0;
  for (;;) {
    const filas = leerLote.all(cursor, LOTE) as any[];
    if (!filas.length) break;
    cursor = filas[filas.length - 1].id;   // el UPDATE no toca el id: el cursor no se repite

    const changes: Change[] = [];
    for (const row of filas) {
      let suppliersArr: any[] = [];
      try { suppliersArr = JSON.parse(row.suppliers || '[]'); } catch { /* corrupto: se evalúa sin proveedores */ }
      const proc = { ...row, budget_amount: Number(row.budget_amount) || 0,
        suppliers: suppliersArr, has_amendments: !!row.has_amendments };
      const { flags, score, riskLevel } = evaluateAllFlags(proc, ctx);
      const flagsJson = JSON.stringify(flags);
      if (flagsJson !== row.flags || score !== row.score || riskLevel !== row.risk_level) {
        changes.push({ id: row.id, flags: flagsJson, score, rl: riskLevel, oldRl: row.risk_level || 'low',
          oldFlags: row.flags || '[]', year: row.source_year || 0, suppliers: row.suppliers || '[]',
          monto: montoPlausible(row.final_amount, row.contract_amount, row.award_amount) });
      }
    }

    if (changes.length) {
      applyBatch(changes);
      db.pragma('wal_checkpoint(TRUNCATE)');
      totalCambios += changes.length;
    }
    await yieldLoop();
  }
  if (!totalCambios) return 0;

  if (hasAgg) {
    // Poda: máximo 5 ejemplos críticos por proveedor, los de mayor score (invariante de buildAnalytics)
    db.exec(`DELETE FROM a_supplier_critical WHERE rowid NOT IN (
      SELECT rowid FROM (SELECT rowid, ROW_NUMBER() OVER (PARTITION BY ruc10 ORDER BY score DESC) rn
        FROM a_supplier_critical) WHERE rn <= 5)`);
    db.pragma('wal_checkpoint(TRUNCATE)');
  }
  return totalCambios;
}

// ── Corrida principal ────────────────────────────────────────
export async function runUpdate(opts: { year?: number; budgetMin?: number; terms?: string[] } = {}) {
  if (updateJob.running) return { started: false, reason: 'Ya hay una actualización en curso' };
  try {
    const adminMod: any = await import('./routes/admin.js');
    if (adminMod.loadJobRunning?.()) return { started: false, reason: 'Hay una descarga /admin/load en curso' };
  } catch { /* módulo admin no disponible (tests): sin descarga concurrente posible */ }

  const year = opts.year || new Date().getFullYear();
  const budgetMs = (opts.budgetMin ?? (Number(process.env.UPDATE_BUDGET_MIN) || 240)) * 60_000;
  const terms = opts.terms?.length ? opts.terms : TERMS;
  const t0 = Date.now();

  Object.assign(updateJob, { running: true, phase: 'start', year, startedAt: new Date().toISOString(),
    finishedAt: '', searched: 0, inserted: 0, skipped: 0, reflagged: 0, reconciled: 0, errors: [], progress: 'Iniciando…' });

  // Cursor de reanudación {year, termIdx, page} (solo dentro del mismo año).
  let startTerm = 0, startPage = 1;
  try {
    const cur = JSON.parse(getSetting(getDb(), 'update_cursor') || 'null');
    if (cur && cur.year === year && cur.termIdx < terms.length) { startTerm = cur.termIdx; startPage = cur.page || 1; }
  } catch { /* cursor corrupto: barrido desde el inicio */ }

  (async () => {
    // La conexión se re-lee de getDb() en cada fase: upload-db/restore pueden reemplazarla.
    let pendingNew: any[] = [];
    let outOfBudget = false;
    let anyWork = false;
    const saveCursor = (t: number, p: number) => setSetting(getDb(), 'update_cursor', JSON.stringify({ year, termIdx: t, page: p }));
    try {
      // 0) Autorreparación si la corrida anterior murió sucia
      if (getSetting(getDb(), 'update_clean') === '0') {
        updateJob.phase = 'reconcile';
        updateJob.progress = 'Reconciliando agregados de una corrida interrumpida…';
        updateJob.reconciled = await reconcileOrphans(getDb());
        if (updateJob.reconciled > 0) anyWork = true;
      }
      setSetting(getDb(), 'update_clean', '0');

      updateJob.phase = 'sweep';
      let exists = { db: getDb(), stmt: getDb().prepare(`SELECT 1 FROM procedures WHERE id=?`) };
      const existsGet = (id: string) => {
        const d = getDb();
        if (d !== exists.db) exists = { db: d, stmt: d.prepare(`SELECT 1 FROM procedures WHERE id=?`) };
        return exists.stmt.get(id);
      };
      const flush = () => {
        if (!pendingNew.length) return;
        patchAggregatesForNew(getDb(), pendingNew);
        pendingNew = [];
      };

      for (let t = startTerm; t < terms.length; t++) {
        if (!updateJob.running || outOfBudget) break;
        const term = terms[t];
        let page = (t === startTerm ? startPage : 1), totalPages = 1;
        while (page <= totalPages && updateJob.running && !outOfBudget) {
          if (page > MAX_PAGES) { pushErr(`término "${term}": ${totalPages} páginas supera el tope ${MAX_PAGES}; cola pendiente`); break; }
          if (Date.now() - t0 > budgetMs) { outOfBudget = true; saveCursor(t, page); break; }
          const sd = await sercopFetch(`${SEARCH_API}?year=${year}&search=${encodeURIComponent(term)}&page=${page}`);
          updateJob.searched++;
          if (!sd) { pushErr(`búsqueda "${term}" pág ${page}: sin respuesta tras reintentos`); break; }
          if (!sd.data) break;
          totalPages = sd.pages || 1;
          updateJob.progress = `[${t + 1}/${terms.length}] "${term}" pág ${page}/${totalPages} — nuevos: ${updateJob.inserted}`;
          if (!sd.data.length) break;
          for (const sr of sd.data) {
            if (!updateJob.running) break;
            if (Date.now() - t0 > budgetMs) { outOfBudget = true; saveCursor(t, page); break; }
            const ocid = sr.ocid;
            if (!ocid) continue;
            if (existsGet(ocid)) { updateJob.skipped++; continue; }
            const recData = await sercopFetch(`${RECORD_API}?ocid=${encodeURIComponent(ocid)}`);
            const release = recData ? releaseFrom(recData) : null;
            if (!release) { pushErr(`sin release: ${ocid}`); continue; }
            try {
              const proc = releaseToProc(release, sr, year);
              const isNew = !existsGet(proc.id);
              const { flags, score, riskLevel } = evaluateAllFlags(proc);
              upsertProcedure({ ...proc, flags, score, risk_level: riskLevel });
              if (isNew) {
                pendingNew.push({ ...proc, flags, score, risk_level: riskLevel });
                updateJob.inserted++;
                anyWork = true;
                if (pendingNew.length >= FLUSH_EVERY) flush();
              } else {
                updateJob.skipped++;
              }
            } catch (e: any) {
              pushErr(`${ocid}: ${e.message}`);
            }
          }
          page++;
        }
      }
      flush();
      if (!outOfBudget && updateJob.running) setSetting(getDb(), 'update_cursor', null);

      if (anyWork) {
        updateJob.phase = 'concentration';
        updateJob.progress = 'Reconstruyendo índice de concentración del año…';
        rebuildConcentrationIndex(year);
        getDb().pragma('wal_checkpoint(TRUNCATE)');

        updateJob.phase = 'reflag';
        updateJob.progress = 'Re-evaluando banderas (solo cambios se escriben)…';
        updateJob.reflagged = await reflagChanged(getDb());
      }

      setSetting(getDb(), 'update_clean', '1');
      updateJob.phase = 'done';
      updateJob.progress = `✅ nuevos: ${updateJob.inserted} · re-flageados: ${updateJob.reflagged}` +
        (updateJob.reconciled ? ` · reconciliados: ${updateJob.reconciled}` : '') +
        (outOfBudget ? ' · presupuesto agotado, continúa en la próxima corrida' : ' · barrido completo');
      invalidateStatsCache();
      refreshDataCutoff();
      setSetting(getDb(), 'update_last_run', JSON.stringify({
        finishedAt: new Date().toISOString(), year, inserted: updateJob.inserted,
        reflagged: updateJob.reflagged, reconciled: updateJob.reconciled, skipped: updateJob.skipped,
        searched: updateJob.searched, complete: !outOfBudget, minutes: Math.round((Date.now() - t0) / 60000),
        errors: updateJob.errors.length,
      }));
      log(updateJob.progress);
    } catch (e: any) {
      updateJob.phase = 'error';
      updateJob.progress = `Error: ${e.message}`;
      pushErr(e.message);
      log(`ERROR: ${e.stack || e.message}`);
    } finally {
      try { getDb().pragma('wal_checkpoint(TRUNCATE)'); } catch { /* conexión reemplazada */ }
      try { updateJob.lastRun = JSON.parse(getSetting(getDb(), 'update_last_run') || 'null'); } catch { /* sin último run */ }
      updateJob.running = false;
      updateJob.finishedAt = new Date().toISOString();
    }
  })().catch((e: any) => {
    updateJob.running = false;
    updateJob.phase = 'error';
    pushErr(String(e?.message || e));
    log(`ERROR no controlado: ${e?.stack || e}`);
  });

  return { started: true, year, budgetMin: budgetMs / 60000, resumedFrom: { termIdx: startTerm, page: startPage } };
}

export function stopUpdate() {
  updateJob.running = false;
  updateJob.progress = 'Detenido por el administrador (lo descargado queda guardado).';
}

// ── Ingesta remota: el barrido corre en una máquina con IP ecuatoriana
//    (SERCOP bloquea IPs de datacenter) y empuja los procesos parseados aquí. ──
export function missingOcids(ocids: string[]): string[] {
  const db = getDb();
  const exists = db.prepare(`SELECT 1 FROM procedures WHERE id=?`);
  return ocids.filter(o => typeof o === 'string' && o && !exists.get(o));
}

export function ingestProcs(procs: any[]): { inserted: number; skipped: number } {
  const db = getDb();
  setSetting(db, 'update_clean', '0');
  const exists = db.prepare(`SELECT 1 FROM procedures WHERE id=?`);
  const fresh: any[] = [];
  let skipped = 0;
  for (const raw of procs) {
    if (!raw || typeof raw.id !== 'string' || !raw.id) { skipped++; continue; }
    if (exists.get(raw.id)) { skipped++; continue; }
    const proc = { ...raw, suppliers: Array.isArray(raw.suppliers) ? raw.suppliers : [] };
    const { flags, score, riskLevel } = evaluateAllFlags(proc);
    upsertProcedure({ ...proc, flags, score, risk_level: riskLevel });
    fresh.push({ ...proc, flags, score, risk_level: riskLevel });
  }
  patchAggregatesForNew(db, fresh);
  db.pragma('wal_checkpoint(TRUNCATE)');
  setSetting(db, 'update_clean', '1');
  return { inserted: fresh.length, skipped };
}

export async function finalizeIngest(year: number): Promise<any> {
  const db = getDb();
  let reconciled = 0;
  if (getSetting(db, 'update_clean') === '0') reconciled = await reconcileOrphans(db);
  rebuildConcentrationIndex(year);
  db.pragma('wal_checkpoint(TRUNCATE)');
  const reflagged = await reflagChanged(getDb());
  invalidateStatsCache();
  refreshDataCutoff();
  setSetting(getDb(), 'update_clean', '1');
  setSetting(getDb(), 'update_last_run', JSON.stringify({
    finishedAt: new Date().toISOString(), year, mode: 'ingesta-local',
    reflagged, reconciled,
  }));
  log(`ingesta finalizada: reflag=${reflagged} reconciliados=${reconciled}`);
  return { reflagged, reconciled, ...getDataCutoff() };
}

// ── ¿SERCOP responde desde este host? (Railway suele estar bloqueado) ──
export async function sercopReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${SEARCH_API}?year=${new Date().getFullYear()}&search=agua&page=1`,
      { headers: { 'User-Agent': 'OICP-updater' }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return false;
    const text = await res.text();
    return !text.startsWith('<');
  } catch { return false; }
}

// ── Cron: martes y jueves 02:00 America/Guayaquil ────────────
export function scheduleAutoUpdate() {
  const enabled = !['0', 'false', 'off'].includes((process.env.AUTO_UPDATE || '1').toLowerCase());
  if (!enabled) { log('auto-update DESACTIVADO (AUTO_UPDATE=0)'); return; }
  const expr = process.env.UPDATE_CRON || '0 2 * * 2,4';
  cron.schedule(expr, async () => {
    if (updateJob.running) { log('cron: corrida anterior sigue activa, se omite'); return; }
    if (!(await sercopReachable())) {
      log('cron: SERCOP inaccesible desde este host (bloqueo de IP de datacenter); ' +
          'se omite — la sincronización local desde la máquina de Oscar cubre la actualización.');
      return;
    }
    log(`cron: iniciando actualización automática (${expr})`);
    runUpdate({});
  }, { timezone: process.env.UPDATE_TZ || 'America/Guayaquil' });
  log(`auto-update ACTIVO: cron "${expr}" (${process.env.UPDATE_TZ || 'America/Guayaquil'})`);
}
