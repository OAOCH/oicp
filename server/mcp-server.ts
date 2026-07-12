/**
 * OICP MCP remoto — servidor MCP (streamable HTTP, JSON stateless) montado en /mcp/:token.
 *
 * Diseñado para usarse como "conector personalizado" en claude.ai / app de Claude.
 * - Solo lectura sobre la base existente (las herramientas rechazan todo lo que no sea SELECT).
 * - Token secreto en la URL (hash sha256 guardado en la tabla mcp_settings).
 * - Los agregados a_* se construyen una vez con buildAnalytics() (endpoint admin).
 */
import crypto from 'crypto';
import DatabaseCtor from 'better-sqlite3';
import type Database from 'better-sqlite3';

const PROD = 'https://oicp-production.up.railway.app';
const DISCLAIMER = 'Los indicadores son señales analíticas basadas en datos públicos OCDS del SERCOP; NO constituyen evidencia ni acusación de irregularidad. Verificar siempre en la fuente oficial.';
const MONTO_NOTA = 'monto_usd = COALESCE(final, contract, award) con regla de plausibilidad: si contract/final >100x el adjudicado se usa el adjudicado (montos corruptos de la fuente SERCOP).';

// ── Token ────────────────────────────────────────────────────
function ensureSettingsTable(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS mcp_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
}

export function mintMcpToken(db: Database.Database): string {
  ensureSettingsTable(db);
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  db.prepare(`INSERT INTO mcp_settings (key, value) VALUES ('mcp_token_hash', ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(hash);
  return token;
}

export function verifyMcpToken(db: Database.Database, token: string): boolean {
  if (!token || token.length < 32) return false;
  ensureSettingsTable(db);
  const row = db.prepare(`SELECT value FROM mcp_settings WHERE key = 'mcp_token_hash'`).get() as any;
  if (!row) return false;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(row.value));
}

// ── Analytics (agregados precalculados en la MISMA base) ─────
function num(x: any): number {
  const n = typeof x === 'number' ? x : parseFloat(x);
  return Number.isFinite(n) ? n : 0;
}

function montoPlausible(fa: any, ca: any, aa: any): number {
  const f = num(fa), c = num(ca), a = num(aa);
  const m = f || c || a;
  if (a > 0 && m > a * 100) return a;
  if (m > 1e10) return a > 0 ? a : 0;
  return m;
}

export function analyticsReady(db: Database.Database): boolean {
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='a_suppliers'`).get();
  return !!row;
}

