/**
 * Admin routes — Allows triggering data loads from the browser
 * Protected by a simple secret key set in environment variable ADMIN_KEY
 */
import { Router } from 'express';
import { migrate, upsertProcedure, rebuildConcentrationIndex } from '../db.js';
import { evaluateAllFlags, getRegime, getInfimaThreshold } from '../flag-engine.js';

const router = Router();

const SEARCH_API = 'https://datosabiertos.compraspublicas.gob.ec/PLATAFORMA/api/search_ocds';
const RECORD_API = 'https://datosabiertos.compraspublicas.gob.ec/PLATAFORMA/api/record';

// Delay between requests — SERCOP rate limits aggressively
const DELAY_MS = 2500;
const DELAY_AFTER_429 = 30000;

// Comprehensive search terms to capture ALL processes
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
  'unidad', 'dirección', 'secretaría', 'junta',
  'infraestructura', 'instalación', 'implementación',
  'elaboración', 'producción', 'distribución',
  'evaluación', 'supervisión', 'control', 'gestión',
  'asesoría', 'asistencia', 'técnico', 'profesional',
  'nacional', 'público', 'general', 'especial',
];

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function fetchWithRetry(url: string, maxRetries = 3): Promise<any> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url);
      if (response.status === 429) {
        const waitTime = DELAY_AFTER_429 * attempt;
        console.log(`  Rate limited (429). Waiting ${waitTime / 1000}s...`);
        await sleep(waitTime);
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (err: any) {
      if (attempt === maxRetries) throw err;
      await sleep(5000 * attempt);
    }
  }
  return null;
}

function checkAuth(req: any, res: any): boolean {
  const key = process.env.ADMIN_KEY || 'oicp-admin-2026';
  const provided = req.query.key || req.headers['x-admin-key'];
  if (provided !== key) {
    res.status(403).json({ error: 'Clave admin incorrecta' });
    return false;
  }
  return true;
}

let currentJob = {
  running: false, year: 0, progress: '', count: 0, errors: [] as string[],
  currentTerm: '', termsCompleted: 0, totalTerms: 0, skippedDuplicates: 0,
};

router.get('/status', (req, res) => {
  if (!checkAuth(req, res)) return;
  res.json(currentJob);
});

router.post('/stop', (req, res) => {
  if (!checkAuth(req, res)) return;
  if (currentJob.running) {
    currentJob.running = false;
    currentJob.progress = 'Detenido. Datos descargados conservados.';
    res.json({ message: 'Descarga detenida', status: currentJob });
  } else {
    res.json({ message: 'No hay descarga activa' });
  }
});

router.post('/load', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const year = Number(req.query.year) || new Date().getFullYear();
  const term = req.query.term as string;

  if (currentJob.running) {
    return res.json({ message: 'Ya hay una descarga en curso.', status: currentJob });
  }

  const terms = term ? [term] : SEARCH_TERMS_FULL;
  currentJob = {
    running: true, year, progress: 'Iniciando...', count: 0, errors: [],
    currentTerm: '', termsCompleted: 0, totalTerms: terms.length, skippedDuplicates: 0,
  };
  res.json({ message: `Descarga iniciada para ${year} (${terms.length} términos)`, status: currentJob });

  (async () => {
    try {
      const existingOcids = new Set<string>();

      for (let t = 0; t < terms.length; t++) {
        if (!currentJob.running) break;
        const searchTerm = terms[t];
        currentJob.currentTerm = searchTerm;
        currentJob.termsCompleted = t;
        currentJob.progress = `[${t + 1}/${terms.length}] Buscando "${searchTerm}" en ${year}...`;

        let page = 1;
        let totalPages = 1;

        while (page <= totalPages && page <= 50 && currentJob.running) {
          try {
            const url = `${SEARCH_API}?year=${year}&search=${encodeURIComponent(searchTerm)}&page=${page}`;
            const searchData = await fetchWithRetry(url);
            if (!searchData || !searchData.data) break;

            totalPages = searchData.pages || 1;
            const results = searchData.data || [];
            if (results.length === 0) break;

            currentJob.progress = `[${t + 1}/${terms.length}] "${searchTerm}" pág ${page}/${totalPages} (${currentJob.count} total)`;

            for (const result of results) {
              if (!currentJob.running) break;
              const ocid = result.ocid;
              if (!ocid) continue;
              if (existingOcids.has(ocid)) { currentJob.skippedDuplicates++; continue; }
              existingOcids.add(ocid);

              await sleep(DELAY_MS);

              try {
                const record = await fetchWithRetry(`${RECORD_API}?ocid=${encodeURIComponent(ocid)}`);
                if (record?.records?.[0]?.releases?.length) {
                  const releases = record.records[0].releases;
                  const release = releases[releases.length - 1];
                  const proc = parseReleaseForAdmin(release, result, year);
                  const { flags, score, riskLevel } = evaluateAllFlags(proc);
                  upsertProcedure({ ...proc, flags, score, risk_level: riskLevel });
                  currentJob.count++;
                } else {
                  const proc = basicProcFromSearch(result, year);
                  const { flags, score, riskLevel } = evaluateAllFlags(proc);
                  upsertProcedure({ ...proc, flags, score, risk_level: riskLevel });
                  currentJob.count++;
                }
              } catch (e: any) {
                try {
                  const proc = basicProcFromSearch(result, year);
                  const { flags, score, riskLevel } = evaluateAllFlags(proc);
                  upsertProcedure({ ...proc, flags, score, risk_level: riskLevel });
                  currentJob.count++;
                } catch {}
                if (e.message?.includes('429')) {
                  currentJob.errors.push(`Rate limit. Esperando 30s...`);
                  await sleep(DELAY_AFTER_429);
                }
              }
            }
            page++;
            await sleep(DELAY_MS);
          } catch (e: any) {
            currentJob.errors.push(`${searchTerm} p${page}: ${e.message}`);
            if (e.message?.includes('429')) await sleep(DELAY_AFTER_429);
            break;
          }
        }
      }

      if (currentJob.running) {
        rebuildConcentrationIndex(year);
        currentJob.progress = `Completado: ${currentJob.count} procedimientos para ${year} (${currentJob.skippedDuplicates} duplicados omitidos)`;
      }
    } catch (e: any) {
      currentJob.progress = `Error: ${e.message}`;
      currentJob.errors.push(e.message);
    }
    currentJob.running = false;
  })();
});

