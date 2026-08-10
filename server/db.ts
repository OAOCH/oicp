import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'oicp.db');

// ── Recuperación de arranque ─────────────────────────────────
// Un build de agregados interrumpido puede dejar un WAL gigante (llenó el disco
// del volumen en Railway y la app no podía ni arrancar). Un WAL legítimo pesa KBs;
// >200MB en el boot (sin ningún otro proceso usando la base) es basura de una
// corrida interrumpida: se descarta y la base vuelve al último checkpoint.
function bootRecovery(dbPath: string) {
  try {
    const wal = dbPath + '-wal';
    if (fs.existsSync(wal)) {
      const mb = fs.statSync(wal).size / 1e6;
      if (mb > 200) {
        console.warn(`[boot] WAL de ${mb.toFixed(0)}MB detectado: descartando (rollback al último checkpoint)`);
        fs.unlinkSync(wal);
        try { fs.unlinkSync(dbPath + '-shm'); } catch { /* shm puede no existir */ }
      }
    }
  } catch (e: any) {
    console.warn(`[boot] recovery WAL: ${e.message}`);
  }
}
bootRecovery(DB_PATH);

// Apertura a prueba de corrupción: si el archivo está dañado (p.ej. checkpoint
// interrumpido por disco lleno), se APARTA (rename, no se borra) y se arranca con
// una base vacía para que la plataforma vuelva a estar arriba; los datos se
// restauran luego vía /api/admin/restore-from-url o upload-db.
function openWithFailover(dbPath: string): Database.Database {
  let d: Database.Database | null = null;
  try {
    d = new Database(dbPath);
    d.pragma('journal_mode = WAL');
    d.pragma('foreign_keys = ON');
    // fuerza una lectura real del esquema para detectar corrupción al abrir
    d.prepare(`SELECT name FROM sqlite_master LIMIT 1`).get();
    return d;
  } catch (e: any) {
    console.error(`[boot] base dañada (${e.code || e.message}): se aparta y se arranca vacía`);
    // cerrar la conexión a medio abrir ANTES de renombrar (si no, EBUSY en Windows)
    try { d?.close(); } catch { /* ya cerrada */ }
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      if (fs.existsSync(dbPath)) fs.renameSync(dbPath, `${dbPath}.corrupt-${stamp}`);
      for (const suf of ['-wal', '-shm']) {
        try { fs.unlinkSync(dbPath + suf); } catch { /* puede no existir */ }
      }
    } catch (e2: any) {
      console.error(`[boot] no se pudo apartar la base dañada: ${e2.message}`);
    }
    const fresh = new Database(dbPath);
    fresh.pragma('journal_mode = WAL');
    fresh.pragma('foreign_keys = ON');
    return fresh;
  }
}

let db = openWithFailover(DB_PATH);

// Si quedó un build de agregados a medias, se descarta para liberar páginas.
try {
  const hasFts = db.prepare(`SELECT name FROM sqlite_master WHERE name = 'a_fts'`).get();
  const buyersRow = db.prepare(`SELECT name FROM sqlite_master WHERE name = 'a_buyers'`).get();
  const buyersOk = buyersRow && (db.prepare(`SELECT COUNT(*) AS n FROM a_buyers`).get() as any).n > 0;
  if (hasFts && !buyersOk) {
    console.warn('[boot] build de agregados incompleto: descartando tablas a_*');
    db.exec(`DROP TABLE IF EXISTS a_fts; DROP TABLE IF EXISTS a_suppliers;
             DROP TABLE IF EXISTS a_supplier_buyer; DROP TABLE IF EXISTS a_supplier_year;
             DROP TABLE IF EXISTS a_buyers; DROP TABLE IF EXISTS a_flag_year;
             DROP TABLE IF EXISTS a_risk_year; DROP TABLE IF EXISTS a_supplier_critical;`);
    db.pragma('wal_checkpoint(TRUNCATE)');
  }
} catch (e: any) {
  console.warn(`[boot] limpieza de agregados incompletos: ${e.message}`);
}

// Cierra la conexión actual para permitir renombrar el archivo (Windows bloquea
// rename sobre archivos abiertos; en Linux es válido pero cerrar es más limpio).
export function closeDbForReplace() {
  try { db.close(); } catch { /* ya cerrada */ }
}

export function replaceDatabase(newPath?: string) {
  try { db.close(); } catch {}
  const p = newPath || DB_PATH;
  db = new Database(p);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate();
}

export function getDb() { return db; }

// ── Schema ──────────────────────────────────────────────────
export function migrate() {
  migrateInternal();
}