export function buildAnalytics(db: Database.Database): Record<string, number> {
  const rx = /\d{10,13}/;
  const t0 = Date.now();
  // Segunda conexión SOLO para escribir: better-sqlite3 no permite escribir en la
  // misma conexión mientras el iterador del scan está abierto (WAL permite 1 writer + N readers).
  const wdb = new DatabaseCtor(db.name);
  wdb.pragma('journal_mode = WAL');
  wdb.exec(`
    DROP TABLE IF EXISTS a_suppliers; DROP TABLE IF EXISTS a_supplier_buyer;
    DROP TABLE IF EXISTS a_supplier_year; DROP TABLE IF EXISTS a_buyers;
    DROP TABLE IF EXISTS a_flag_year; DROP TABLE IF EXISTS a_risk_year;
    DROP TABLE IF EXISTS a_supplier_critical; DROP TABLE IF EXISTS a_fts;
    CREATE TABLE a_suppliers (ruc10 TEXT PRIMARY KEY, name TEXT, n_procs INTEGER, total_usd REAL,
      first_year INTEGER, last_year INTEGER, n_buyers INTEGER,
      n_critical INTEGER, n_high INTEGER, n_moderate INTEGER, n_low INTEGER);
    CREATE TABLE a_supplier_buyer (ruc10 TEXT, buyer_id TEXT, buyer_name TEXT,
      n_procs INTEGER, total_usd REAL, last_year INTEGER, PRIMARY KEY (ruc10, buyer_id));
    CREATE TABLE a_supplier_year (ruc10 TEXT, year INTEGER, n_procs INTEGER, total_usd REAL,
      PRIMARY KEY (ruc10, year));
    CREATE TABLE a_buyers (buyer_id TEXT PRIMARY KEY, name TEXT, n_procs INTEGER, total_usd REAL,
      first_year INTEGER, last_year INTEGER);
    CREATE TABLE a_flag_year (code TEXT, year INTEGER, n INTEGER, PRIMARY KEY (code, year));
    CREATE TABLE a_risk_year (risk TEXT, year INTEGER, n INTEGER, total_usd REAL, PRIMARY KEY (risk, year));
    CREATE TABLE a_supplier_critical (ruc10 TEXT, ocid TEXT, score INTEGER, risk_level TEXT,
      year INTEGER, monto_usd REAL);
    CREATE VIRTUAL TABLE a_fts USING fts5(ocid UNINDEXED, texto);
  `);

  type Sup = { name: string; n: number; t: number; fy: number; ly: number; buyers: Set<string>;
               crit: number; high: number; mod: number; low: number; top: { ocid: string; score: number; rl: string; y: number; m: number }[] };
  const sup = new Map<string, Sup>();
  const sb = new Map<string, [string, number, number, number]>();
  const sy = new Map<string, [number, number]>();
  const buy = new Map<string, [string, number, number, number, number]>();
  const ry = new Map<string, [number, number]>();
  const fy = new Map<string, number>();

  const scan = db.prepare(`SELECT id, flags, risk_level, score, source_year, buyer_id, buyer_name,
    description, title, final_amount, contract_amount, award_amount, suppliers FROM procedures`);

  // CLAVE: ninguna escritura mientras el iterador de lectura está abierto. Un lector
  // activo bloquea el checkpoint del WAL y los inserts masivos del FTS inflan el WAL
  // hasta llenar el disco (visto en Railway: "disk I/O error"). Se acumula en memoria
  // y se escribe todo al cerrar el scan, con checkpoints entre tablas.
  let n = 0;
  const ftsRows: [string, string][] = [];

  for (const row of scan.iterate() as any) {
    n++;
    const monto = montoPlausible(row.final_amount, row.contract_amount, row.award_amount);
    const yr = row.source_year || 0;
    const rl = row.risk_level || 'low';
    const names: string[] = [];

    if (row.suppliers && row.suppliers !== '[]') {
      let arr: any[] = [];
      try { arr = JSON.parse(row.suppliers); } catch { arr = []; }
      // RUC10 único por proceso: misma semántica que el patch incremental del updater
      // (consorcios matriz+sucursal comparten los primeros 10 dígitos y contarían doble).
      const seenR10 = new Set<string>();
      for (const s of arr) {
        const m = rx.exec(s.id || '');
        if (!m) continue;
        const r10 = m[0].slice(0, 10);
        if (seenR10.has(r10)) continue;
        seenR10.add(r10);
        names.push(s.name || '');
        let rec = sup.get(r10);
        if (!rec) { rec = { name: s.name || '', n: 0, t: 0, fy: yr, ly: yr, buyers: new Set(), crit: 0, high: 0, mod: 0, low: 0, top: [] }; sup.set(r10, rec); }
        rec.n++; rec.t += monto;
        if (yr) { rec.fy = Math.min(rec.fy || yr, yr); rec.ly = Math.max(rec.ly, yr); }
        if (row.buyer_id) rec.buyers.add(row.buyer_id);
        if (rl === 'critical') rec.crit++; else if (rl === 'high') rec.high++;
        else if (rl === 'moderate') rec.mod++; else rec.low++;
        if ((rl === 'critical' || rl === 'high') && rec.top.length < 40) {
          rec.top.push({ ocid: row.id, score: row.score || 0, rl, y: yr, m: monto });
        }
        const kb = r10 + '|' + (row.buyer_id || '');
        const vb = sb.get(kb);
        if (!vb) sb.set(kb, [row.buyer_name || '', 1, monto, yr]);
        else { vb[1]++; vb[2] += monto; vb[3] = Math.max(vb[3], yr); }
        const ky = r10 + '|' + yr;
        const vy = sy.get(ky);
        if (!vy) sy.set(ky, [1, monto]); else { vy[0]++; vy[1] += monto; }
      }
    }
    if (row.buyer_id) {
      const vb = buy.get(row.buyer_id);
      if (!vb) buy.set(row.buyer_id, [row.buyer_name || '', 1, monto, yr, yr]);
      else { vb[1]++; vb[2] += monto; if (yr) { vb[3] = Math.min(vb[3] || yr, yr); vb[4] = Math.max(vb[4], yr); } }
    }
    const kr = rl + '|' + yr;
    const vr = ry.get(kr);
    if (!vr) ry.set(kr, [1, monto]); else { vr[0]++; vr[1] += monto; }
    if (row.flags && row.flags !== '[]') {
      try {
        for (const f of JSON.parse(row.flags)) {
          const kf = (f.code || '?') + '|' + yr;
          fy.set(kf, (fy.get(kf) || 0) + 1);
        }
      } catch { /* flags ilegibles: se omiten del conteo */ }
    }
    const texto = [(row.description || row.title || '').slice(0, 400), row.buyer_name || '', names.join(' ')]
      .filter(Boolean).join(' ');
    if (texto.trim()) ftsRows.push([row.id, texto]);
  }

  // Scan cerrado: ahora sí, escrituras por lotes con WAL acotado.
  const insFts = wdb.prepare(`INSERT INTO a_fts (ocid, texto) VALUES (?, ?)`);
  const ftsTx = wdb.transaction((rows: [string, string][]) => { for (const r of rows) insFts.run(r[0], r[1]); });
  for (let i = 0; i < ftsRows.length; i += 50000) {
    ftsTx(ftsRows.slice(i, i + 50000));
    wdb.pragma('wal_checkpoint(TRUNCATE)');
  }
  ftsRows.length = 0;

  const insSup = wdb.prepare(`INSERT INTO a_suppliers VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const insCrit = wdb.prepare(`INSERT INTO a_supplier_critical VALUES (?,?,?,?,?,?)`);
  wdb.transaction(() => {
    for (const [r10, v] of sup) {
      insSup.run(r10, v.name, v.n, Math.round(v.t * 100) / 100, v.fy, v.ly, v.buyers.size, v.crit, v.high, v.mod, v.low);
      v.top.sort((a, b) => b.score - a.score);
      for (const t of v.top.slice(0, 5)) insCrit.run(r10, t.ocid, t.score, t.rl, t.y, Math.round(t.m * 100) / 100);
    }
  })();
  wdb.pragma('wal_checkpoint(TRUNCATE)');
  const insSb = wdb.prepare(`INSERT INTO a_supplier_buyer VALUES (?,?,?,?,?,?)`);
  wdb.transaction(() => {
    for (const [k, v] of sb) {
      const [r10, bid] = k.split('|');
      insSb.run(r10, bid, v[0], v[1], Math.round(v[2] * 100) / 100, v[3]);
    }
  })();
  wdb.pragma('wal_checkpoint(TRUNCATE)');
  const insSy = wdb.prepare(`INSERT INTO a_supplier_year VALUES (?,?,?,?)`);
  const insBuy = wdb.prepare(`INSERT INTO a_buyers VALUES (?,?,?,?,?,?)`);
  const insRy = wdb.prepare(`INSERT INTO a_risk_year VALUES (?,?,?,?)`);
  const insFy = wdb.prepare(`INSERT INTO a_flag_year VALUES (?,?,?)`);
  wdb.transaction(() => {
    for (const [k, v] of sy) { const [r10, y] = k.split('|'); insSy.run(r10, Number(y), v[0], Math.round(v[1] * 100) / 100); }
    for (const [bid, v] of buy) insBuy.run(bid, v[0], v[1], Math.round(v[2] * 100) / 100, v[3], v[4]);
    for (const [k, v] of ry) { const [r, y] = k.split('|'); insRy.run(r, Number(y), v[0], Math.round(v[1] * 100) / 100); }
    for (const [k, v] of fy) { const [c, y] = k.split('|'); insFy.run(c, Number(y), v); }
  })();
  wdb.exec(`
    CREATE INDEX IF NOT EXISTS idx_a_sup_total ON a_suppliers(total_usd DESC);
    CREATE INDEX IF NOT EXISTS idx_a_sup_n ON a_suppliers(n_procs DESC);
    CREATE INDEX IF NOT EXISTS idx_a_sup_name ON a_suppliers(name);
    CREATE INDEX IF NOT EXISTS idx_a_sb_buyer ON a_supplier_buyer(buyer_id);
    CREATE INDEX IF NOT EXISTS idx_a_sy_year ON a_supplier_year(year);
    CREATE INDEX IF NOT EXISTS idx_a_buy_total ON a_buyers(total_usd DESC);
    CREATE INDEX IF NOT EXISTS idx_a_crit_sup ON a_supplier_critical(ruc10);
  `);
  wdb.pragma('wal_checkpoint(TRUNCATE)');
  wdb.close();
  return { procesos: n, proveedores: sup.size, compradores: buy.size, segundos: Math.round((Date.now() - t0) / 1000) };
}

// ── Herramientas ─────────────────────────────────────────────
const digits = (s: string) => (s || '').replace(/\D/g, '');

const TOOLS = [
  { name: 'oicp_info', description: 'Información general del dataset OICP: cobertura, conteos, distribución de riesgo y convenciones. Empieza aquí.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'oicp_methodology', description: 'Metodología determinística verificada: 15 banderas con umbrales exactos, pesos, correlaciones y escala de riesgo. Cita SIEMPRE estos parámetros al explicar un score; no inventes umbrales.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'oicp_top_suppliers', description: "Top proveedores del Estado ('quién ha contratado más'). metric: 'monto' o 'procesos'; year opcional.",
    inputSchema: { type: 'object', properties: { metric: { type: 'string', enum: ['monto', 'procesos'] }, year: { type: 'integer' }, limit: { type: 'integer' } } } },
  { name: 'oicp_top_buyers', description: 'Top entidades compradoras por monto total o número de procesos.',
    inputSchema: { type: 'object', properties: { metric: { type: 'string', enum: ['monto', 'procesos'] }, limit: { type: 'integer' } } } },
  { name: 'oicp_supplier_profile', description: 'Perfil de un proveedor por RUC/cédula o nombre parcial: totales, riesgo, compradores top, serie anual y ejemplos críticos.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'oicp_buyer_profile', description: 'Perfil de una entidad compradora por RUC o nombre parcial: totales, proveedores top y distribución de riesgo.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'oicp_search', description: 'Búsqueda de texto libre en 1.46M procesos (objeto, entidad, proveedor). Filtros opcionales year y risk_level.',
    inputSchema: { type: 'object', properties: { texto: { type: 'string' }, year: { type: 'integer' }, risk_level: { type: 'string', enum: ['low', 'moderate', 'high', 'critical'] }, limit: { type: 'integer' } }, required: ['texto'] } },
  { name: 'oicp_process', description: 'Detalle completo de un proceso por ocid: datos, banderas con explicación, score y links.',
    inputSchema: { type: 'object', properties: { ocid: { type: 'string' } }, required: ['ocid'] } },
  { name: 'oicp_flag_stats', description: 'Estadísticas de banderas: disparos por indicador y distribución de riesgo, global o por año.',
    inputSchema: { type: 'object', properties: { year: { type: 'integer' } } } },
  { name: 'oicp_sql', description: `Consulta SQL de SOLO LECTURA (SELECT/WITH). Tablas: procedures(id, ocid, title, description, buyer_id, buyer_name, procurement_method_details, budget_amount, award_amount, contract_amount, final_amount, published_date, source_year, suppliers JSON, flags JSON, score, risk_level), concentration_index(buyer_id, supplier_id, year, contract_count, total_value, infima_count, infima_total_value, share_of_buyer). Agregados: a_suppliers(ruc10,name,n_procs,total_usd,first_year,last_year,n_buyers,n_critical,n_high,n_moderate,n_low), a_supplier_buyer, a_supplier_year, a_buyers, a_flag_year(code,year,n), a_risk_year(risk,year,n,total_usd), a_supplier_critical, a_fts(FTS5). ${MONTO_NOTA} Máximo 300 filas.`,
    inputSchema: { type: 'object', properties: { sql: { type: 'string' }, max_rows: { type: 'integer' } }, required: ['sql'] } },
];

const METHODOLOGY = {
  verificado: 'Auditoría 2026-07-09/10: score y risk_level recomputados sobre 1,460,511 procesos con 0 discrepancias; correlaciones independientes del orden desde 2026-07-10.',
  pesos_por_severidad: { '0 (Info)': 3, '1 (Baja)': 8, '2 (Media)': 18, '3 (Alta)': 30 },
  escala_riesgo: { low: 'score 0-10', moderate: '11-30', high: '31-60', critical: '61-100' },
  correlaciones: 'En los pares IC-01+IC-02, CC-01+CC-05 e IP-01+CC-05 la segunda bandera pondera al 50% (una sola vez) si la primera está activa.',
  umbral_infima_cuantia_usd: { 2019: 7105.88, 2020: 7099.68, 2021: 6416.07, 2022: 6779.95, 2023: 6300.57, 2024: 6658.78, '2025 antes del 7-oct': 7212.60, 'desde 2025-10-07 (LOSNCP reformada)': 10000.0 },
  banderas: {
    'IC-01': { nombre: 'Proveedor único en proceso competitivo', peso: 18, regla: 'método competitivo y 1 solo oferente' },
    'IC-02': { nombre: 'Alto valor sin competencia', peso: 30, regla: 'directa/ínfima con monto > umbral del año' },
    'IT-01': { nombre: 'Plazo de publicación insuficiente', peso: 8, regla: 'días hábiles pub→cierre < mínimo (9/13/17 por monto) en procesos >10k' },
    'IT-02': { nombre: 'Adjudicación relámpago', peso: 18, regla: '< 3 días hábiles publicación→adjudicación (excluye ínfima)' },
    'IP-01': { nombre: 'Valor cercano al umbral de ínfima', peso: 18, regla: 'monto entre 85% y 100% del umbral' },
    'IP-02': { nombre: 'Diferencia presupuesto vs adjudicación', peso: 18, regla: '|adjudicado−presupuesto|/presupuesto > 15%' },
    'IP-03': { nombre: 'Modificación contractual significativa', peso: 30, regla: 'enmiendas +15%. INACTIVA: SERCOP no publica enmiendas (0 casos)' },
    'CC-01': { nombre: 'Proveedor recurrente en ínfima', peso: 30, regla: 'ínfima por monto y 5+ ínfimas del par comprador-proveedor en el año' },
    'CC-02': { nombre: 'Proveedor dominante', peso: 30, regla: '>40% del gasto del comprador (compradores con ≥10 procesos)' },
    'CC-03': { nombre: 'Proveedor histórico permanente', peso: 18, regla: '5+ de los últimos 7 años y > $50,000 acumulado' },
    'CC-04': { nombre: 'Miembro recurrente de consorcio', peso: 18, regla: '2+ procesos-consorcio del mismo comprador' },
    'CC-05': { nombre: 'Posible fraccionamiento', peso: 30, regla: '2+ ínfimas cuya suma anual supera el umbral' },
    'TR-01': { nombre: 'Información incompleta crítica', peso: 8, regla: 'falta comprador, valor, proveedor o método' },
    'TR-02': { nombre: 'Descripción genérica', peso: 3, regla: 'descripción < 30 caracteres' },
    'TR-03': { nombre: 'Sin justificación de régimen especial', peso: 18, regla: 'régimen especial/emergente/directa (o prefijo RE-) con monto > umbral' },
  },
  exclusion_catalogo: 'Las banderas CC-* no se evalúan en catálogo electrónico (compra centralizada precalificada por SERCOP).',
  disclaimer: DISCLAIMER,
};

const MONTO_SQL = `COALESCE(NULLIF(final_amount,0), NULLIF(contract_amount,0), NULLIF(award_amount,0), 0)`;

export function callTool(db: Database.Database, name: string, args: any): any {
  if (!analyticsReady(db) && name !== 'oicp_methodology') {
    return { error: 'Agregados no construidos todavía. El administrador debe ejecutar /api/admin/build-analytics.' };
  }
  switch (name) {
    case 'oicp_info': {
      const n = (db.prepare(`SELECT COUNT(*) AS n FROM procedures`).get() as any).n;
      const years = db.prepare(`SELECT MIN(source_year) AS a, MAX(source_year) AS b FROM procedures`).get() as any;
      const risk: any = {};
      for (const r of db.prepare(`SELECT risk, SUM(n) AS n FROM a_risk_year GROUP BY risk`).all() as any[]) risk[r.risk] = r.n;
      const nsup = (db.prepare(`SELECT COUNT(*) AS n FROM a_suppliers`).get() as any).n;
      const nbuy = (db.prepare(`SELECT COUNT(*) AS n FROM a_buyers`).get() as any).n;
      return { plataforma: `${PROD} (acceso por invitación)`, procesos: n, rango_anios: `${years.a}-${years.b}`,
        corte_datos: '2026-05-14', proveedores_unicos: nsup, compradores_unicos: nbuy,
        distribucion_riesgo: risk, convencion_monto: MONTO_NOTA,
        nota: 'Usa oicp_methodology para indicadores, pesos y umbrales verificados.', disclaimer: DISCLAIMER };
    }
    case 'oicp_methodology':
      return METHODOLOGY;
    case 'oicp_top_suppliers': {
      const limit = Math.max(1, Math.min(Number(args?.limit) || 20, 100));
      const order = args?.metric === 'procesos' ? 'n_procs' : 'total_usd';
      let rows: any[];
      if (args?.year) {
        rows = db.prepare(`SELECT s.ruc10, s.name, y.n_procs, y.total_usd FROM a_supplier_year y
          JOIN a_suppliers s USING (ruc10) WHERE y.year = ? ORDER BY y.${order} DESC LIMIT ?`).all(args.year, limit) as any[];
      } else {
        rows = db.prepare(`SELECT ruc10, name, n_procs, total_usd, first_year, last_year, n_buyers,
          n_critical, n_high FROM a_suppliers ORDER BY ${order} DESC LIMIT ?`).all(limit) as any[];
      }
      for (const r of rows) r.perfil = `${PROD}/proveedor/${r.ruc10}`;
      return { metric: args?.metric || 'monto', year: args?.year || '2019-2026 acumulado', convencion: MONTO_NOTA, top: rows, disclaimer: DISCLAIMER };
    }
    case 'oicp_top_buyers': {
      const limit = Math.max(1, Math.min(Number(args?.limit) || 20, 100));
      const order = args?.metric === 'procesos' ? 'n_procs' : 'total_usd';
      const rows = db.prepare(`SELECT buyer_id, name, n_procs, total_usd, first_year, last_year
        FROM a_buyers ORDER BY ${order} DESC LIMIT ?`).all(limit);
      return { metric: args?.metric || 'monto', convencion: MONTO_NOTA, top: rows, disclaimer: DISCLAIMER };
    }
    case 'oicp_supplier_profile': {
      const q = String(args?.query || '');
      const d = digits(q);
      let row: any;
      if (d.length >= 10) row = db.prepare(`SELECT * FROM a_suppliers WHERE ruc10 = ?`).get(d.slice(0, 10));
      else row = db.prepare(`SELECT * FROM a_suppliers WHERE name LIKE ? ORDER BY total_usd DESC`).get(`%${q.toUpperCase()}%`);
      if (!row) return { error: `Proveedor no encontrado: '${q}'. Prueba con el RUC o un fragmento del nombre.` };
      row.compradores_top = db.prepare(`SELECT buyer_name, buyer_id, n_procs, total_usd, last_year
        FROM a_supplier_buyer WHERE ruc10 = ? ORDER BY n_procs DESC LIMIT 10`).all(row.ruc10);
      row.serie_anual = db.prepare(`SELECT year, n_procs, total_usd FROM a_supplier_year WHERE ruc10 = ? ORDER BY year`).all(row.ruc10);
      row.procesos_criticos_ejemplo = db.prepare(`SELECT ocid, score, risk_level, year, monto_usd
        FROM a_supplier_critical WHERE ruc10 = ? ORDER BY score DESC LIMIT 5`).all(row.ruc10);
      row.perfil_web = `${PROD}/proveedor/${row.ruc10}`;
      row.convencion = MONTO_NOTA; row.disclaimer = DISCLAIMER;
      return row;
    }
    case 'oicp_buyer_profile': {
      const q = String(args?.query || '');
      const d = digits(q);
      let row: any;
      if (d.length >= 10) row = db.prepare(`SELECT * FROM a_buyers WHERE buyer_id LIKE ? ORDER BY total_usd DESC`).get(`%${d}%`);
      else row = db.prepare(`SELECT * FROM a_buyers WHERE name LIKE ? ORDER BY total_usd DESC`).get(`%${q.toUpperCase()}%`);
      if (!row) row = db.prepare(`SELECT * FROM a_buyers WHERE name LIKE ? ORDER BY total_usd DESC`).get(`%${q}%`);
      if (!row) return { error: `Comprador no encontrado: '${q}'` };
      row.proveedores_top = db.prepare(`SELECT s.name, sb.ruc10, sb.n_procs, sb.total_usd FROM a_supplier_buyer sb
        JOIN a_suppliers s USING (ruc10) WHERE sb.buyer_id = ? ORDER BY sb.total_usd DESC LIMIT 10`).all(row.buyer_id);
      const risk: any = {};
      for (const r of db.prepare(`SELECT risk_level, COUNT(*) AS n FROM procedures WHERE buyer_id = ? GROUP BY risk_level`).all(row.buyer_id) as any[]) risk[r.risk_level] = r.n;
      row.riesgo = risk;
      row.perfil_web = `${PROD}/comprador/${row.buyer_id}`;
      row.convencion = MONTO_NOTA; row.disclaimer = DISCLAIMER;
      return row;
    }
    case 'oicp_search': {
      const texto = String(args?.texto || '').trim();
      if (!texto) return { error: 'texto requerido' };
      const limit = Math.max(1, Math.min(Number(args?.limit) || 20, 100));
      // AND por término (no frase exacta): cada palabra entre comillas para FTS5.
      const match = texto.replace(/"/g, ' ').trim().split(/\s+/).map(t => `"${t}"`).join(' ');
      let hits: string[] = [];
      const hasFts = !!db.prepare(`SELECT name FROM sqlite_master WHERE name = 'a_fts'`).get();
      if (hasFts) {
        hits = (db.prepare(`SELECT ocid FROM a_fts WHERE a_fts MATCH ? LIMIT 400`).all(match) as any[]).map(r => r.ocid);
      }
      if (!hits.length) {
        // Fallback sin FTS: LIKE sobre descripcion/comprador (mas lento, acotado).
        const like = `%${texto.split(/\s+/)[0]}%`;
        hits = (db.prepare(`SELECT id FROM procedures WHERE description LIKE ? OR buyer_name LIKE ? LIMIT 200`)
          .all(like, like) as any[]).map(r => r.id);
      }
      if (!hits.length) return { resultados: [], nota: `Sin coincidencias para '${texto}'. Prueba con menos palabras.` };
      let cond = `id IN (${hits.map(() => '?').join(',')})`;
      const params: any[] = [...hits];
      if (args?.year) { cond += ' AND source_year = ?'; params.push(args.year); }
      if (args?.risk_level) { cond += ' AND risk_level = ?'; params.push(args.risk_level); }
      params.push(limit);
      const rows = db.prepare(`SELECT id AS ocid, substr(COALESCE(description, title), 1, 180) AS objeto,
        buyer_name, source_year, risk_level, score, ${MONTO_SQL} AS monto_usd
        FROM procedures WHERE ${cond} ORDER BY score DESC, monto_usd DESC LIMIT ?`).all(...params) as any[];
      for (const r of rows) r.detalle = `${PROD}/proceso/${r.ocid}`;
      return { busqueda: texto, coincidencias: hits.length, mostrados: rows.length, resultados: rows, disclaimer: DISCLAIMER };
    }
    case 'oicp_process': {
      const ocid = String(args?.ocid || '');
      const row = db.prepare(`SELECT * FROM procedures WHERE id = ? OR ocid = ?`).get(ocid, ocid) as any;
      if (!row) return { error: `Proceso no encontrado: ${ocid}` };
      try {
        row.flags = JSON.parse(row.flags || '[]').map((f: any) => ({ code: f.code, nombre: f.name_es, severidad: f.severity, detalle: f.detail }));
      } catch { /* flags como texto crudo */ }
      delete row.created_at; delete row.updated_at;
      row.links = { oicp: `${PROD}/proceso/${row.id}`,
        sercop_ocds: `https://datosabiertos.compraspublicas.gob.ec/PLATAFORMA/api/record?ocid=${row.ocid}` };
      row.disclaimer = DISCLAIMER;
      return row;
    }
    case 'oicp_flag_stats': {
      const flags: any = {}; const risk: any = {};
      if (args?.year) {
        for (const r of db.prepare(`SELECT code, n FROM a_flag_year WHERE year = ? ORDER BY n DESC`).all(args.year) as any[]) flags[r.code] = r.n;
        for (const r of db.prepare(`SELECT risk, n, total_usd FROM a_risk_year WHERE year = ?`).all(args.year) as any[]) risk[r.risk] = { n: r.n, monto_usd: r.total_usd };
      } else {
        for (const r of db.prepare(`SELECT code, SUM(n) AS n FROM a_flag_year GROUP BY code ORDER BY n DESC`).all() as any[]) flags[r.code] = r.n;
        for (const r of db.prepare(`SELECT risk, SUM(n) AS n, SUM(total_usd) AS t FROM a_risk_year GROUP BY risk`).all() as any[]) risk[r.risk] = { n: r.n, monto_usd: r.t };
      }
      return { year: args?.year || '2019-2026', disparos_por_bandera: flags, riesgo: risk, disclaimer: DISCLAIMER };
    }
    case 'oicp_sql': {
      const sql = String(args?.sql || '');
      if (!/^\s*(select|with)\b/i.test(sql)) return { error: 'Solo consultas SELECT o WITH.' };
      const maxRows = Math.max(1, Math.min(Number(args?.max_rows) || 200, 300));
      let stmt;
      try { stmt = db.prepare(sql); } catch (e: any) { return { error: `SQL error: ${e.message}` }; }
      if (!stmt.reader || !stmt.readonly) return { error: 'La consulta debe ser de solo lectura y devolver filas.' };
      const out: any[] = [];
      let truncated = false;
      for (const row of stmt.iterate()) {
        if (out.length >= maxRows) { truncated = true; break; }
        out.push(row);
      }
      return { filas: out.length, truncado: truncated, data: out, disclaimer: DISCLAIMER };
    }
    default:
      return { error: `Herramienta desconocida: ${name}` };
  }
}