router.get('/', (req, res) => {
  if (!checkAuth(req, res)) return;
  const key = req.query.key;
  res.send(`<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OICP Admin</title>
<style>
body{font-family:system-ui,sans-serif;max-width:750px;margin:40px auto;padding:0 20px;background:#f9fafb;color:#1f2937}
h1{color:#1e40af}h2{color:#374151;margin-top:0}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;margin:16px 0;box-shadow:0 1px 3px rgba(0,0,0,.1)}
button{background:#2563eb;color:#fff;border:none;padding:12px 24px;border-radius:8px;font-size:15px;cursor:pointer;margin:4px}
button:hover{background:#1d4ed8}button:disabled{background:#9ca3af;cursor:wait}
.stop{background:#dc2626}.stop:hover{background:#b91c1c}
.sm{padding:8px 16px;font-size:13px;background:#059669}.sm:hover{background:#047857}
.st{padding:16px;border-radius:8px;margin:12px 0;font-family:monospace;font-size:13px;line-height:1.6;white-space:pre-wrap}
.run{background:#fef3c7;border:1px solid #f59e0b}.ok{background:#d1fae5;border:1px solid #10b981}
.idle{background:#f3f4f6;border:1px solid #d1d5db}
.info{background:#eff6ff;border:1px solid #93c5fd;padding:16px;border-radius:8px;margin:16px 0;font-size:14px;line-height:1.5}
.warn{background:#fef3c7;border:1px solid #f59e0b;padding:12px;border-radius:8px;font-size:13px;margin:8px 0}
.bar{height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden;margin-top:8px}
.fill{height:100%;background:#2563eb;border-radius:4px;transition:width .5s}
small{color:#6b7280}
</style></head><body>
<h1>OICP Admin — Cargar Datos SERCOP</h1>
<div class="info">
<b>Instrucciones:</b><br>
1. Haz una prueba rápida primero (2-5 min)<br>
2. Luego carga año por año (2-4 horas cada uno)<br>
3. Puedes cerrar esta página y volver después<br>
4. Los datos no se duplican al re-ejecutar<br>
<br><b>Para 7 años completos:</b> carga uno a la vez: 2025 → 2024 → 2023 → ... → 2019
</div>

<div class="card">
<h2>Prueba rápida (2-5 min)</h2>
<button class="sm" onclick="lt(2024,'construcción')">construcción 2024</button>
<button class="sm" onclick="lt(2025,'servicio')">servicio 2025</button>
<button class="sm" onclick="lt(2024,'adquisición')">adquisición 2024</button>
</div>

<div class="card">
<h2>Cargar año completo (2-4 horas)</h2>
<button onclick="l(2025)">2025</button>
<button onclick="l(2024)">2024</button>
<button onclick="l(2023)">2023</button>
<button onclick="l(2022)">2022</button>
<button onclick="l(2021)">2021</button>
<button onclick="l(2020)">2020</button>
<button onclick="l(2019)">2019</button>
<div class="warn">Solo un año a la vez. Cuando termine, inicia el siguiente.</div>
</div>

<div class="card">
<h2>Estado</h2>
<div id="s" class="st idle">Cargando...</div>
<div id="p" style="display:none"><div class="bar"><div id="pf" class="fill" style="width:0%"></div></div><small id="pt"></small></div>
<br>
<button onclick="ck()">Actualizar</button>
<button class="stop" id="bs" style="display:none" onclick="st()">Detener</button>
</div>

<div class="card">
<h2>Enlaces</h2>
<p><a href="/" target="_blank">Ver plataforma OICP</a></p>
</div>

<script>
const K='${key}',B='/api/admin';
async function l(y){if(!confirm('Cargar '+y+'? Tarda 2-4 horas.'))return;const r=await fetch(B+'/load?key='+K+'&year='+y,{method:'POST'});alert((await r.json()).message);ck()}
async function lt(y,t){const r=await fetch(B+'/load?key='+K+'&year='+y+'&term='+encodeURIComponent(t),{method:'POST'});alert((await r.json()).message);ck()}
async function st(){if(!confirm('Detener?'))return;await fetch(B+'/stop?key='+K,{method:'POST'});ck()}
async function ck(){try{const r=await fetch(B+'/status?key='+K),d=await r.json(),e=document.getElementById('s'),p=document.getElementById('p'),pf=document.getElementById('pf'),pt=document.getElementById('pt'),bs=document.getElementById('bs');
if(d.running){e.className='st run';e.textContent='EN CURSO — Año: '+d.year+'\\n'+d.progress+'\\nDescargados: '+d.count+'\\nDuplicados omitidos: '+d.skippedDuplicates;const pc=d.totalTerms>0?Math.round(d.termsCompleted/d.totalTerms*100):0;p.style.display='block';pf.style.width=pc+'%';pt.textContent=d.termsCompleted+'/'+d.totalTerms+' términos ('+pc+'%)';bs.style.display='inline-block'}
else{bs.style.display='none';if(d.count>0){e.className='st ok';e.textContent=d.progress;p.style.display='none'}else{e.className='st idle';e.textContent='Sin descargas activas.';p.style.display='none'}}
if(d.errors?.length)e.textContent+='\\n\\nErrores: '+d.errors.slice(-3).join('\\n')}catch(e){}}
setInterval(ck,8000);ck()
</script></body></html>`);
});

