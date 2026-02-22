import { Router } from 'express';
import express from 'express';
import { migrate, upsertProcedure, rebuildConcentrationIndex, replaceDatabase } from '../db.js';
import { evaluateAllFlags, getRegime } from '../flag-engine.js';
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

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

function checkAuth(req: any, res: any): boolean {
  const key = process.env.ADMIN_KEY || 'oicp-admin-2026';
  const provided = req.query.key || req.headers['x-admin-key'];
  if (provided !== key) {
    res.status(403).json({ error: 'Clave admin incorrecta' });
    return false;
  }
  return true;
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
router.post('/upload-db', express.raw({ type: '*/*', limit: '500mb' }), async (req, res) => {
  if (!checkAuth(req, res)) return;

  try {
    req.setTimeout(600000);
    res.setTimeout(600000);

    let buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');

    if (buffer.length < 50) {
      return res.status(400).json({ error: `Archivo demasiado pequeño (${buffer.length} bytes). ¿Seleccionaste el archivo correcto?` });
    }

    // Decompress gzip if needed (browser sends gzipped)
    if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
      const zlib = await import('zlib');
      buffer = zlib.gunzipSync(buffer);
    }

    // Check SQLite magic bytes
    const header = buffer.toString('ascii', 0, 15);
    if (!header.startsWith('SQLite format')) {
      return res.status(400).json({ error: `No es un archivo SQLite válido. Header: "${header.substring(0,10)}", size: ${buffer.length}` });
    }

    // Save and replace
    const dbPath = resolve(process.env.DB_PATH || './data/oicp.db');
    writeFileSync(dbPath, buffer);
    replaceDatabase(dbPath);

    const sizeMB = (buffer.length / 1048576).toFixed(1);
    res.json({
      success: true,
      message: `Base de datos reemplazada exitosamente (${sizeMB} MB). La plataforma ya muestra los nuevos datos.`,
      size: buffer.length,
    });
  } catch (err: any) {
    res.status(500).json({ error: `Error al subir: ${err.message}` });
  }
});

// ── BATCH UPLOAD (chunked, for large databases) ─────────────
router.post('/batch-clear', express.json({ limit: '1mb' }), async (req, res) => {
  if (!checkAuth(req, res)) return;
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

// ── ADMIN PAGE ──────────────────────────────────────────────
router.get('/', (req, res) => {
  if (!checkAuth(req, res)) return;
  const key = req.query.key;
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
const K='${key}',B='/api/admin';

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
    const r=await fetch(B+'/upload-db?key='+K,{method:'POST',body:blob,headers:{'Content-Type':'application/octet-stream'}});
    const d=await r.json();
    if(d.success){el.className='st ok';el.textContent='✅ '+d.message}
    else{el.className='st err';el.textContent='❌ '+d.error}
  }catch(e){el.className='st err';el.textContent='Error: '+e.message+'. Si el archivo es muy grande, usa el script subir.mjs desde CMD.'}
}

async function diag(){const el=document.getElementById('diag');el.style.display='block';el.className='st run';el.textContent='Probando...';
try{const r=await fetch(B+'/test?key='+K);const d=await r.json();
const ok=d.every(t=>!t.error&&t.status!==429);el.className=ok?'st ok':'st err';el.textContent=JSON.stringify(d,null,2);
if(!ok)el.textContent+='\\n\\n⚠️ SERCOP bloqueando. Usa descarga local.'}catch(e){el.textContent='Error: '+e.message}}

async function l(y){if(!confirm('Cargar '+y+'?'))return;const r=await fetch(B+'/load?key='+K+'&year='+y,{method:'POST'});alert((await r.json()).message);ck()}
async function lt(y,t){const r=await fetch(B+'/load?key='+K+'&year='+y+'&term='+encodeURIComponent(t),{method:'POST'});alert((await r.json()).message);ck()}
async function stp(){if(!confirm('Detener?'))return;await fetch(B+'/stop?key='+K,{method:'POST'});ck()}
async function ck(){try{const r=await fetch(B+'/status?key='+K),d=await r.json(),e=document.getElementById('s'),p=document.getElementById('p'),pf=document.getElementById('pf'),pt=document.getElementById('pt'),bs=document.getElementById('bs');
if(d.running){e.className='st run';e.textContent='EN CURSO — Año: '+d.year+'\\n'+d.progress+'\\nDescargados: '+d.count+'\\nDuplicados: '+d.skippedDuplicates;
const pc=d.totalTerms>0?Math.round(d.termsCompleted/d.totalTerms*100):0;p.style.display='block';pf.style.width=pc+'%';pt.textContent=d.termsCompleted+'/'+d.totalTerms+' ('+pc+'%)';bs.style.display='inline-block'}
else{bs.style.display='none';p.style.display='none';if(d.count>0){e.className='st ok';e.textContent=d.progress}else{e.className='st idle';e.textContent='Sin descargas activas.'}}
if(d.errors?.length)e.textContent+='\\n\\nErrores:\\n'+d.errors.slice(-3).join('\\n')}catch(e){}}
setInterval(ck,10000);ck()
</script></body></html>`);
});

export default router;