// Sana el esquema de bases pre-existentes (p.ej. restauradas desde una réplica
// vieja): agrega las columnas que el código actual escribe pero la tabla no tiene.
function healSchema() {
  try {
    const cols = new Set((db.prepare(`PRAGMA table_info(procedures)`).all() as any[]).map(c => c.name));
    if (cols.size === 0) return; // la tabla aún no existe: CREATE la definirá completa
    const needed: [string, string][] = [
      ['data_coverage', 'REAL DEFAULT 0'],
      ['raw_release', 'JSON'],
    ];
    for (const [name, type] of needed) {
      if (!cols.has(name)) {
        db.exec(`ALTER TABLE procedures ADD COLUMN ${name} ${type}`);
        console.log(`✓ Schema heal: columna ${name} agregada a procedures`);
      }
    }
  } catch (e: any) {
    console.error(`Schema heal falló (no fatal): ${e.message}`);
  }
}

function migrateInternal() {
  healSchema();
  db.exec(`
    CREATE TABLE IF NOT EXISTS procedures (
      id TEXT PRIMARY KEY,                    -- OCID
      ocid TEXT NOT NULL,
      title TEXT,
      description TEXT,
      status TEXT,                            -- planning|tender|award|contract|complete
      procurement_method TEXT,                -- open|selective|limited|direct
      procurement_method_details TEXT,        -- "Subasta Inversa Electrónica", etc.
      
      -- Buyer
      buyer_id TEXT,
      buyer_name TEXT,
      
      -- Values
      budget_amount REAL,
      budget_currency TEXT DEFAULT 'USD',
      award_amount REAL,
      contract_amount REAL,
      final_amount REAL,
      
      -- Dates
      published_date TEXT,                    -- tender.tenderPeriod.startDate
      submission_deadline TEXT,               -- tender.tenderPeriod.endDate
      award_date TEXT,
      contract_date TEXT,
      
      -- Suppliers (JSON array)
      suppliers JSON DEFAULT '[]',            -- [{id, name}]
      
      -- Tender details
      number_of_tenderers INTEGER,
      items_classification TEXT,              -- CPC code(s)
      
      -- Amendments
      has_amendments INTEGER DEFAULT 0,
      amendment_count INTEGER DEFAULT 0,
      
      -- Flags & scoring
      flags JSON DEFAULT '[]',               -- [{code, severity, active, detail}]
      score INTEGER DEFAULT 0,
      risk_level TEXT DEFAULT 'low',          -- low|moderate|high|critical
      
      -- Coverage
      data_coverage REAL DEFAULT 0,
      
      -- Meta
      source_year INTEGER,
      regime TEXT,                            -- LOSNCP_COEFICIENTES | LOSNCP_REFORMADA
      raw_release JSON,
      
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS concentration_index (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      buyer_id TEXT NOT NULL,
      supplier_id TEXT NOT NULL,
      supplier_name TEXT,
      year INTEGER NOT NULL,
      contract_count INTEGER DEFAULT 0,
      total_value REAL DEFAULT 0,
      infima_count INTEGER DEFAULT 0,
      infima_total_value REAL DEFAULT 0,
      share_of_buyer REAL DEFAULT 0,          -- % del gasto total del comprador
      UNIQUE(buyer_id, supplier_id, year)
    );

    CREATE TABLE IF NOT EXISTS import_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT,
      year INTEGER,
      records_processed INTEGER,
      records_new INTEGER,
      records_updated INTEGER,
      flags_generated INTEGER,
      started_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      status TEXT DEFAULT 'running'
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_proc_buyer ON procedures(buyer_id);
    CREATE INDEX IF NOT EXISTS idx_proc_score ON procedures(score DESC);
    CREATE INDEX IF NOT EXISTS idx_proc_year ON procedures(source_year);
    CREATE INDEX IF NOT EXISTS idx_proc_method ON procedures(procurement_method_details);
    CREATE INDEX IF NOT EXISTS idx_proc_risk ON procedures(risk_level);
    CREATE INDEX IF NOT EXISTS idx_proc_status ON procedures(status);
    CREATE INDEX IF NOT EXISTS idx_proc_date ON procedures(published_date DESC);
    CREATE INDEX IF NOT EXISTS idx_conc_buyer ON concentration_index(buyer_id, year);
    CREATE INDEX IF NOT EXISTS idx_conc_supplier ON concentration_index(supplier_id, year);
  `);
  console.log('✓ Database migrated');
}

// ── Queries ─────────────────────────────────────────────────