function parseReleaseForAdmin(release: any, searchResult: any, year: number): any {
  const tender = release.tender || {};
  const awards = release.awards || [];
  const contracts = release.contracts || [];
  const buyer = release.buyer || tender.procuringEntity || {};
  const firstAward = awards[0] || {};
  const firstContract = contracts[0] || {};
  const suppliers: any[] = [];
  for (const award of awards) {
    for (const sup of (award.suppliers || [])) {
      const id = sup.id || sup.identifier?.id || '';
      const name = sup.name || '';
      if ((id || name) && !suppliers.find((s: any) => s.id === id && s.name === name)) suppliers.push({ id, name });
    }
  }
  if (suppliers.length === 0 && searchResult?.single_provider) suppliers.push({ id: '', name: searchResult.single_provider });
  const methodDetails = tender.procurementMethodDetails || searchResult?.internal_type || '';
  let method = tender.procurementMethod || '';
  if (!method) {
    const d = methodDetails.toLowerCase();
    if (d.includes('ínfima') || d.includes('infima')) method = 'limited';
    else if (d.includes('especial') || d.includes('emergente')) method = 'selective';
    else if (d.includes('catálogo')) method = 'direct';
    else method = 'open';
  }
  const dateForRegime = tender.tenderPeriod?.startDate || release.date || `${year}-06-15`;
  let amendmentCount = 0;
  for (const c of contracts) amendmentCount += (c.amendments || []).length;
  return {
    id: release.ocid || searchResult?.ocid, ocid: release.ocid || searchResult?.ocid,
    title: tender.title || searchResult?.title || '', description: tender.description || searchResult?.description || '',
    status: release.tag?.includes('contract') ? 'contract' : release.tag?.includes('award') ? 'award' : 'tender',
    procurement_method: method, procurement_method_details: methodDetails,
    buyer_id: buyer.id || searchResult?.buyerId || null, buyer_name: buyer.name || searchResult?.buyerName || null,
    budget_amount: tender.value?.amount || release.planning?.budget?.amount?.amount || null, budget_currency: 'USD',
    award_amount: firstAward.value?.amount || null, contract_amount: firstContract.value?.amount || null,
    final_amount: firstContract.implementation?.finalValue?.amount || null,
    published_date: tender.tenderPeriod?.startDate || release.date || null,
    submission_deadline: tender.tenderPeriod?.endDate || null,
    award_date: firstAward.date || null, contract_date: firstContract.dateSigned || null,
    suppliers, number_of_tenderers: tender.numberOfTenderers || (release.bids?.details?.length) || null,
    items_classification: tender.items?.[0]?.classification?.id || null,
    has_amendments: amendmentCount > 0, amendment_count: amendmentCount,
    source_year: year, regime: getRegime(dateForRegime),
  };
}

function basicProcFromSearch(result: any, year: number): any {
  return {
    id: result.ocid, ocid: result.ocid, title: result.title || '', description: result.description || '',
    status: 'unknown', procurement_method: '', procurement_method_details: result.internal_type || '',
    buyer_id: result.buyerId || null, buyer_name: result.buyerName || null,
    budget_amount: null, budget_currency: 'USD', award_amount: null, contract_amount: null, final_amount: null,
    published_date: result.date || null, submission_deadline: null, award_date: null, contract_date: null,
    suppliers: result.single_provider ? [{ id: '', name: result.single_provider }] : [],
    number_of_tenderers: null, items_classification: null,
    has_amendments: false, amendment_count: 0,
    source_year: year, regime: getRegime(result.date),
  };
}

export default router;
