import { Router } from 'express';
import express from 'express';
import { migrate, upsertProcedure, rebuildConcentrationIndex, replaceDatabase, getDb, closeDbForReplace } from '../db.js';
import { buildAnalytics, analyticsReady, mintMcpToken } from '../mcp-server.js';
import { evaluateAllFlags, getRegime } from '../flag-engine.js';
import { writeFileSync, readFileSync, createReadStream, appendFileSync, statSync, existsSync, unlinkSync, statfsSync } from 'fs';
import { createGzip } from 'zlib';
import { resolve } from 'path';
import crypto from 'crypto';
import { authEnabled, sessionFromRequest, isAllowed, clearSessionCookie } from '../auth.js';
import { invalidateStatsCache } from '../cache.js';
import { escribirAcceso } from '../access-log.js';

const router = Router();

const SEARCH_API = 'https://datosabiertos.compraspublicas.gob.ec/PLATAFORMA/api/search_ocds';
const RECORD_API = 'https://datosabiertos.compraspublicas.gob.ec/PLATAFORMA/api/record';
const DELAY_BETWEEN_RECORDS = 5000;
const DELAY_BETWEEN_PAGES = 3000;
const DELAY_AFTER_429 = 120000;

const SEARCH_TERMS_FULL = [
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

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

/** ¿La petición trae la ADMIN_KEY correcta? (comparación en tiempo constante) */
function hasValidAdminKey(req: any): boolean {
  const key = process.env.ADMIN_KEY;
  const provided = (req.query.key || req.headers['x-admin-key']) as string;
  return !!(key && provided && provided.length === key.length &&
    crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(key)));
}

/** Escapa un valor para incrustarlo con seguridad dentro de un <script> inline. */
function toScriptLiteral(value: string): string {
  return JSON.stringify(String(value ?? ''))
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function checkAuth(req: any, res: any): boolean {
  // Acepta ADMIN_KEY válida (scripts internos como subir.mjs y el flujo de sincronización)
  // o sesión de cookie con rol superadmin. Sin ADMIN_KEY configurada NO hay clave por
  // defecto (se cerró el default débil).
  if (hasValidAdminKey(req)) return true;   // vía máquina: la traza queda en morgan
  if (authEnabled()) {
    const sess = sessionFromRequest(req);
    if (sess) {
      // Rol y pertenencia FRESCOS desde la base, igual que requireSuperadmin (auth.ts:209).
      // Antes se confiaba en el rol que venía DENTRO de la cookie firmada, que vive 14
      // días: degradar o eliminar a un superadmin NO le revocaba estas rutas. Con esa
      // cookie seguía pudiendo descargar la base COMPLETA (incluidas allowed_users y
      // access_log, o sea el registro de navegación del periodista), vaciarla con
      // batch-clear o reemplazarla con restore-from-url.
      const row = isAllowed(getDb(), sess.email);
      if (!row) {
        clearSessionCookie(res);
        res.status(401).json({ error: 'Acceso revocado', code: 'REVOKED' });
        return false;
      }
      if (row.role !== 'superadmin') {
        res.status(403).json({ error: 'Requiere rol superadmin', code: 'FORBIDDEN' });
        return false;
      }
      req.user = { email: sess.email, role: row.role };
      // El accessLogger global corre ANTES de este router (index.ts:141 vs 144), así que
      // ya pasó sin req.user y ninguna acción de administración quedaba registrada.
      // Se registra aquí, fuera del camino de la respuesta (regla 6).
      escribirAcceso(sess.email, req.method, req.path, req.query);
      return true;
    }
  }
  res.status(403).json({ error: 'Requiere ADMIN_KEY o sesión de superadmin' });
  return false;
}

async function safeFetch(url: string): Promise<Response | null> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetch(url);
      if (response.status === 429) {
        await sleep(DELAY_AFTER_429 * attempt);
        continue;
      }
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('json') && response.ok) {
        const text = await response.text();
        if (text.startsWith('<!DOCTYPE') || text.startsWith('<html')) {
          await sleep(180000);
          continue;
        }
        try { JSON.parse(text); return new Response(text, { status: response.status, headers: response.headers }); }
        catch { await sleep(60000); continue; }
      }
      return response;
    } catch (err: any) {
      if (attempt === 4) return null;
      await sleep(30000 * attempt);
    }
  }
  return null;
}

// ── UPLOAD DATABASE ─────────────────────────────────────────
// La autorización y el chequeo del actualizador van ANTES del parser de cuerpo. Con
// express.raw en primer lugar, CUALQUIERA sin autenticar podía hacer que el servidor
// bufferizara hasta 500 MB en RAM antes de recibir su 403: una denegación de servicio
// sin credenciales, sobre un contenedor con memoria acotada.
async function puertaUploadDb(req: any, res: any, next: any) {
  if (!checkAuth(req, res)) return;
  if (await updaterRunning()) {
    return res.status(409).json({ error: 'El actualizador incremental está corriendo; el reemplazo de base cerraría su conexión. Detenlo primero con POST /api/admin/stop-update.' });
  }
  next();
}

router.post('/upload-db', puertaUploadDb, express.raw({ type: '*/*', limit: '500mb' }), async (req, res) => {
  try {
    req.setTimeout(600000);
    res.setTimeout(600000);

    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');

    if (buffer.length < 50) {
      return res.status(400).json({ error: `Archivo demasiado pequeño (${buffer.length} bytes). ¿Seleccionaste el archivo correcto?` });
    }

    const dbPath = resolve(process.env.DB_PATH || './data/oicp.db');
    const tmp = dbPath + '.incoming';
    const fsx = await import('fs');
    const pathmod = await import('path');

    // Liberar espacio ANTES de escribir: las copias .corrupt-* apartadas y
    // restos .incoming de intentos previos pueden dejar el volumen sin sitio (ENOSPC).
    try {
      const dir = pathmod.dirname(dbPath);
      for (const f of fsx.readdirSync(dir)) {
        if (f.includes('.corrupt-') || f.endsWith('.incoming') || f.endsWith('.incoming.gz')) {
          fsx.unlinkSync(pathmod.join(dir, f));
        }
      }
    } catch { /* limpieza opcional */ }

    if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
      // gunzip por STREAMING a archivo: gunzipSync revienta con bases >2GB
      // (tope de Buffer en Node = 2^31-1 bytes).
      const { createGunzip } = await import('zlib');
      const { Readable } = await import('stream');
      const { pipeline } = await import('stream/promises');
      await pipeline(Readable.from(buffer), createGunzip(), fsx.createWriteStream(tmp));
    } else {
      fsx.writeFileSync(tmp, buffer);
    }

    // Check SQLite magic bytes (leyendo del archivo, no de un buffer gigante)
    const fd = fsx.openSync(tmp, 'r');
    const head = Buffer.alloc(15);
    fsx.readSync(fd, head, 0, 15, 0);
    fsx.closeSync(fd);
    if (!head.toString('ascii').startsWith('SQLite format')) {
      try { fsx.unlinkSync(tmp); } catch { /* limpieza */ }
      return res.status(400).json({ error: `No es un archivo SQLite válido. Header: "${head.toString('ascii', 0, 10)}"` });
    }

    const finalSize = fsx.statSync(tmp).size;
    closeDbForReplace();
    for (const suf of ['-wal', '-shm']) {
      try { fsx.unlinkSync(dbPath + suf); } catch { /* puede no existir */ }
    }
    fsx.renameSync(tmp, dbPath);
    replaceDatabase(dbPath);
    // liberar el volumen: copias .corrupt-* apartadas ya no hacen falta
    try {
      const dir = (await import('path')).dirname(dbPath);
      for (const f of fsx.readdirSync(dir)) {
        if (f.includes('.corrupt-')) fsx.unlinkSync((await import('path')).join(dir, f));
      }
    } catch { /* limpieza opcional */ }

    const sizeMB = (finalSize / 1048576).toFixed(1);
    invalidateStatsCache();
    res.json({
      success: true,
      message: `Base de datos reemplazada exitosamente (${sizeMB} MB). La plataforma ya muestra los nuevos datos.`,
      size: finalSize,
    });
  } catch (err: any) {
    res.status(500).json({ error: `Error al subir: ${err.message}` });
  }
});