// Stats
export function getStatistics() {
  const total = db.prepare('SELECT COUNT(*) as count FROM procedures').get() as any;
  const byRisk = db.prepare(`
    SELECT risk_level, COUNT(*) as count FROM procedures GROUP BY risk_level
  `).all();
  const byMethod = db.prepare(`
    SELECT procurement_method_details as method, COUNT(*) as count 
    FROM procedures WHERE procurement_method_details IS NOT NULL
    GROUP BY procurement_method_details ORDER BY count DESC LIMIT 10
  `).all();
  const avgScore = db.prepare('SELECT AVG(score) as avg, MAX(score) as max FROM procedures').get() as any;
  const totalFlags = db.prepare(`
    SELECT SUM(json_array_length(flags)) as count FROM procedures
  `).get() as any;
  const byYear = db.prepare(`
    SELECT source_year as year, COUNT(*) as count, AVG(score) as avg_score
    FROM procedures GROUP BY source_year ORDER BY source_year
  `).all();
  const topFlags = db.prepare(`
    SELECT 
      json_extract(j.value, '$.code') as code,
      COUNT(*) as count
    FROM procedures, json_each(procedures.flags) as j
    WHERE json_extract(j.value, '$.active') IN (1, 'true')
       OR json_extract(j.value, '$.active') = 1
    GROUP BY code ORDER BY count DESC LIMIT 15
  `).all();
  const recentProcedures = db.prepare(`
    SELECT id, title, buyer_name, award_amount, score, risk_level, published_date
    FROM procedures ORDER BY published_date DESC LIMIT 5
  `).all();

  return {
    totalProcedures: total.count,
    byRisk,
    byMethod,
    averageScore: Math.round(avgScore.avg || 0),
    maxScore: avgScore.max || 0,
    totalFlags: totalFlags.count || 0,
    byYear,
    topFlags,
    recentProcedures,
  };
}

