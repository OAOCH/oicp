import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'oicp.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ──────────────────────────────────────────────────
export function migrate() {
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
      j.value->>'$.code' as code,
      COUNT(*) as count
    FROM procedures, json_each(procedures.flags) as j
    WHERE j.value->>'$.active' = 'true' OR j.value->>'$.active' = '1'
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
  sortBy?: string; sortOrder?: string;
}) {
  const { query, page = 1, pageSize = 20, riskLevel, method, flag,
    year, minScore, maxScore, buyerId, supplierId,
    sortBy = 'score', sortOrder = 'DESC' } = params;

  const conditions: string[] = [];
  const values: any[] = [];

  if (query) {
    conditions.push(`(title LIKE ? OR description LIKE ? OR buyer_name LIKE ? OR id LIKE ?)`);
    const q = `%${query}%`;
    values.push(q, q, q, q);
  }
  if (riskLevel) { conditions.push('risk_level = ?'); values.push(riskLevel); }
  if (method) { conditions.push('procurement_method_details = ?'); values.push(method); }
  if (year) { conditions.push('source_year = ?'); values.push(year); }
  if (minScore !== undefined) { conditions.push('score >= ?'); values.push(minScore); }
  if (maxScore !== undefined) { conditions.push('score <= ?'); values.push(maxScore); }
  if (buyerId) { conditions.push('buyer_id = ?'); values.push(buyerId); }
  if (flag) {
    conditions.push(`EXISTS (SELECT 1 FROM json_each(flags) j WHERE j.value->>'$.code' = ? AND (j.value->>'$.active' = 'true' OR j.value->>'$.active' = '1'))`);
    values.push(flag);
  }
  if (supplierId) {
    conditions.push(`EXISTS (SELECT 1 FROM json_each(suppliers) s WHERE s.value->>'$.id' = ?)`);
    values.push(supplierId);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const validSorts = ['score', 'published_date', 'award_amount', 'title'];
  const sort = validSorts.includes(sortBy) ? sortBy : 'score';
  const order = sortOrder === 'ASC' ? 'ASC' : 'DESC';
  const offset = (page - 1) * pageSize;

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM procedures ${where}`).get(...values) as any;
  const rows = db.prepare(`
    SELECT id, title, buyer_name, buyer_id, procurement_method_details,
           award_amount, score, risk_level, flags, published_date, source_year, number_of_tenderers
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

// Get single procedure
export function getProcedure(id: string) {
  const row = db.prepare('SELECT * FROM procedures WHERE id = ?').get(id) as any;
  if (!row) return null;
  return {
    ...row,
    flags: JSON.parse(row.flags || '[]'),
    suppliers: JSON.parse(row.suppliers || '[]'),
  };
}

// Buyer profile
export function getBuyerProfile(buyerId: string) {
  const info = db.prepare(`
    SELECT buyer_id, buyer_name, COUNT(*) as total_procedures,
           SUM(award_amount) as total_value, AVG(score) as avg_score,
           MAX(score) as max_score
    FROM procedures WHERE buyer_id = ? GROUP BY buyer_id
  `).get(buyerId) as any;
  if (!info) return null;

  const byYear = db.prepare(`
    SELECT source_year as year, COUNT(*) as count, AVG(score) as avg_score, SUM(award_amount) as total_value
    FROM procedures WHERE buyer_id = ? GROUP BY source_year ORDER BY source_year
  `).all(buyerId);

  const topSuppliers = db.prepare(`
    SELECT supplier_id, supplier_name, year, contract_count, total_value, share_of_buyer, infima_count
    FROM concentration_index WHERE buyer_id = ?
    ORDER BY total_value DESC LIMIT 20
  `).all(buyerId);

  const flagDistribution = db.prepare(`
    SELECT j.value->>'$.code' as code, COUNT(*) as count
    FROM procedures, json_each(procedures.flags) j
    WHERE buyer_id = ? AND (j.value->>'$.active' = 'true' OR j.value->>'$.active' = '1')
    GROUP BY code ORDER BY count DESC
  `).all(buyerId);

  const riskDistribution = db.prepare(`
    SELECT risk_level, COUNT(*) as count FROM procedures WHERE buyer_id = ? GROUP BY risk_level
  `).all(buyerId);

  return { ...info, byYear, topSuppliers, flagDistribution, riskDistribution };
}

// Supplier profile  
export function getSupplierProfile(supplierIdOrName: string) {
  // Search by ID in JSON suppliers array, or by name
  const rows = db.prepare(`
    SELECT id, title, buyer_id, buyer_name, award_amount, score, risk_level,
           flags, published_date, procurement_method_details, suppliers, source_year
    FROM procedures
    WHERE EXISTS (
      SELECT 1 FROM json_each(suppliers) s 
      WHERE s.value->>'$.id' LIKE ? OR s.value->>'$.name' LIKE ?
    )
    ORDER BY published_date DESC
    LIMIT 200
  `).all(`%${supplierIdOrName}%`, `%${supplierIdOrName}%`) as any[];

  if (!rows.length) return null;

  // Extract supplier info from first match
  let supplierInfo = { id: '', name: '' };
  for (const row of rows) {
    const suppliers = JSON.parse(row.suppliers || '[]');
    const match = suppliers.find((s: any) =>
      s.id?.includes(supplierIdOrName) || s.name?.toLowerCase().includes(supplierIdOrName.toLowerCase())
    );
    if (match) { supplierInfo = match; break; }
  }

  const totalValue = rows.reduce((sum: number, r: any) => sum + (r.award_amount || 0), 0);
  const avgScore = rows.reduce((sum: number, r: any) => sum + r.score, 0) / rows.length;
  const buyers = [...new Set(rows.map((r: any) => r.buyer_id))];

  const concentration = db.prepare(`
    SELECT buyer_id, supplier_name, year, contract_count, total_value, share_of_buyer, infima_count
    FROM concentration_index WHERE supplier_id LIKE ? OR supplier_name LIKE ?
    ORDER BY year DESC, total_value DESC
  `).all(`%${supplierIdOrName}%`, `%${supplierIdOrName}%`);

  return {
    supplier: supplierInfo,
    totalProcedures: rows.length,
    totalValue,
    averageScore: Math.round(avgScore),
    distinctBuyers: buyers.length,
    procedures: rows.map((r: any) => ({ ...r, flags: JSON.parse(r.flags || '[]'), suppliers: JSON.parse(r.suppliers || '[]') })),
    concentration,
  };
}

// Rankings
export function getRankings(type: string = 'buyers', year?: number) {
  const yearFilter = year ? 'AND source_year = ?' : '';
  const yearVal = year ? [year] : [];

  if (type === 'buyers') {
    return db.prepare(`
      SELECT buyer_id, buyer_name, COUNT(*) as procedure_count,
             SUM(award_amount) as total_value, AVG(score) as avg_score,
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
    FROM procedures WHERE procurement_method_details IS NOT NULL ORDER BY value
  `).all();
  const years = db.prepare(`
    SELECT DISTINCT source_year as value FROM procedures ORDER BY value DESC
  `).all();
  return { methods: methods.map((m: any) => m.value), years: years.map((y: any) => y.value) };
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

  db.prepare(`
    INSERT INTO concentration_index (buyer_id, supplier_id, supplier_name, year, contract_count, total_value, infima_count, infima_total_value)
    SELECT 
      p.buyer_id,
      s.value->>'$.id' as supplier_id,
      s.value->>'$.name' as supplier_name,
      p.source_year as year,
      COUNT(*) as contract_count,
      SUM(p.award_amount) as total_value,
      SUM(CASE WHEN p.procurement_method_details LIKE '%nfima%' THEN 1 ELSE 0 END) as infima_count,
      SUM(CASE WHEN p.procurement_method_details LIKE '%nfima%' THEN COALESCE(p.award_amount, 0) ELSE 0 END) as infima_total_value
    FROM procedures p, json_each(p.suppliers) s
    ${yearFilter}
    GROUP BY p.buyer_id, supplier_id, p.source_year
  `).run(...yearVal);

  // Calculate share_of_buyer
  db.prepare(`
    UPDATE concentration_index SET share_of_buyer = (
      SELECT CASE WHEN buyer_total > 0 THEN (ci_inner.total_value / buyer_total) * 100 ELSE 0 END
      FROM (SELECT buyer_id, SUM(total_value) as buyer_total FROM concentration_index GROUP BY buyer_id, year) bt
      JOIN concentration_index ci_inner ON ci_inner.buyer_id = bt.buyer_id AND ci_inner.year = concentration_index.year
      WHERE ci_inner.rowid = concentration_index.rowid
    )
  `).run();

  console.log('✓ Concentration index rebuilt');
}

export default db;