// ── BATCH UPLOAD (chunked, for large databases) ─────────────
router.post('/batch-clear', express.json({ limit: '1mb' }), async (req, res) => {
  if (!checkAuth(req, res)) return;
  // Operación destructiva (borra procedures y concentration_index por completo).
  // Exige confirmación explícita y que no haya ningún job escribiendo, para que
  // una llamada accidental o a destiempo no vacíe la base de producción.
  if (req.body?.confirm !== 'BORRAR TODO') {
    return res.status(400).json({ error: 'Operación destructiva: envía {"confirm":"BORRAR TODO"} para confirmar que quieres vaciar la base.' });
  }
  if (await updaterRunning() || currentJob.running) {
    return res.status(409).json({ error: 'Hay una carga o actualización en curso. Deténla antes de vaciar la base.' });
  }
  try {
    const { getDb } = await import('../db.js');
    const db = getDb();
    db.exec('DELETE FROM procedures');
    db.exec('DELETE FROM concentration_index');
    db.exec('VACUUM');
    res.json({ success: true, message: 'Base de datos limpiada.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/batch-upload', express.json({ limit: '50mb' }), async (req, res) => {
  if (!checkAuth(req, res)) return;
  try {
    const { getDb } = await import('../db.js');
    const db = getDb();
    const records = req.body.records;
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'No hay registros' });
    }

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO procedures (
        id, ocid, title, description, status,
        procurement_method, procurement_method_details,
        buyer_id, buyer_name,
        budget_amount, budget_currency, award_amount, contract_amount, final_amount,
        published_date, submission_deadline, award_date, contract_date,
        suppliers, number_of_tenderers, items_classification,
        has_amendments, amendment_count, source_year, regime,
        flags, score, risk_level, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now')
      )
    `);

    const tx = db.transaction((rows: any[]) => {
      for (const r of rows) {
        stmt.run(
          r.id, r.ocid, r.title, r.description, r.status,
          r.procurement_method, r.procurement_method_details,
          r.buyer_id, r.buyer_name,
          r.budget_amount, r.budget_currency || 'USD', r.award_amount, r.contract_amount, r.final_amount,
          r.published_date, r.submission_deadline, r.award_date, r.contract_date,
          r.suppliers, r.number_of_tenderers, r.items_classification,
          r.has_amendments, r.amendment_count, r.source_year, r.regime,
          r.flags, r.score, r.risk_level
        );
      }
    });

    tx(records);
    res.json({ success: true, inserted: records.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/batch-concentration', express.json({ limit: '50mb' }), async (req, res) => {
  if (!checkAuth(req, res)) return;
  try {
    const { getDb } = await import('../db.js');
    const db = getDb();
    const records = req.body.records;
    if (!Array.isArray(records)) return res.status(400).json({ error: 'No hay registros' });

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO concentration_index
      (supplier_id, supplier_name, buyer_id, buyer_name, year, contract_count, total_value, share_of_buyer, infima_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = db.transaction((rows: any[]) => {
      for (const r of rows) {
        stmt.run(r.supplier_id, r.supplier_name, r.buyer_id, r.buyer_name, r.year, r.contract_count, r.total_value, r.share_of_buyer, r.infima_count);
      }
    });

    tx(records);
    res.json({ success: true, inserted: records.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── FIX BUDGET (repara budget_amount corrupto = 'USD') ──────
router.post('/fix-budget', async (req, res) => {
  if (!checkAuth(req, res)) return;
  try {
    const { getDb } = await import('../db.js');
    const db = getDb();

    // Cuantos registros estan corruptos
    const before = db.prepare(
      `SELECT COUNT(*) c FROM procedures WHERE budget_amount = 'USD'`
    ).get() as any;

    // El monto real quedo en budget_currency. Lo movemos de vuelta.
    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE procedures
        SET budget_amount = CAST(budget_currency AS REAL),
            budget_currency = 'USD'
        WHERE budget_amount = 'USD'
          AND budget_currency IS NOT NULL
          AND budget_currency != 'USD'
      `).run();
    });
    tx();

    const after = db.prepare(
      `SELECT COUNT(*) c FROM procedures WHERE budget_amount = 'USD'`
    ).get() as any;

    invalidateStatsCache();
    res.json({
      success: true,
      message: 'Campo budget_amount reparado.',
      corruptos_antes: before.c,
      corruptos_despues: after.c,
      reparados: before.c - after.c,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── FIX SHARE (reconstruye concentration_index con calculo correcto) ──
// Util cuando solo quieres reconstruir el indice y ver los nuevos numeros
// sin re-evaluar las 1.46M de banderas (que toma 10-12 minutos).
router.post('/fix-share', async (req, res) => {
  if (!checkAuth(req, res)) return;
  try {
    const { rebuildConcentrationIndex, getDb } = await import('../db.js');
    const db = getDb();

    // Antes: cuantos pares hay con share absurdo (>100)
    const before = db.prepare(
      `SELECT COUNT(*) c FROM concentration_index WHERE share_of_buyer > 100`
    ).get() as any;

    // Reconstruye con la query corregida
    rebuildConcentrationIndex();

    // Despues: deberia ser 0
    const after = db.prepare(
      `SELECT COUNT(*) c FROM concentration_index WHERE share_of_buyer > 100`
    ).get() as any;

    // Estadisticas de validacion
    const stats = db.prepare(`
      SELECT
        COUNT(*) as pares_total,
        MIN(share_of_buyer) as share_min,
        MAX(share_of_buyer) as share_max,
        AVG(share_of_buyer) as share_avg,
        SUM(CASE WHEN share_of_buyer > 30 THEN 1 ELSE 0 END) as pares_share_mayor_30,
        SUM(infima_count) as total_infimas,
        MAX(infima_count) as max_infimas_por_par
      FROM concentration_index
    `).get();

    invalidateStatsCache();
    res.json({
      success: true,
      message: 'Indice de concentracion reconstruido con calculo corregido.',
      pares_con_share_absurdo_antes: before.c,
      pares_con_share_absurdo_despues: after.c,
      estadisticas: stats,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── NORMALIZE DATA (fix procurement_method + re-evaluate flags) ──
router.post('/normalize', async (req, res) => {
  if (!checkAuth(req, res)) return;
  try {
    const { normalizeProcurementMethods, getDb, rebuildConcentrationIndex } = await import('../db.js');
    const { evaluateAllFlags } = await import('../flag-engine.js');

    const db = getDb();

    // PASO 1: Normalizar metodos de contratacion y estados
    const methodCounts = normalizeProcurementMethods();

    // PASO 2: Reconstruir el indice de concentracion (ANTES de evaluar banderas)
    rebuildConcentrationIndex();

    // PASO 3-4: Re-evaluación con contexto de concentración vía el updater:
    // iterate() (sin cargar 1.46M filas en RAM), escritura SOLO de diffs, y
    // fila+deltas de agregados a_* en la MISMA transacción por lote — así las
    // herramientas MCP (a_risk_year/a_flag_year/a_suppliers) nunca quedan
    // desincronizadas tras un normalize.
    const { reflagChanged } = await import('../updater.js');
    const reevaluated = await reflagChanged(db);

    // Estadisticas finales
    const riskCounts = db.prepare(`
      SELECT risk_level, COUNT(*) as count FROM procedures GROUP BY risk_level ORDER BY count DESC
    `).all();
    const flagCounts = db.prepare(`
      SELECT json_extract(j.value, '$.code') as code, COUNT(*) as count
      FROM procedures, json_each(procedures.flags) j
      WHERE json_extract(j.value, '$.active') IN (1, 'true')
      GROUP BY code ORDER BY count DESC
    `).all();

    invalidateStatsCache();
    res.json({
      success: true,
      message: `Normalizado. Re-evaluación completa: ${reevaluated} procedimientos cambiaron de banderas/score (los agregados a_* quedaron sincronizados).`,
      methodCounts,
      riskCounts,
      flagCounts,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── DIAGNOSTIC ──────────────────────────────────────────────
router.get('/test', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const results: any[] = [];
  try {
    const url = `${SEARCH_API}?year=2024&search=agua&page=1`;
    const response = await fetch(url);
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();
    if (contentType.includes('json') || text.startsWith('{')) {
      const data = JSON.parse(text);
      results.push({ test: 'Search API', status: response.status, total: data.total, pages: data.pages, rateLimit: response.headers.get('x-ratelimit-remaining') });
    } else {
      results.push({ test: 'Search API', error: 'SERCOP devuelve HTML. IP bloqueada temporalmente.', note: 'Usa la opción de descarga local.' });
    }
  } catch (err: any) { results.push({ test: 'Search API', error: err.message }); }

  try {
    const response = await fetch(`${RECORD_API}?ocid=ocds-5wno2w-001-LICO-GPLR-2020-2805`);
    results.push({ test: 'Record API', status: response.status, ok: response.ok });
  } catch (err: any) { results.push({ test: 'Record API', error: err.message }); }

  res.json(results);
});

// ── STATUS / STOP ───────────────────────────────────────────
let currentJob = {
  running: false, year: 0, progress: '', count: 0, errors: [] as string[],
  currentTerm: '', termsCompleted: 0, totalTerms: 0, skippedDuplicates: 0,
  lastApiResponse: '', startedAt: '',
};

router.get('/status', (req, res) => {
  if (!checkAuth(req, res)) return;
  res.json(currentJob);
});

// El updater consulta esto para no correr en paralelo con /load (y viceversa).
export function loadJobRunning(): boolean { return currentJob.running; }

// ── Token de sincronización local (el barrido corre en una PC con IP
//    ecuatoriana porque SERCOP bloquea IPs de datacenter) ─────────────
function syncTokenOk(req: any): boolean {
  const t = req.headers['x-sync-token'] as string;
  if (!t || t.length < 32) return false;
  const row = getDb().prepare(`SELECT value FROM mcp_settings WHERE key='sync_token_hash'`).get() as any;
  if (!row) return false;
  const hash = crypto.createHash('sha256').update(t).digest('hex');
  return hash.length === row.value.length &&
    crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(row.value));
}

function checkAuthOrSync(req: any, res: any): boolean {
  if (syncTokenOk(req)) return true;
  return checkAuth(req, res);
}

router.post('/mint-sync-token', (req, res) => {
  if (!checkAuth(req, res)) return;
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS mcp_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  db.prepare(`INSERT INTO mcp_settings (key,value) VALUES ('sync_token_hash',?)
              ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(hash);
  res.json({ token, nota: 'Guárdalo: no se puede volver a leer. Rota llamando de nuevo este endpoint.' });
});

// ── Ingesta desde la sincronización local ───────────────────
router.post('/missing-ocids', async (req, res) => {
  if (!checkAuthOrSync(req, res)) return;
  const ocids = req.body?.ocids;
  if (!Array.isArray(ocids) || ocids.length > 2000) return res.status(400).json({ error: 'ocids[] requerido (máx 2000)' });
  const { missingOcids } = await import('../updater.js');
  res.json({ missing: missingOcids(ocids) });
});

router.post('/ingest', async (req, res) => {
  if (!checkAuthOrSync(req, res)) return;
  if (currentJob.running) return res.status(409).json({ error: 'Hay una descarga /admin/load en curso; reintenta después.' });
  const procs = req.body?.procs;
  if (!Array.isArray(procs) || !procs.length || procs.length > 500) {
    return res.status(400).json({ error: 'procs[] requerido (1 a 500 por lote)' });
  }
  try {
    const { ingestProcs, updateJob } = await import('../updater.js');
    if (updateJob.running) return res.status(409).json({ error: 'Actualizador en curso; reintenta en unos minutos.' });
    res.json(ingestProcs(procs));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/ingest-finalize', async (req, res) => {
  if (!checkAuthOrSync(req, res)) return;
  const year = Number(req.body?.year) || new Date().getFullYear();
  try {
    const { finalizeIngest, updateJob } = await import('../updater.js');
    if (updateJob.running) return res.status(409).json({ error: 'Actualizador en curso; reintenta en unos minutos.' });
    res.json(await finalizeIngest(year));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

async function updaterRunning(): Promise<boolean> {
  const { updateJob } = await import('../updater.js');
  return updateJob.running;
}

router.post('/stop', (req, res) => {
  if (!checkAuth(req, res)) return;
  currentJob.running = false;
  currentJob.progress = 'Detenido. Los datos ya descargados están guardados.';
  res.json({ message: 'Detenido', status: currentJob });
});

// ── LOAD (server-side download from SERCOP) ─────────────────
router.post('/load', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const year = Number(req.query.year) || new Date().getFullYear();
  const term = req.query.term as string;

  if (currentJob.running) return res.json({ message: 'Ya hay una descarga en curso.', status: currentJob });
  if (await updaterRunning()) return res.status(409).json({ error: 'El actualizador incremental está corriendo. Detenlo primero con POST /api/admin/stop-update.' });

  const terms = term ? [term] : SEARCH_TERMS_FULL;
  currentJob = { running: true, year, progress: 'Iniciando...', count: 0, errors: [], currentTerm: '', termsCompleted: 0, totalTerms: terms.length, skippedDuplicates: 0, lastApiResponse: '', startedAt: new Date().toISOString() };
  res.json({ message: `Descarga iniciada para ${year}`, status: currentJob });

  (async () => {
    try {
      const existingOcids = new Set<string>();
      let consecutiveErrors = 0;

      for (let t = 0; t < terms.length; t++) {
        if (!currentJob.running) break;
        if (consecutiveErrors >= 5) { currentJob.progress = 'Pausa 5min por errores...'; await sleep(300000); consecutiveErrors = 0; }
        const searchTerm = terms[t];
        currentJob.currentTerm = searchTerm;
        currentJob.termsCompleted = t;
        currentJob.progress = `[${t + 1}/${terms.length}] "${searchTerm}" en ${year}...`;

        let page = 1, totalPages = 1;
        while (page <= totalPages && page <= 50 && currentJob.running) {
          try {
            const response = await safeFetch(`${SEARCH_API}?year=${year}&search=${encodeURIComponent(searchTerm)}&page=${page}`);
            if (!response) { consecutiveErrors++; break; }
            currentJob.lastApiResponse = `HTTP ${response.status}`;
            if (!response.ok) { consecutiveErrors++; break; }
            let searchData: any;
            try { searchData = await response.json(); } catch { consecutiveErrors++; break; }
            consecutiveErrors = 0;
            if (!searchData?.data) break;
            totalPages = searchData.pages || 1;
            if (searchData.data.length === 0) break;
            currentJob.progress = `[${t + 1}/${terms.length}] "${searchTerm}" pág ${page}/${totalPages} — ${currentJob.count} total`;

            for (const result of searchData.data) {
              if (!currentJob.running) break;
              const ocid = result.ocid;
              if (!ocid) continue;
              if (existingOcids.has(ocid)) { currentJob.skippedDuplicates++; continue; }
              existingOcids.add(ocid);
              const basicProc = searchResultToProc(result, year);
              await sleep(DELAY_BETWEEN_RECORDS);
              try {
                const rec = await safeFetch(`${RECORD_API}?ocid=${encodeURIComponent(ocid)}`);
                if (rec && rec.ok) {
                  const recData = await rec.json();
                  if (recData?.records?.[0]?.releases?.length) {
                    const release = recData.records[0].releases.at(-1);
                    const full = ocdsReleaseToProc(release, result, year);
                    const { flags, score, riskLevel } = evaluateAllFlags(full);
                    upsertProcedure({ ...full, flags, score, risk_level: riskLevel });
                    currentJob.count++;
                    continue;
                  }
                }
              } catch {}
              const { flags, score, riskLevel } = evaluateAllFlags(basicProc);
              upsertProcedure({ ...basicProc, flags, score, risk_level: riskLevel });
              currentJob.count++;
            }
            page++;
            await sleep(DELAY_BETWEEN_PAGES);
          } catch (e: any) { currentJob.errors.push(`${searchTerm} p${page}: ${e.message}`); consecutiveErrors++; break; }
        }
      }
      if (currentJob.running) { rebuildConcentrationIndex(year); currentJob.progress = `✅ ${currentJob.count} procesos para ${year}`; }
    } catch (e: any) { currentJob.progress = `Error: ${e.message}`; }
    currentJob.running = false;
  })();
});

function searchResultToProc(r: any, year: number) {
  const amount = r.amount ? parseFloat(r.amount) : null;
  const budget = r.budget ? parseFloat(r.budget) : null;
  const buyerName = r.buyer || r.buyerName || null;
  const buyerId = r.buyerId || (buyerName ? 'EC-' + buyerName.substring(0, 30).replace(/[^A-Za-z0-9]/g, '-') : null);
  const suppliers: any[] = [];
  if (r.suppliers && typeof r.suppliers === 'string') suppliers.push({ id: '', name: r.suppliers });
  return {
    id: r.ocid, ocid: r.ocid, title: r.title || r.description || '', description: r.description || '',
    status: 'unknown', procurement_method: r.method || '', procurement_method_details: r.internal_type || '',
    buyer_id: buyerId, buyer_name: buyerName,
    budget_amount: budget, budget_currency: 'USD', award_amount: amount, contract_amount: null, final_amount: null,
    published_date: r.date || null, submission_deadline: null, award_date: null, contract_date: null,
    suppliers, number_of_tenderers: null, items_classification: null,
    has_amendments: false, amendment_count: 0, source_year: year, regime: getRegime(r.date),
  };
}

function ocdsReleaseToProc(release: any, sr: any, year: number) {
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
  if (!m) { const d = md.toLowerCase(); m = d.includes('ínfima') || d.includes('infima') ? 'limited' : d.includes('especial') ? 'selective' : d.includes('catálogo') ? 'direct' : 'open'; }
  const bn = buyer.name || sr?.buyer || null;
  const bi = buyer.id || (bn ? 'EC-' + bn.substring(0, 30).replace(/[^A-Za-z0-9]/g, '-') : null);
  let ac = 0; for (const c of co) ac += (c.amendments || []).length;
  return {
    id: release.ocid || sr?.ocid, ocid: release.ocid || sr?.ocid,
    title: t.title || t.description || sr?.title || '', description: t.description || sr?.description || '',
    status: release.tag?.includes('contract') ? 'contract' : release.tag?.includes('award') ? 'award' : 'tender',
    procurement_method: m, procurement_method_details: md, buyer_id: bi, buyer_name: bn,
    budget_amount: t.value?.amount || release.planning?.budget?.amount?.amount || (sr?.budget ? parseFloat(sr.budget) : null),
    budget_currency: 'USD', award_amount: fa.value?.amount || (sr?.amount ? parseFloat(sr.amount) : null),
    contract_amount: fc.value?.amount || null, final_amount: fc.implementation?.finalValue?.amount || null,
    published_date: t.tenderPeriod?.startDate || release.date || sr?.date || null,
    submission_deadline: t.tenderPeriod?.endDate || null, award_date: fa.date || null, contract_date: fc.dateSigned || null,
    suppliers, number_of_tenderers: t.numberOfTenderers || release.bids?.details?.length || null,
    items_classification: t.items?.[0]?.classification?.id || null,
    has_amendments: ac > 0, amendment_count: ac, source_year: year,
    regime: getRegime(t.tenderPeriod?.startDate || release.date || sr?.date || `${year}-06-15`),
  };
}

// ── ACTUALIZACION INCREMENTAL (updater con cron mar/jue) ────
router.post('/run-update', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const { runUpdate } = await import('../updater.js');
  const year = req.query.year ? Number(req.query.year) : undefined;
  const budgetMin = req.query.budgetMin ? Number(req.query.budgetMin) : undefined;
  res.json(await runUpdate({ year, budgetMin }));
});

router.get('/update-status', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const { updateJob } = await import('../updater.js');
  res.json(updateJob);
});

router.post('/stop-update', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const { stopUpdate, updateJob } = await import('../updater.js');
  stopUpdate();
  res.json({ message: 'Detenido', status: updateJob });
});

// ── ADMIN PAGE ──────────────────────────────────────────────
router.get('/', (req, res) => {
  if (!checkAuth(req, res)) return;
  // La clave SOLO se refleja al HTML si fue ella la que autorizó (scripts sin sesión).
  // Si autorizó la cookie de superadmin, K queda vacío y las llamadas del panel viajan
  // con la sesión (same-origin). Así un enlace con ?key=<payload> enviado a un
  // superadmin logueado no puede inyectar código: su valor nunca llega al DOM.
  // Además se serializa escapando < > & (XSS reflejado, hallazgo de auditoría).
  const key = hasValidAdminKey(req) ? String(req.query.key || '') : '';
  res.send(`<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OICP Admin</title>
<style>
body{font-family:system-ui,sans-serif;max-width:750px;margin:40px auto;padding:0 20px;background:#f9fafb}
h1{color:#1e40af}h2{color:#374151;margin-top:0}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;margin:16px 0;box-shadow:0 1px 3px rgba(0,0,0,.1)}
button{background:#2563eb;color:#fff;border:none;padding:12px 24px;border-radius:8px;font-size:15px;cursor:pointer;margin:4px}
button:hover{background:#1d4ed8}
.stop{background:#dc2626}.stop:hover{background:#b91c1c}
.sm{padding:8px 16px;font-size:13px;background:#059669}.sm:hover{background:#047857}
.diag{background:#7c3aed}.diag:hover{background:#6d28d9}
.upload{background:#ea580c}.upload:hover{background:#c2410c}
.st{padding:16px;border-radius:8px;margin:12px 0;font-family:monospace;font-size:12px;line-height:1.6;white-space:pre-wrap;overflow-x:auto;max-height:400px;overflow-y:auto}
.run{background:#fef3c7;border:1px solid #f59e0b}.ok{background:#d1fae5;border:1px solid #10b981}
.idle{background:#f3f4f6;border:1px solid #d1d5db}.err{background:#fee2e2;border:1px solid #f87171}
.info{background:#eff6ff;border:1px solid #93c5fd;padding:16px;border-radius:8px;margin:16px 0;font-size:14px;line-height:1.5}
.warn{background:#fef3c7;border:1px solid #f59e0b;padding:12px;border-radius:8px;font-size:13px;margin:8px 0}
.bar{height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden;margin-top:8px}
.fill{height:100%;background:#2563eb;border-radius:4px;transition:width .5s}
</style></head><body>
<h1>OICP Admin</h1>

<div class="card" style="border-color:#ea580c">
<h2 style="color:#ea580c">📤 Subir base de datos (desde tu PC)</h2>
<p style="font-size:13px;color:#6b7280">Si descargaste datos con el script local, sube aquí el archivo <code>oicp.db</code></p>
<input type="file" id="dbfile" accept=".db,.sqlite,.sqlite3" style="margin:8px 0;display:block">
<button class="upload" onclick="uploadDB()">Subir oicp.db</button>
<div id="upload-status" class="st idle" style="display:none"></div>
</div>

<div class="card">
<h2>Diagnóstico</h2>
<button class="diag" onclick="diag()">Probar conexión a SERCOP</button>
<div id="diag" class="st idle" style="display:none"></div>
</div>

<div class="card">
<h2>Descarga desde servidor (si SERCOP no bloquea)</h2>
<div class="warn">Si el diagnóstico muestra error, usa la descarga local en tu PC.</div>
<h3 style="font-size:14px;margin:12px 0 8px">Prueba rápida</h3>
<button class="sm" onclick="lt(2024,'agua')">agua 2024</button>
<button class="sm" onclick="lt(2024,'construccion')">construccion 2024</button>
<button class="sm" onclick="lt(2025,'servicio')">servicio 2025</button>
<h3 style="font-size:14px;margin:12px 0 8px">Año completo (4-8 horas)</h3>
<button onclick="l(2025)">2025</button>
<button onclick="l(2024)">2024</button>
<button onclick="l(2023)">2023</button>
<button onclick="l(2022)">2022</button>
<button onclick="l(2021)">2021</button>
<button onclick="l(2020)">2020</button>
<button onclick="l(2019)">2019</button>
</div>

<div class="card">
<h2>Estado</h2>
<div id="s" class="st idle">Sin descargas activas.</div>
<div id="p" style="display:none"><div class="bar"><div id="pf" class="fill" style="width:0%"></div></div><small id="pt"></small></div>
<br><button onclick="ck()">Actualizar</button>
<button class="stop" id="bs" style="display:none" onclick="stp()">Detener</button>
</div>

<div class="card"><a href="/" target="_blank">Ver plataforma OICP</a></div>

<script>
const K=${toScriptLiteral(key)},B='/api/admin';
const Q=(u)=>K?(u+(u.includes('?')?'&':'?')+'key='+encodeURIComponent(K)):u;

async function uploadDB(){
  const f=document.getElementById('dbfile').files[0];
  if(!f){alert('Selecciona el archivo oicp.db primero');return}
  if(!f.name.endsWith('.db')&&!f.name.endsWith('.sqlite')&&!f.name.endsWith('.sqlite3')){alert('Debe ser un archivo .db');return}
  const el=document.getElementById('upload-status');
  el.style.display='block';el.className='st run';
  const origMB=Math.round(f.size/1048576);
  el.textContent='Comprimiendo '+f.name+' ('+origMB+' MB)...';
  try{
    const cs=new CompressionStream('gzip');
    const compressed=f.stream().pipeThrough(cs);
    const blob=await new Response(compressed).blob();
    const compMB=(blob.size/1048576).toFixed(1);
    el.textContent='Subiendo '+compMB+' MB (comprimido de '+origMB+' MB)... Esto puede tomar unos minutos.';
    const r=await fetch(Q(B+'/upload-db'),{method:'POST',body:blob,headers:{'Content-Type':'application/octet-stream'}});
    const d=await r.json();
    if(d.success){el.className='st ok';el.textContent='✅ '+d.message}
    else{el.className='st err';el.textContent='❌ '+d.error}
  }catch(e){el.className='st err';el.textContent='Error: '+e.message+'. Si el archivo es muy grande, usa el script subir.mjs desde CMD.'}
}

async function diag(){const el=document.getElementById('diag');el.style.display='block';el.className='st run';el.textContent='Probando...';
try{const r=await fetch(Q(B+'/test'));const d=await r.json();
const ok=d.every(t=>!t.error&&t.status!==429);el.className=ok?'st ok':'st err';el.textContent=JSON.stringify(d,null,2);
if(!ok)el.textContent+='\\n\\n⚠️ SERCOP bloqueando. Usa descarga local.'}catch(e){el.textContent='Error: '+e.message}}

async function l(y){if(!confirm('Cargar '+y+'?'))return;const r=await fetch(Q(B+'/load?year='+y),{method:'POST'});alert((await r.json()).message);ck()}
async function lt(y,t){const r=await fetch(Q(B+'/load?year='+y+'&term='+encodeURIComponent(t)),{method:'POST'});alert((await r.json()).message);ck()}
async function stp(){if(!confirm('Detener?'))return;await fetch(Q(B+'/stop'),{method:'POST'});ck()}
async function ck(){try{const r=await fetch(Q(B+'/status')),d=await r.json(),e=document.getElementById('s'),p=document.getElementById('p'),pf=document.getElementById('pf'),pt=document.getElementById('pt'),bs=document.getElementById('bs');
if(d.running){e.className='st run';e.textContent='EN CURSO — Año: '+d.year+'\\n'+d.progress+'\\nDescargados: '+d.count+'\\nDuplicados: '+d.skippedDuplicates;
const pc=d.totalTerms>0?Math.round(d.termsCompleted/d.totalTerms*100):0;p.style.display='block';pf.style.width=pc+'%';pt.textContent=d.termsCompleted+'/'+d.totalTerms+' ('+pc+'%)';bs.style.display='inline-block'}
else{bs.style.display='none';p.style.display='none';if(d.count>0){e.className='st ok';e.textContent=d.progress}else{e.className='st idle';e.textContent='Sin descargas activas.'}}
if(d.errors?.length)e.textContent+='\\n\\nErrores:\\n'+d.errors.slice(-3).join('\\n')}catch(e){}}
setInterval(ck,10000);ck()
</script></body></html>`);
});

// ── BACKUP (snapshot consistente, comprimido en streaming; superadmin/ADMIN_KEY) ──
//
// La versión anterior tenía dos formas de producir una copia incompleta que PARECÍA
// correcta, y es la razón por la que este respaldo nunca fue de fiar:
//   1. El `wal_checkpoint(TRUNCATE)` iba en un try/catch que descartaba el error. Si otra
//      conexión tenía la base tomada (el actualizador, o la segunda conexión que abre
//      buildAnalytics), el checkpoint fallaba en silencio y la copia salía sin lo que
//      seguía viviendo en el WAL.
//   2. `createReadStream` leía el archivo VIVO durante segundos o minutos. Cualquier
//      escritura concurrente (el actualizador, el registro de accesos) podía dejar el
//      archivo partido a mitad de una página.
// La forma correcta en SQLite es pedirle a la propia base un snapshot consistente. Se usa
// `db.backup()` y NO `VACUUM INTO`: los dos dan la misma garantía de consistencia, pero
// VACUUM INTO es SÍNCRONO y sobre 1,3 GB dejaría el único hilo de Node bloqueado entre 30
// y 90 segundos, es decir, otro vector de congelamiento como el que ya tumbó la plataforma.
// `db.backup()` implementa la API de respaldo incremental de SQLite: copia por lotes y
// devuelve el control al event loop entre lotes, así que la web sigue respondiendo.
// Después se verifica que el snapshot se pueda LEER y que traiga datos, antes de empezar a
// enviarlo: un respaldo que no se puede verificar no es un respaldo.
export async function backupHandler(req: any, res: any) {
  const dbPath = resolve(process.env.DB_PATH || './data/oicp.db');
  const snapPath = `${dbPath}.backup-${Date.now()}.tmp`;
  const limpiar = () => { try { if (existsSync(snapPath)) unlinkSync(snapPath); } catch { /* nada que hacer */ } };

  try {
    const db = getDb();

    // El checkpoint ya no es la garantía (VACUUM INTO ve los datos confirmados de todas
    // formas), pero libera el WAL y con él espacio en el volumen, que es de 5 GB.
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* no es crítico */ }

    // Espacio libre: el snapshot ocupa aproximadamente lo mismo que la base. Si no cabe,
    // es mejor un error claro que llenar el volumen, que ya tumbó producción una vez.
    try {
      const tamBase = statSync(dbPath).size;
      const libre = (statfsSync(dbPath) as any).bavail * (statfsSync(dbPath) as any).bsize;
      if (Number.isFinite(libre) && libre < tamBase * 1.15) {
        return res.status(507).json({
          error: `Espacio insuficiente para un snapshot consistente: la base ocupa ${(tamBase / 1e9).toFixed(2)} GB y quedan ${(libre / 1e9).toFixed(2)} GB libres.`,
        });
      }
    } catch { /* si no se puede medir, se intenta igual */ }

    limpiar();
    await db.backup(snapPath);   // incremental y asíncrono: no bloquea el event loop

    // Verificación antes de enviar: se adjunta el snapshot y se cuentan sus filas. Si
    // saliera vacío o ilegible, esto falla aquí y no se entrega un archivo inservible.
    let procesosSnapshot = 0;
    try {
      db.prepare(`ATTACH DATABASE ? AS snap`).run(snapPath);
      procesosSnapshot = (db.prepare(`SELECT COUNT(*) AS n FROM snap.procedures`).get() as any).n;
    } finally {
      try { db.prepare(`DETACH DATABASE snap`).run(); } catch { /* ya estaba suelta */ }
    }
    if (!procesosSnapshot) {
      limpiar();
      return res.status(500).json({ error: 'El snapshot salió sin procesos: no se entrega un respaldo que no sirve.' });
    }

    const fecha = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="oicp-${fecha}.db.gz"`);
    // Para que quien restaure pueda comprobar que le llegó completo.
    res.setHeader('X-OICP-Backup-Procesos', String(procesosSnapshot));
    res.setHeader('X-OICP-Backup-Bytes-Sin-Comprimir', String(statSync(snapPath).size));

    const lectura = createReadStream(snapPath);
    // Si la lectura falla con las cabeceras ya enviadas, se corta la conexión a
    // propósito: es mejor que el cliente vea una transferencia rota que un archivo
    // truncado con respuesta 200, que es corrupción silenciosa.
    lectura.on('error', () => { res.destroy(); });
    res.on('close', limpiar);
    lectura.pipe(createGzip()).pipe(res);
  } catch (err: any) {
    limpiar();
    if (!res.headersSent) res.status(500).json({ error: `Error al generar backup: ${err.message}` });
    else res.destroy();
  }
}

router.get('/backup', async (req, res) => {
  if (!checkAuth(req, res)) return;
  await backupHandler(req, res);
});

// ── DIAGNÓSTICO DE ESPACIO ──────────────────────────────────
// Por qué existe: el volumen llegó al 93% y no había forma de saber QUÉ lo ocupa. Sin este
// dato la decisión (ampliar el volumen o reconstruir algo) se toma a ciegas, y una estimación
// a ojo ya falló por un factor de diez.
//
// Todas las consultas de la primera parte son INSTANTÁNEAS: `page_count`, `page_size` y
// `freelist_count` se leen de la cabecera de la base, no recorren nada. El desglose por
// objeto usa dbstat, que SÍ lee el archivo completo y bloquea el proceso varios segundos,
// así que va detrás de ?detalle=1 y nunca se ejecuta por accidente.
router.get('/db-size', (req, res) => {
  if (!checkAuth(req, res)) return;
  try {
    const db = getDb();
    const dbPath = resolve(process.env.DB_PATH || './data/oicp.db');
    const pageCount = Number((db.pragma('page_count', { simple: true }) as any) || 0);
    const pageSize = Number((db.pragma('page_size', { simple: true }) as any) || 0);
    const freelist = Number((db.pragma('freelist_count', { simple: true }) as any) || 0);

    const tam = (p: string) => { try { return statSync(p).size; } catch { return 0; } };
    const archivos = {
      db_bytes: tam(dbPath),
      wal_bytes: tam(dbPath + '-wal'),
      shm_bytes: tam(dbPath + '-shm'),
      sobrantes_bytes: ['.corrupt', '.incoming', '.incoming.gz']
        .reduce((s, suf) => s + tam(dbPath + suf), 0),
    };

    let volumen: any = null;
    try {
      const st = statfsSync(dbPath) as any;
      volumen = {
        total_bytes: st.blocks * st.bsize,
        libre_bytes: st.bavail * st.bsize,
        usado_pct: Math.round((1 - (st.bavail / st.blocks)) * 100),
      };
    } catch { /* statfs no disponible en esta plataforma */ }

    const salida: any = {
      paginas: { total: pageCount, libres: freelist, tamano_pagina: pageSize },
      // Espacio ya liberado dentro del archivo pero que SQLite no devuelve al sistema:
      // solo un VACUUM lo recupera, y VACUUM necesita espacio libre del tamaño de la base.
      reutilizable_bytes: freelist * pageSize,
      reutilizable_pct: pageCount ? Math.round((freelist / pageCount) * 100) : 0,
      archivos, volumen,
      nota: 'Agrega ?detalle=1 para el desglose por tabla e índice. ADVERTENCIA: ese modo recorre el archivo completo y deja la plataforma sin responder varios segundos.',
    };

    if (req.query.detalle === '1') {
      // dbstat recorre todo el archivo: es la operación cara y por eso es explícita.
      salida.por_objeto = db.prepare(`
        SELECT name AS objeto, SUM(pgsize) AS bytes, COUNT(*) AS paginas
        FROM dbstat GROUP BY name ORDER BY bytes DESC LIMIT 40`).all();
      salida.tablas_e_indices = db.prepare(`
        SELECT type, name, tbl_name FROM sqlite_master
        WHERE type IN ('table','index') ORDER BY type, name`).all();
    }
    res.json(salida);
  } catch (e: any) {
    res.status(500).json({ error: `No se pudo medir la base: ${e.message}` });
  }
});

// ── LLAVE TEMPORAL DE ADMIN (45 min, hasheada; para restauraciones via curl) ──
function ensureSettings(db: any) {
  db.exec(`CREATE TABLE IF NOT EXISTS mcp_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
}

function checkTempKey(req: any): boolean {
  const provided = (req.query.tempkey || req.headers['x-temp-key']) as string;
  if (!provided || provided.length < 32) return false;
  try {
    const db = getDb();
    ensureSettings(db);
    const row = db.prepare(`SELECT value FROM mcp_settings WHERE key = 'temp_admin_key'`).get() as any;
    if (!row) return false;
    const { hash, exp } = JSON.parse(row.value);
    if (Date.now() > exp) return false;
    const h = crypto.createHash('sha256').update(provided).digest('hex');
    return h.length === hash.length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(hash));
  } catch { return false; }
}

router.post('/temp-key', (req, res) => {
  if (!checkAuth(req, res)) return;
  const db = getDb();
  ensureSettings(db);
  const key = crypto.randomBytes(32).toString('hex');
  const value = JSON.stringify({ hash: crypto.createHash('sha256').update(key).digest('hex'), exp: Date.now() + 45 * 60 * 1000 });
  db.prepare(`INSERT INTO mcp_settings (key, value) VALUES ('temp_admin_key', ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(value);
  res.json({ success: true, key, expira_en_min: 45 });
});

// ── RESTAURACIÓN POR PARTES (para bases que exceden el limite de un solo POST) ──
router.post('/restore-chunk', express.raw({ type: '*/*', limit: '30mb' }), (req, res) => {
  if (!checkTempKey(req) && !checkAuth(req, res)) return;
  try {
    const part = Number(req.query.part || 0);
    const dbPath = resolve(process.env.DB_PATH || './data/oicp.db');
    const inc = dbPath + '.incoming.gz';
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
    if (part === 0) writeFileSync(inc, buf);
    else appendFileSync(inc, buf);
    res.json({ success: true, part, bytes_total: statSync(inc).size });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/restore-commit', express.json({ limit: '1mb' }), async (req, res) => {
  if (await updaterRunning()) return res.status(409).json({ error: 'El actualizador incremental está corriendo; el reemplazo de base cerraría su conexión. Detenlo primero con POST /api/admin/stop-update.' });
  if (!checkTempKey(req) && !checkAuth(req, res)) return;
  try {
    req.setTimeout(1800000); res.setTimeout(1800000);
    const dbPath = resolve(process.env.DB_PATH || './data/oicp.db');
    const inc = dbPath + '.incoming.gz';
    const out = dbPath + '.incoming';
    const fsx = await import('fs');
    const { createGunzip } = await import('zlib');
    const { pipeline } = await import('stream/promises');
    if (!fsx.existsSync(inc)) return res.status(400).json({ error: 'No hay archivo .incoming.gz (sube las partes primero)' });
    const expected = Number(req.body?.expected_gz_bytes || 0);
    const got = fsx.statSync(inc).size;
    if (expected && expected !== got) {
      return res.status(400).json({ error: `Tamaño no coincide: esperado ${expected}, recibido ${got}` });
    }
    // gunzip por streaming (¿gz? mira los magic bytes)
    const fd = fsx.openSync(inc, 'r');
    const head2 = Buffer.alloc(2); fsx.readSync(fd, head2, 0, 2, 0); fsx.closeSync(fd);
    if (head2[0] === 0x1f && head2[1] === 0x8b) {
      await pipeline(fsx.createReadStream(inc), createGunzip(), fsx.createWriteStream(out));
      fsx.unlinkSync(inc);
    } else {
      fsx.renameSync(inc, out);
    }
    const fd2 = fsx.openSync(out, 'r');
    const head = Buffer.alloc(15); fsx.readSync(fd2, head, 0, 15, 0); fsx.closeSync(fd2);
    if (!head.toString('ascii').startsWith('SQLite format')) {
      return res.status(400).json({ error: 'El archivo ensamblado no es SQLite válido' });
    }
    const size = fsx.statSync(out).size;
    closeDbForReplace();
    for (const suf of ['-wal', '-shm']) {
      try { fsx.unlinkSync(dbPath + suf); } catch { /* puede no existir */ }
    }
    fsx.renameSync(out, dbPath);
    replaceDatabase(dbPath);
    invalidateStatsCache();
    // la llave temporal se consume al restaurar
    try { getDb().prepare(`DELETE FROM mcp_settings WHERE key = 'temp_admin_key'`).run(); } catch { /* opcional */ }
    // liberar el volumen: las copias .corrupt-* apartadas ya no hacen falta
    try {
      const dir = (await import('path')).dirname(dbPath);
      for (const f of fsx.readdirSync(dir)) {
        if (f.includes('.corrupt-')) fsx.unlinkSync((await import('path')).join(dir, f));
      }
    } catch { /* limpieza opcional */ }
    res.json({ success: true, message: `Base restaurada (${(size / 1048576).toFixed(0)} MB).`, size });
  } catch (err: any) {
    res.status(500).json({ error: `Error al restaurar: ${err.message}` });
  }
});

// ── RESTORE FROM URL (el servidor descarga el .db/.db.gz por streaming) ──
// Para bases grandes que exceden el límite del upload directo. La URL debe ser
// un enlace de descarga directa; si es .gz se descomprime en streaming.
router.post('/restore-from-url', express.json({ limit: '1mb' }), async (req, res) => {
  if (await updaterRunning()) return res.status(409).json({ error: 'El actualizador incremental está corriendo; el reemplazo de base cerraría su conexión. Detenlo primero con POST /api/admin/stop-update.' });
  if (!checkAuth(req, res)) return;
  const url = String(req.body?.url || '');
  if (!/^https:\/\//.test(url)) return res.status(400).json({ error: 'URL https requerida en body.url' });
  try {
    req.setTimeout(1800000); res.setTimeout(1800000);
    const dbPath = resolve(process.env.DB_PATH || './data/oicp.db');
    const tmpPath = dbPath + '.incoming';
    const r = await fetch(url, { redirect: 'follow' });
    if (!r.ok || !r.body) return res.status(502).json({ error: `Descarga falló: HTTP ${r.status}` });

    const { createWriteStream } = await import('fs');
    const { createGunzip } = await import('zlib');
    const { Readable } = await import('stream');
    const { pipeline } = await import('stream/promises');

    const isGz = /\.gz($|\?)/.test(url) || (r.headers.get('content-type') || '').includes('gzip');
    const source = Readable.fromWeb(r.body as any);
    if (isGz) await pipeline(source, createGunzip(), createWriteStream(tmpPath));
    else await pipeline(source, createWriteStream(tmpPath));

    const { statSync, openSync, readSync, closeSync, renameSync } = await import('fs');
    const size = statSync(tmpPath).size;
    const fd = openSync(tmpPath, 'r');
    const head = Buffer.alloc(15);
    readSync(fd, head, 0, 15, 0);
    closeSync(fd);
    if (!head.toString('ascii').startsWith('SQLite format')) {
      return res.status(400).json({ error: `El archivo descargado no es SQLite (${size} bytes)` });
    }
    renameSync(tmpPath, dbPath);
    replaceDatabase(dbPath);
    invalidateStatsCache();
    res.json({ success: true, message: `Base restaurada (${(size / 1048576).toFixed(0)} MB) desde URL.`, size });
  } catch (err: any) {
    res.status(500).json({ error: `Error al restaurar: ${err.message}` });
  }
});

// ── MCP: construir agregados a_* (una vez, o tras actualizar datos) ──
router.post('/build-analytics', (req, res) => {
  if (!checkAuth(req, res)) return;
  try {
    const stats = buildAnalytics(getDb());
    res.json({ success: true, ...stats });
  } catch (err: any) {
    res.status(500).json({ error: `Error al construir agregados: ${err.message}` });
  }
});

router.get('/analytics-status', (req, res) => {
  if (!checkAuth(req, res)) return;
  try {
    const db = getDb();
    const ready = analyticsReady(db);
    const counts: Record<string, number> = {};
    if (ready) {
      for (const t of ['a_suppliers', 'a_buyers', 'a_supplier_buyer', 'a_fts']) {
        counts[t] = (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as any).n;
      }
    }
    res.json({ ready, counts });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── MCP: emitir/rotar el token del conector (se muestra UNA sola vez) ──
router.post('/mcp-token', (req, res) => {
  if (!checkAuth(req, res)) return;
  try {
    const token = mintMcpToken(getDb());
    const base = (process.env.APP_URL || 'https://oicp-production.up.railway.app').replace(/\/+$/, '');
    res.json({ success: true, connector_url: `${base}/mcp/${token}`,
      nota: 'Guarda esta URL: el token no se puede recuperar (solo rotar). Cualquiera con la URL puede consultar los datos.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