// Search procedures
export function searchProcedures(params: {
  query?: string; page?: number; pageSize?: number;
  riskLevel?: string; method?: string; flag?: string;
  year?: number; minScore?: number; maxScore?: number;
  buyerId?: string; supplierId?: string;
  status?: string;
  sortBy?: string; sortOrder?: string;
}) {
  const { query, riskLevel, method, flag,
    year, minScore, maxScore, buyerId, supplierId, status,
    sortBy = 'score', sortOrder = 'DESC' } = params;
  // Segunda barrera (regla 3): no se confía en el llamador. Un pageSize negativo se
  // traduce en SQLite a LIMIT -1, es decir SIN LÍMITE, y materializa la tabla entera.
  const pageSize = Math.min(Math.max(Math.floor(Number(params.pageSize) || 20), 1), 100);
  const page = Math.max(Math.floor(Number(params.page) || 1), 1);

  const conditions: string[] = [];
  const values: any[] = [];

  if (query) {
    conditions.push(`(title LIKE ? OR description LIKE ? OR buyer_name LIKE ? OR id LIKE ? OR EXISTS (SELECT 1 FROM json_each(suppliers) s WHERE json_extract(s.value, '$.name') LIKE ?))`);
    const q = `%${query}%`;
    values.push(q, q, q, q, q);
  }
  if (riskLevel) { conditions.push('risk_level = ?'); values.push(riskLevel); }
  if (method) { conditions.push('procurement_method_details = ?'); values.push(method); }
  if (year) { conditions.push('source_year = ?'); values.push(year); }
  if (minScore !== undefined) { conditions.push('score >= ?'); values.push(minScore); }
  if (maxScore !== undefined) { conditions.push('score <= ?'); values.push(maxScore); }
  if (buyerId) { conditions.push('buyer_id = ?'); values.push(buyerId); }
  if (status) { conditions.push('status = ?'); values.push(status); }
  if (flag) {
    conditions.push(`EXISTS (SELECT 1 FROM json_each(flags) j WHERE json_extract(j.value, '$.code') = ? AND json_extract(j.value, '$.active') IN (1, 'true'))`);
    values.push(flag);
  }
  if (supplierId) {
    conditions.push(`EXISTS (SELECT 1 FROM json_each(suppliers) s WHERE json_extract(s.value, '$.id') = ?)`);
    values.push(supplierId);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const validSorts = ['score', 'published_date', 'award_amount', 'title'];
  const sort = validSorts.includes(sortBy) ? sortBy : 'score';
  const order = sortOrder === 'ASC' ? 'ASC' : 'DESC';
  const offset = (page - 1) * pageSize;

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM procedures ${where}`).get(...values) as any;
  const rows = db.prepare(`
    SELECT id, ocid, title, buyer_name, buyer_id, procurement_method, procurement_method_details,
           award_amount, score, risk_level, flags, published_date, source_year, number_of_tenderers, suppliers, status
    FROM procedures ${where}
    ORDER BY ${sort} ${order}
    LIMIT ? OFFSET ?
  `).all(...values, pageSize, offset);

  return {
    procedures: rows.map((r: any) => ({ ...r, flags: JSON.parse(r.flags || '[]') })),
    total: countRow.total,
    page, pageSize,
    totalPages: Math.ceil(countRow.total / pageSize),
  };
}

// ── Monto por proceso: FUENTE ÚNICA DE VERDAD ───────────────
// Toda cifra de dinero que ve el usuario (web, rankings, perfiles) y toda la que
// entrega el MCP debe salir de esta misma regla; si no, la plataforma muestra dos
// números distintos para lo mismo y pierde credibilidad ante una auditoría.
// Regla: se toma el primer monto disponible (final > contrato > adjudicado) y se
// descarta cuando es implausible frente al adjudicado (la fuente SERCOP publica
// ~210 contratos con montos absurdos, p. ej. adjudicado $400k y contrato $3 billones).
// Equivalente exacto de montoPlausible() en mcp-server.ts y updater.ts.
export const MONTO_SQL = `CASE
    WHEN COALESCE(award_amount,0) > 0
     AND COALESCE(NULLIF(final_amount,0), NULLIF(contract_amount,0), NULLIF(award_amount,0), 0) > COALESCE(award_amount,0) * 100
      THEN COALESCE(award_amount,0)
    WHEN COALESCE(NULLIF(final_amount,0), NULLIF(contract_amount,0), NULLIF(award_amount,0), 0) > 10000000000
      THEN COALESCE(award_amount,0)
    ELSE COALESCE(NULLIF(final_amount,0), NULLIF(contract_amount,0), NULLIF(award_amount,0), 0)
  END`;

// Get single procedure
export function getProcedure(id: string) {
  const row = db.prepare(`SELECT *, ${MONTO_SQL} AS monto_usd FROM procedures WHERE id = ?`).get(id) as any;
  if (!row) return null;
  // Señala si la fuente trae un contrato/final implausible: la ficha muestra el
  // monto saneado y advierte, en vez de publicar una cifra absurda como si fuera real.
  const crudo = Number(row.final_amount) || Number(row.contract_amount) || Number(row.award_amount) || 0;
  return {
    ...row,
    flags: JSON.parse(row.flags || '[]'),
    suppliers: JSON.parse(row.suppliers || '[]'),
    monto_implausible: crudo > 0 && Math.abs(crudo - Number(row.monto_usd || 0)) > 0.01,
  };
}

// Buyer profile
export function getBuyerProfile(buyerId: string) {
  const info = db.prepare(`
    SELECT buyer_id, buyer_name, COUNT(*) as total_procedures,
           SUM(${MONTO_SQL}) as total_value, AVG(score) as avg_score,
           MAX(score) as max_score
    FROM procedures WHERE buyer_id = ? GROUP BY buyer_id
  `).get(buyerId) as any;
  if (!info) return null;

  const byYear = db.prepare(`
    SELECT source_year as year, COUNT(*) as count, AVG(score) as avg_score, SUM(${MONTO_SQL}) as total_value
    FROM procedures WHERE buyer_id = ? GROUP BY source_year ORDER BY source_year
  `).all(buyerId);

  const topSuppliers = db.prepare(`
    SELECT supplier_id, supplier_name, year, contract_count, total_value, share_of_buyer, infima_count
    FROM concentration_index WHERE buyer_id = ?
    ORDER BY total_value DESC LIMIT 20
  `).all(buyerId);

  const flagDistribution = db.prepare(`
    SELECT json_extract(j.value, '$.code') as code, COUNT(*) as count
    FROM procedures, json_each(procedures.flags) j
    WHERE buyer_id = ? AND json_extract(j.value, '$.active') IN (1, 'true')
    GROUP BY code ORDER BY count DESC
  `).all(buyerId);

  const riskDistribution = db.prepare(`
    SELECT risk_level, COUNT(*) as count FROM procedures WHERE buyer_id = ? GROUP BY risk_level
  `).all(buyerId);

  return { ...info, byYear, topSuppliers, flagDistribution, riskDistribution };
}

// Supplier profile
//
// Los TOTALES salen de los agregados a_* — la misma fuente que usa el MCP en
// oicp_supplier_profile — para que la web y el MCP no puedan dar cifras distintas
// (regla 11). No es una elección de estilo: antes esta función traía las 500 filas más
// recientes y publicaba rows.length como "Contratos" y un reduce de award_amount crudo
// como "Valor Total". Para los proveedores grandes eso era falso por órdenes de
// magnitud (COGECOMSA salía con 500 contratos cuando tiene 497.290) y además ignoraba
// la regla de plausibilidad del monto, así que ROCHE mostraba $109,7 M donde el MCP
// decía $213,0 M. La serie anual también quedaba truncada a los meses más recientes.
//
// La lista de procesos sigue acotada, pero ahora: (a) va rotulada como muestra, nunca
// como total, y (b) se filtra por buyer_id usando idx_proc_buyer en vez de recorrer
// 1,47 M filas con EXISTS(json_each(...)), que no puede usar ningún índice.
export function getSupplierProfile(supplierIdOrName: string) {
  const digitos = (s: string) => (s.match(/\d+/g) || []).join('');
  const hayAgregados = !!db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='a_suppliers'`).get();

  if (!hayAgregados) {
    // Sin agregados no se puede dar un total exacto. Se devuelve la muestra rotulada
    // como tal: es preferible un perfil incompleto y honesto a un total falso.
    return perfilProveedorSoloMuestra(supplierIdOrName);
  }

  const d = digitos(supplierIdOrName);
  let agg: any = null;
  if (d.length >= 10) {
    agg = db.prepare(`SELECT * FROM a_suppliers WHERE ruc10 = ?`).get(d.slice(0, 10));
  }
  if (!agg) {
    agg = db.prepare(`SELECT * FROM a_suppliers WHERE name LIKE ? ORDER BY total_usd DESC`)
      .get(`%${supplierIdOrName.toUpperCase()}%`);
  }
  if (!agg) return null;

  // Serie anual COMPLETA (2019-2026), no solo los meses de la muestra.
  const byYear = (db.prepare(`SELECT year, n_procs AS count, total_usd AS value
    FROM a_supplier_year WHERE ruc10 = ? ORDER BY year DESC`).all(agg.ruc10) as any[]);

  const topBuyers = db.prepare(`SELECT buyer_id, buyer_name, n_procs, total_usd, last_year
    FROM a_supplier_buyer WHERE ruc10 = ? ORDER BY n_procs DESC LIMIT 20`).all(agg.ruc10) as any[];

  // Distribución de riesgo EXACTA sobre todos los procesos del proveedor.
  const riskDistribution = [
    { risk_level: 'critical', count: agg.n_critical || 0 },
    { risk_level: 'high', count: agg.n_high || 0 },
    { risk_level: 'moderate', count: agg.n_moderate || 0 },
    { risk_level: 'low', count: agg.n_low || 0 },
  ].filter(r => r.count > 0);

  // Muestra de procesos acotada por comprador (idx_proc_buyer), no por scan completo.
  const idsComprador = topBuyers.map(b => b.buyer_id).filter(Boolean);
  let muestra: any[] = [];
  if (idsComprador.length) {
    const marcadores = idsComprador.map(() => '?').join(',');
    muestra = db.prepare(`
      SELECT id, title, buyer_id, buyer_name, award_amount, score, risk_level,
             flags, published_date, procurement_method_details, suppliers, source_year, status,
             ${MONTO_SQL} AS monto_usd
      FROM procedures
      WHERE buyer_id IN (${marcadores})
        AND EXISTS (SELECT 1 FROM json_each(suppliers) s
                    WHERE json_extract(s.value, '$.id') LIKE ?)
      ORDER BY published_date DESC
      LIMIT 100
    `).all(...idsComprador, `%${agg.ruc10}%`) as any[];
  }

  const conteoEstado: Record<string, number> = {};
  for (const r of muestra) {
    const s = r.status || 'unknown';
    conteoEstado[s] = (conteoEstado[s] || 0) + 1;
  }
  const byStatus = Object.entries(conteoEstado).map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);

  const concentration = db.prepare(`
    SELECT buyer_id, supplier_name, year, contract_count, total_value, share_of_buyer, infima_count
    FROM concentration_index WHERE supplier_id LIKE ?
    ORDER BY year DESC, total_value DESC LIMIT 200
  `).all(`%${agg.ruc10}%`);

  return {
    supplier: { id: agg.ruc10, name: agg.name },
    totalProcedures: agg.n_procs,          // exacto, de a_suppliers
    totalValue: agg.total_usd,             // exacto, con la regla de plausibilidad
    distinctBuyers: agg.n_buyers,          // exacto
    firstYear: agg.first_year,
    lastYear: agg.last_year,
    riskDistribution,
    byYear,
    topBuyers,
    byStatus,
    // La lista es una MUESTRA: la UI debe rotularla como tal y nunca sumarla.
    procedures: muestra.map((r: any) => ({ ...r, flags: JSON.parse(r.flags || '[]'), suppliers: JSON.parse(r.suppliers || '[]') })),
    muestraProcesos: muestra.length,
    esMuestra: agg.n_procs > muestra.length,
    concentration,
  };
}

