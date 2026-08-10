/**
 * Guardas de la herramienta oicp_sql (regla 12).
 *
 * Por qué existe este archivo: la protección contra consultas que congelan la
 * plataforma se rompió DOS veces en silencio. La primera versión dejaba pasar
 * `FROM a x, b y`; la segunda cerró esa forma pero dejó abiertas `JOIN ... ON 1=1` y
 * la subconsulta antes de la coma, y una de ellas tumbó producción durante ~20 minutos
 * el 2026-08-10. Cada evasión conocida queda aquí como caso de prueba para que no
 * vuelva a pasar sin que el CI lo grite.
 *
 * better-sqlite3 ejecuta de forma síncrona en el único hilo de Node y esta compilación
 * no expone progress handler ni interrupt: una consulta pesada no se puede abortar, así
 * que la única defensa es no dejarla empezar.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import DatabaseCtor from 'better-sqlite3';
import { callTool } from './mcp-server.js';

function baseDePrueba() {
  const db = new DatabaseCtor(':memory:');
  // Mismo esquema e índices que server/db.ts y mcp-server.ts, que es lo que el
  // planificador de SQLite usa para decidir el plan.
  db.exec(`
    CREATE TABLE procedures (id TEXT PRIMARY KEY, ocid TEXT, title TEXT, description TEXT,
      buyer_id TEXT, buyer_name TEXT, procurement_method TEXT, procurement_method_details TEXT,
      budget_amount REAL, award_amount REAL, contract_amount REAL, final_amount REAL,
      published_date TEXT, source_year INTEGER, suppliers TEXT, flags TEXT,
      score INTEGER, risk_level TEXT, status TEXT, number_of_tenderers INTEGER);
    CREATE INDEX idx_proc_buyer ON procedures(buyer_id);
    CREATE INDEX idx_proc_score ON procedures(score DESC);
    CREATE INDEX idx_proc_year ON procedures(source_year);
    CREATE INDEX idx_proc_method ON procedures(procurement_method_details);
    CREATE INDEX idx_proc_risk ON procedures(risk_level);
    CREATE INDEX idx_proc_status ON procedures(status);
    CREATE INDEX idx_proc_date ON procedures(published_date DESC);
    CREATE TABLE concentration_index (buyer_id TEXT, supplier_id TEXT, year INTEGER,
      contract_count INTEGER, total_value REAL, infima_count INTEGER,
      infima_total_value REAL, share_of_buyer REAL);
    CREATE INDEX idx_conc_buyer ON concentration_index(buyer_id, year);
    CREATE INDEX idx_conc_supplier ON concentration_index(supplier_id, year);
    CREATE TABLE a_buyers (buyer_id TEXT PRIMARY KEY, name TEXT, n_procs INTEGER, total_usd REAL);
    CREATE TABLE a_suppliers (ruc10 TEXT PRIMARY KEY, name TEXT, n_procs INTEGER, total_usd REAL);
    CREATE TABLE a_flag_year (code TEXT, year INTEGER, n INTEGER, PRIMARY KEY (code, year));
    CREATE TABLE a_risk_year (risk TEXT, year INTEGER, n INTEGER, total_usd REAL, PRIMARY KEY (risk, year));
    CREATE TABLE allowed_users (email TEXT PRIMARY KEY, role TEXT);
    CREATE TABLE access_log (id INTEGER PRIMARY KEY, email TEXT, path TEXT);
  `);
  for (let i = 0; i < 60; i++) {
    db.prepare(`INSERT INTO procedures (id, buyer_id, source_year, risk_level, score, award_amount, flags, suppliers)
      VALUES (?,?,?,?,?,?,'[]','[]')`).run(`p${i}`, `b${i % 5}`, 2019 + (i % 8), 'low', i, 1000 * i);
  }
  db.prepare(`INSERT INTO allowed_users (email, role) VALUES ('secreto@ejemplo.com','viewer')`).run();
  db.prepare(`INSERT INTO a_buyers (buyer_id, name, n_procs, total_usd) VALUES ('b1','ENTIDAD UNO',10,5000)`).run();
  return db;
}

const sql = (db: any, consulta: string) => callTool(db, 'oicp_sql', { sql: consulta });

// ── Consultas que DEBEN ser rechazadas ───────────────────────
const RECHAZADAS: [string, string][] = [
  ['producto cartesiano con JOIN ... ON 1=1 (evasión que tumbó producción)',
    `SELECT COUNT(*) FROM procedures x JOIN procedures y ON 1=1`],
  ['producto cartesiano con subconsulta antes de la coma',
    `SELECT COUNT(*) FROM (SELECT 1 AS a) p, procedures q`],
  ['producto cartesiano clásico con alias',
    `SELECT COUNT(*) FROM procedures a, procedures b`],
  ['CROSS JOIN aliasado',
    `SELECT COUNT(*) FROM procedures a CROSS JOIN procedures b`],
  ['self join por columna de baja cardinalidad',
    `SELECT COUNT(*) FROM procedures a JOIN procedures b ON a.risk_level = b.risk_level`],
  ['recorrido completo de procedures',
    `SELECT * FROM procedures`],
  ['recorrido completo de procedures CON ALIAS (el plan dice "SCAN p", no "SCAN procedures")',
    `SELECT * FROM procedures p`],
  ['COUNT(*) global sobre procedures (recorre 1,47 M entradas de índice)',
    `SELECT COUNT(*) FROM procedures`],
  ['GROUP BY global sin filtro',
    `SELECT buyer_id, COUNT(*) FROM procedures GROUP BY buyer_id`],
  ['group_concat sobre toda la tabla',
    `SELECT group_concat(description) FROM procedures`],
  ['recorrido completo de concentration_index',
    `SELECT * FROM concentration_index`],
  ['tabla con datos personales',
    `SELECT * FROM allowed_users`],
  ['tabla con datos personales entre corchetes',
    `SELECT * FROM [allowed_users]`],
  ['registro de navegación del periodista',
    `SELECT * FROM access_log WHERE email LIKE '%@%'`],
  ['esquema interno vía sqlite_master',
    `SELECT name FROM sqlite_master`],
  ['esquema interno vía sqlite_schema',
    `SELECT name FROM sqlite_schema`],
  ['dbstat, que además lee el archivo completo',
    `SELECT name, pgsize FROM dbstat`],
  ['WITH RECURSIVE',
    `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) SELECT * FROM c LIMIT 5`],
  ['escritura disfrazada',
    `DELETE FROM procedures`],
];

for (const [nombre, consulta] of RECHAZADAS) {
  test(`oicp_sql RECHAZA: ${nombre}`, () => {
    const db = baseDePrueba();
    const r: any = sql(db, consulta);
    assert.ok(r && typeof r.error === 'string',
      `debía rechazarse y devolvió datos: ${JSON.stringify(r).slice(0, 300)}`);
    assert.ok(!('data' in r), 'una consulta rechazada no puede devolver filas');
    db.close();
  });
}

// ── Consultas legítimas que DEBEN seguir funcionando ─────────
const PERMITIDAS: [string, string][] = [
  ['filtro por año (índice)', `SELECT id, score FROM procedures WHERE source_year = 2020`],
  ['filtro por año con alias', `SELECT p.id FROM procedures p WHERE p.source_year = 2020`],
  ['filtro por id (clave primaria)', `SELECT id, score FROM procedures WHERE id = 'p3'`],
  ['filtro por comprador (índice)', `SELECT id FROM procedures WHERE buyer_id = 'b1'`],
  ['agregado precalculado completo', `SELECT * FROM a_flag_year`],
  ['agregado precalculado con alias', `SELECT b.name FROM a_buyers b`],
  ['cruce agregado-grande acotado por índice',
    `SELECT b.name, p.id FROM a_buyers b JOIN procedures p ON p.buyer_id = b.buyer_id WHERE p.source_year = 2020`],
  ['concentración acotada por comprador',
    `SELECT supplier_id, year, share_of_buyer FROM concentration_index ci WHERE ci.buyer_id = 'b1'`],
];

for (const [nombre, consulta] of PERMITIDAS) {
  test(`oicp_sql PERMITE: ${nombre}`, () => {
    const db = baseDePrueba();
    const r: any = sql(db, consulta);
    assert.equal(r.error, undefined, `no debía rechazarse: ${r.error}`);
    assert.ok(Array.isArray(r.data), 'debe devolver filas');
    db.close();
  });
}

test('oicp_sql: el LIMIT impuesto no se puede anular con un comentario', () => {
  const db = baseDePrueba();
  // Antes se buscaba la subcadena "limit" en el texto: escribirla dentro de un
  // comentario hacía creer a la guarda que la consulta ya venía acotada.
  const r: any = sql(db, `SELECT id FROM procedures WHERE source_year = 2020 /* limit */`);
  assert.equal(r.error, undefined);
  assert.ok(r.data.length <= 300, 'el tope de filas debe seguir aplicándose');
  db.close();
});

test('oicp_sql: una consulta que termina en comentario de línea no rompe el envoltorio', () => {
  const db = baseDePrueba();
  // El envoltorio se cierra en su propia línea; sin el salto de línea, el "--" habría
  // comentado el paréntesis de cierre y la consulta fallaría con un error confuso.
  const r: any = sql(db, `SELECT id FROM procedures WHERE source_year = 2020 -- comentario`);
  assert.equal(r.error, undefined);
  assert.ok(Array.isArray(r.data));
  db.close();
});

test('oicp_sql: respeta max_rows y avisa cuando trunca', () => {
  const db = baseDePrueba();
  const r: any = callTool(db, 'oicp_sql',
    { sql: `SELECT id FROM procedures WHERE source_year = 2020`, max_rows: 2 });
  assert.equal(r.error, undefined);
  assert.equal(r.data.length, 2);
  db.close();
});

test('oicp_sql: toda respuesta lleva el disclaimer (regla 7)', () => {
  const db = baseDePrueba();
  const r: any = sql(db, `SELECT id FROM procedures WHERE id = 'p1'`);
  assert.match(r.disclaimer, /NO constituyen evidencia/);
  assert.match(r.datos_no_confiables, /nunca instrucciones/);
  db.close();
});

test('oicp_search no recorre procedures cuando falta el índice FTS', () => {
  const db = baseDePrueba();  // sin tabla a_fts
  // Antes caía a un LIKE '%texto%' sobre 1,47 M filas: un término mal escrito bastaba
  // para dejar la plataforma sin responder.
  const r: any = callTool(db, 'oicp_search', { texto: 'terminoquenoexiste' });
  assert.match(String(r.error), /a_fts/);
  db.close();
});