// ── JSON-RPC (MCP streamable HTTP, modo JSON stateless) ──────
export function handleMcpMessage(db: Database.Database, msg: any): any | null {
  const id = msg?.id;
  const method = msg?.method;
  if (method === 'initialize') {
    const requested = msg?.params?.protocolVersion;
    const supported = ['2025-06-18', '2025-03-26', '2024-11-05'];
    return { jsonrpc: '2.0', id, result: {
      protocolVersion: supported.includes(requested) ? requested : '2025-03-26',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'oicp', title: 'OICP — Contratación Pública Ecuador', version: '1.0.0' },
      instructions: 'Observatorio de contratación pública del Ecuador (1.46M procesos SERCOP 2019-2026, corte 2026-05-14). Usa oicp_info y oicp_methodology antes de interpretar scores. Los indicadores son señales, no pruebas de irregularidad.',
    } };
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return null; // notificación: sin respuesta
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  if (method === 'tools/call') {
    const { name, arguments: args } = msg?.params || {};
    let result: any;
    try { result = callTool(db, name, args || {}); }
    catch (e: any) { result = { error: `Error interno: ${e.message}` }; }
    return { jsonrpc: '2.0', id, result: {
      content: [{ type: 'text', text: JSON.stringify(result, null, 1) }],
      isError: !!(result && result.error),
    } };
  }
  if (id === undefined || id === null) return null; // notificación desconocida
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
}