// Camino de respaldo para bases sin agregados a_* construidos (p. ej. una base recién
// restaurada). Devuelve la muestra SIN presentarla como total.
function perfilProveedorSoloMuestra(supplierIdOrName: string) {
  const rows = db.prepare(`
    SELECT id, title, buyer_id, buyer_name, award_amount, score, risk_level,
           flags, published_date, procurement_method_details, suppliers, source_year, status,
           ${MONTO_SQL} AS monto_usd
    FROM procedures
    WHERE EXISTS (
      SELECT 1 FROM json_each(suppliers) s
      WHERE json_extract(s.value, '$.id') LIKE ? OR json_extract(s.value, '$.name') LIKE ?
    )
    ORDER BY published_date DESC
    LIMIT 100
  `).all(`%${supplierIdOrName}%`, `%${supplierIdOrName}%`) as any[];
  if (!rows.length) return null;

  let supplierInfo = { id: '', name: '' };
  for (const row of rows) {
    const suppliers = JSON.parse(row.suppliers || '[]');
    const match = suppliers.find((s: any) =>
      s.id?.includes(supplierIdOrName) || s.name?.toLowerCase().includes(supplierIdOrName.toLowerCase()));
    if (match) { supplierInfo = match; break; }
  }

  const conteoEstado: Record<string, number> = {};
  for (const r of rows) { const s = r.status || 'unknown'; conteoEstado[s] = (conteoEstado[s] || 0) + 1; }

  return {
    supplier: supplierInfo,
    totalProcedures: null,                 // desconocido sin agregados: NO inventar
    totalValue: null,
    distinctBuyers: new Set(rows.map((r: any) => r.buyer_id)).size,
    riskDistribution: [],
    byYear: [],
    topBuyers: [],
    byStatus: Object.entries(conteoEstado).map(([status, count]) => ({ status, count })),
    procedures: rows.map((r: any) => ({ ...r, flags: JSON.parse(r.flags || '[]'), suppliers: JSON.parse(r.suppliers || '[]') })),
    muestraProcesos: rows.length,
    esMuestra: true,
    agregadosNoDisponibles: true,
    concentration: [],
  };
}

// Rankings
export function getRankings(type: string = 'buyers', year?: number) {
  const yearFilter = year ? 'AND source_year = ?' : '';
  const yearVal = year ? [year] : [];

  if (type === 'buyers') {
    return db.prepare(`
      SELECT buyer_id, buyer_name, COUNT(*) as procedure_count,
             SUM(${MONTO_SQL}) as total_value, AVG(score) as avg_score,
             MAX(score) as max_score,
             SUM(CASE WHEN risk_level IN ('high','critical') THEN 1 ELSE 0 END) as high_risk_count
      FROM procedures WHERE buyer_id IS NOT NULL ${yearFilter}
      GROUP BY buyer_id ORDER BY avg_score DESC LIMIT 50
    `).all(...yearVal);
  }

  if (type === 'suppliers') {
    return db.prepare(`
      SELECT ci.supplier_id, ci.supplier_name, 
             SUM(ci.contract_count) as total_contracts,
             SUM(ci.total_value) as total_value,
             COUNT(DISTINCT ci.buyer_id) as distinct_buyers,
             SUM(ci.infima_count) as total_infimas,
             MAX(ci.share_of_buyer) as max_concentration
      FROM concentration_index ci
      ${year ? 'WHERE ci.year = ?' : ''}
      GROUP BY ci.supplier_id ORDER BY total_value DESC LIMIT 50
    `).all(...yearVal);
  }

  if (type === 'pairs') {
    return db.prepare(`
      SELECT buyer_id, supplier_id, supplier_name, year,
             contract_count, total_value, share_of_buyer, infima_count
      FROM concentration_index
      ${year ? 'WHERE year = ?' : ''}
      ORDER BY share_of_buyer DESC LIMIT 50
    `).all(...yearVal);
  }

  return [];
}

// Get distinct values for filters
export function getFilterOptions() {
  const methods = db.prepare(`
    SELECT DISTINCT procurement_method_details as value 
    FROM procedures WHERE procurement_method_details IS NOT NULL AND procurement_method_details != '' ORDER BY value
  `).all();
  const years = db.prepare(`
    SELECT DISTINCT source_year as value FROM procedures ORDER BY value DESC
  `).all();
  const statuses = db.prepare(`
    SELECT DISTINCT status as value, COUNT(*) as count FROM procedures 
    WHERE status IS NOT NULL AND status != '' GROUP BY status ORDER BY count DESC
  `).all();
  return { 
    methods: methods.map((m: any) => m.value), 
    years: years.map((y: any) => y.value),
    statuses: statuses.map((s: any) => ({ value: s.value, count: s.count })),
  };
}

// Upsert procedure
export function upsertProcedure(proc: any) {
  const stmt = db.prepare(`
    INSERT INTO procedures (id, ocid, title, description, status, procurement_method, procurement_method_details,
      buyer_id, buyer_name, budget_amount, budget_currency, award_amount, contract_amount, final_amount,
      published_date, submission_deadline, award_date, contract_date, suppliers,
      number_of_tenderers, items_classification, has_amendments, amendment_count,
      flags, score, risk_level, data_coverage, source_year, regime, raw_release, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title, description=excluded.description, status=excluded.status,
      procurement_method=excluded.procurement_method, procurement_method_details=excluded.procurement_method_details,
      buyer_id=excluded.buyer_id, buyer_name=excluded.buyer_name,
      budget_amount=excluded.budget_amount, award_amount=excluded.award_amount,
      contract_amount=excluded.contract_amount, final_amount=excluded.final_amount,
      published_date=excluded.published_date, submission_deadline=excluded.submission_deadline,
      award_date=excluded.award_date, contract_date=excluded.contract_date,
      suppliers=excluded.suppliers, number_of_tenderers=excluded.number_of_tenderers,
      items_classification=excluded.items_classification, has_amendments=excluded.has_amendments,
      amendment_count=excluded.amendment_count, flags=excluded.flags, score=excluded.score,
      risk_level=excluded.risk_level, data_coverage=excluded.data_coverage,
      source_year=excluded.source_year, regime=excluded.regime,
      raw_release=excluded.raw_release, updated_at=datetime('now')
  `);

  stmt.run(
    proc.id, proc.ocid, proc.title, proc.description, proc.status,
    proc.procurement_method, proc.procurement_method_details,
    proc.buyer_id, proc.buyer_name, proc.budget_amount, proc.budget_currency || 'USD',
    proc.award_amount, proc.contract_amount, proc.final_amount,
    proc.published_date, proc.submission_deadline, proc.award_date, proc.contract_date,
    JSON.stringify(proc.suppliers || []),
    proc.number_of_tenderers, proc.items_classification,
    proc.has_amendments ? 1 : 0, proc.amendment_count || 0,
    JSON.stringify(proc.flags || []), proc.score || 0, proc.risk_level || 'low',
    proc.data_coverage || 0, proc.source_year, proc.regime,
    proc.raw_release ? JSON.stringify(proc.raw_release) : null
  );
}

// Update concentration index
export function rebuildConcentrationIndex(year?: number) {
  const yearFilter = year ? 'WHERE source_year = ?' : '';
  const yearVal = year ? [year] : [];

  if (year) {
    db.prepare('DELETE FROM concentration_index WHERE year = ?').run(year);
  } else {
    db.prepare('DELETE FROM concentration_index').run();
  }

  // Identificacion de INFIMA CUANTIA en los datos de SERCOP:
  //   El metodo no contiene la palabra "infima". La infima aparece como:
  //   (a) titulos con prefijo "ORDEN DE COMPRA CE" (catalogo electronico, casi siempre infimas)
  //   (b) procesos con monto adjudicado por debajo del umbral legal del ano
  //   (c) o ambos. Aceptamos cualquiera de los dos para no perder casos.
  // Umbrales por ano (LOSNCP coeficientes hasta oct-2025, USD 10,000 desde reforma)
  db.prepare(`
    INSERT INTO concentration_index (buyer_id, supplier_id, supplier_name, year, contract_count, total_value, infima_count, infima_total_value)
    SELECT
      p.buyer_id,
      json_extract(s.value, '$.id') as supplier_id,
      json_extract(s.value, '$.name') as supplier_name,
      p.source_year as year,
      COUNT(*) as contract_count,
      SUM(COALESCE(p.award_amount, 0)) as total_value,
      SUM(CASE
        WHEN (UPPER(COALESCE(p.procurement_method_details,'')) NOT LIKE '%CATÁLOGO ELECTRÓNICO%'
           AND UPPER(COALESCE(p.procurement_method_details,'')) NOT LIKE '%CATALOGO ELECTRONICO%'
           AND UPPER(COALESCE(p.title,'')) NOT LIKE 'ORDEN DE COMPRA CE%'
           AND COALESCE(p.award_amount, 0) > 0 AND COALESCE(p.award_amount, 0) <=
              CASE
                WHEN p.published_date >= '2025-10-07' THEN 10000.0
                WHEN p.source_year = 2024 THEN 6658.78
                WHEN p.source_year = 2023 THEN 6300.57
                WHEN p.source_year = 2022 THEN 6779.95
                WHEN p.source_year = 2021 THEN 6416.07
                WHEN p.source_year = 2020 THEN 7099.68
                WHEN p.source_year = 2019 THEN 7105.88
                WHEN p.source_year = 2025 THEN 7212.60
                ELSE 10000.0
              END)
        THEN 1 ELSE 0 END) as infima_count,
      SUM(CASE
        WHEN (UPPER(COALESCE(p.procurement_method_details,'')) NOT LIKE '%CATÁLOGO ELECTRÓNICO%'
           AND UPPER(COALESCE(p.procurement_method_details,'')) NOT LIKE '%CATALOGO ELECTRONICO%'
           AND UPPER(COALESCE(p.title,'')) NOT LIKE 'ORDEN DE COMPRA CE%'
           AND COALESCE(p.award_amount, 0) > 0 AND COALESCE(p.award_amount, 0) <=
              CASE
                WHEN p.published_date >= '2025-10-07' THEN 10000.0
                WHEN p.source_year = 2024 THEN 6658.78
                WHEN p.source_year = 2023 THEN 6300.57
                WHEN p.source_year = 2022 THEN 6779.95
                WHEN p.source_year = 2021 THEN 6416.07
                WHEN p.source_year = 2020 THEN 7099.68
                WHEN p.source_year = 2019 THEN 7105.88
                WHEN p.source_year = 2025 THEN 7212.60
                ELSE 10000.0
              END)
        THEN COALESCE(p.award_amount, 0) ELSE 0 END) as infima_total_value
    FROM procedures p, json_each(p.suppliers) s
    ${yearFilter}
    GROUP BY p.buyer_id, supplier_id, p.source_year
  `).run(...yearVal);

  // Calculate share_of_buyer correctly:
  // share = (valor del par buyer+supplier+year) / (gasto total del buyer en ese MISMO year) * 100
  // El bug anterior: la subconsulta no correlacionaba buyer+year, asi que el divisor
  // se inflaba sumando varios anios y el share salia en millones.
  // Fix: usar una CTE con totales por buyer+year y JOIN directo.
  db.prepare(`
    WITH totals AS (
      SELECT buyer_id, year, SUM(total_value) as buyer_year_total
      FROM concentration_index
      GROUP BY buyer_id, year
    )
    UPDATE concentration_index
    SET share_of_buyer = (
      SELECT CASE
        WHEN t.buyer_year_total > 0
        THEN (concentration_index.total_value * 100.0 / t.buyer_year_total)
        ELSE 0
      END
      FROM totals t
      WHERE t.buyer_id = concentration_index.buyer_id
        AND t.year = concentration_index.year
    )
  `).run();

  console.log('✓ Concentration index rebuilt (with corrected share and infima detection)');
}

// Normalize procurement_method from raw text to OCDS categories
export function normalizeProcurementMethods() {
  // First: if procurement_method has long text, it's actually the details field
  // Move it to procurement_method_details if that's empty, then normalize
  db.prepare(`
    UPDATE procedures SET 
      procurement_method_details = procurement_method,
      procurement_method = ''
    WHERE LENGTH(procurement_method) > 20 AND (procurement_method_details IS NULL OR procurement_method_details = '')
  `).run();

  // Now normalize based on procurement_method_details content
  const rules: [string, string][] = [
    ['%ínfima%', 'limited'],
    ['%infima%', 'limited'],
    ['%subasta%', 'open'],
    ['%licitaci%', 'open'],
    ['%cotizaci%', 'open'],
    ['%concurso%', 'open'],
    ['%menor cuantía%', 'limited'],
    ['%catálogo%', 'direct'],
    ['%catalogo%', 'direct'],
    ['%régimen especial%', 'selective'],
    ['%regimen especial%', 'selective'],
    ['%emergent%', 'selective'],
    ['%contratación directa%', 'direct'],
    ['%publicación%', 'open'],
    ['%compra directa%', 'direct'],
    ['%feria inclusiva%', 'open'],
    ['%lista corta%', 'limited'],
    ['%consultor%', 'limited'],
    ['%repuestos%', 'direct'],
    ['%seguros%', 'direct'],
    ['%arrendamiento%', 'direct'],
    ['%comunicación social%', 'direct'],
    ['%obra artística%', 'direct'],
    ['%asesoría%', 'direct'],
    ['%terminación unilateral%', 'selective'],
    ['%giro específico%', 'direct'],
    ['%bien inmueble%', 'direct'],
  ];

  for (const [pattern, method] of rules) {
    db.prepare(`
      UPDATE procedures SET procurement_method = ?
      WHERE (procurement_method IS NULL OR procurement_method = '' OR LENGTH(procurement_method) > 20)
        AND LOWER(COALESCE(procurement_method_details, '') || ' ' || COALESCE(title, '')) LIKE ?
    `).run(method, pattern);
  }

  // Default remaining to 'open'
  db.prepare(`
    UPDATE procedures SET procurement_method = 'open'
    WHERE procurement_method IS NULL OR procurement_method = '' OR LENGTH(procurement_method) > 20
  `).run();

  // Also normalize status from raw SERCOP values
  const statusRules: [string, string][] = [
    ['%adjud%', 'award'],
    ['%cancel%', 'cancelled'],
    ['%desiert%', 'unsuccessful'],
    ['%finaliz%', 'complete'],
    ['%contrat%', 'contract'],
    ['%ejecuci%', 'contract'],
    ['%publicad%', 'tender'],
    ['%recepci%', 'complete'],
    ['%resoluc%', 'award'],
    ['%borrador%', 'planning'],
  ];

  for (const [pattern, status] of statusRules) {
    db.prepare(`
      UPDATE procedures SET status = ?
      WHERE LOWER(status) LIKE ? AND status NOT IN ('planning','tender','award','contract','complete','cancelled','unsuccessful')
    `).run(status, pattern);
  }

  console.log('✓ Procurement methods and statuses normalized');
  return db.prepare(`
    SELECT procurement_method, COUNT(*) as count FROM procedures GROUP BY procurement_method ORDER BY count DESC
  `).all();
}

export default db;
