import { Router } from 'express';
import { migrate, upsertProcedure, rebuildConcentrationIndex } from '../db.js';
import { evaluateAllFlags, getRegime } from '../flag-engine.js';

const router = Router();

const SEARCH_API = 'https://datosabiertos.compraspublicas.gob.ec/PLATAFORMA/api/search_ocds';
const RECORD_API = 'https://datosabiertos.compraspublicas.gob.ec/PLATAFORMA/api/record';

// SERCOP rate limit = 60 requests/minute
// We do 2 requests per process (search page + record detail)
// So max ~30 processes/minute = 1 every 2 seconds
// Using 5 seconds to be safe and avoid getting blocked
const DELAY_BETWEEN_RECORDS = 5000;   // 5 sec between each OCDS record fetch
const DELAY_BETWEEN_PAGES = 3000;     // 3 sec between search pages
const DELAY_AFTER_429 = 120000;       // 2 minutes after a 429

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

// Fetch with retry and long backoff on 429
async function safeFetch(url: string): Promise<Response | null> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetch(url);
      
      if (response.status === 429) {
        const wait = DELAY_AFTER_429 * attempt; // 2min, 4min, 6min, 8min
        console.log(`429 rate limit. Waiting ${wait/1000}s (attempt ${attempt}/4)...`);
        await sleep(wait);
        continue;
      }
      
      // Check if response is HTML instead of JSON (SERCOP block page)
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('json') && response.ok) {
        const text = await response.text();
        if (text.startsWith('<!DOCTYPE') || text.startsWith('<html')) {
          console.log('Got HTML instead of JSON — SERCOP may be blocking. Waiting 3min...');
          await sleep(180000);
          continue;
        }
        // Try to parse as JSON anyway
        try {
          const data = JSON.parse(text);
          return new Response(text, { status: response.status, headers: response.headers });
        } catch {
          await sleep(60000);
          continue;
        }
      }
      
      return response;
    } catch (err: any) {
      if (attempt === 4) return null;
      await sleep(30000 * attempt);
    }
  }
  return null;
}

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
      results.push({
        test: 'Search API', status: response.status, 
        total: data.total, pages: data.pages, dataCount: data.data?.length,
        rateLimit: response.headers.get('x-ratelimit-remaining'),
      });
    } else {
      results.push({
        test: 'Search API',
        error: `Unexpected token '${text.charAt(0)}', "${text.substring(0, 30)}"... is not valid JSON`,
        note: 'SERCOP is returning HTML instead of JSON. The IP may be temporarily blocked. Wait a few hours and try again.',
      });
    }
  } catch (err: any) { results.push({ test: 'Search API', error: err.message }); }

  try {
    const url = `${RECORD_API}?ocid=ocds-5wno2w-001-LICO-GPLR-2020-2805`;
    const response = await fetch(url);
    results.push({ 
      test: 'Record API', status: response.status, ok: response.ok,
      rateLimit: response.headers.get('x-ratelimit-remaining'),
      note: response.status === 429 ? 'Rate limited. Wait a few hours.' : 'OK',
    });
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

// ── LOAD ────────────────────────────────────────────────────
router.post('/load', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const year = Number(req.query.year) || new Date().getFullYear();
  const term = req.query.term as string;

  if (currentJob.running) {
    return res.json({ message: 'Ya hay una descarga en curso. Espera o detenla primero.', status: currentJob });
  }

  const terms = term ? [term] : SEARCH_TERMS_FULL;
  currentJob = {
    running: true, year, progress: 'Iniciando...', count: 0, errors: [],
    currentTerm: '', termsCompleted: 0, totalTerms: terms.length, skippedDuplicates: 0,
    lastApiResponse: '', startedAt: new Date().toISOString(),
  };
  res.json({ message: `Descarga iniciada para ${year} (${terms.length} términos). Tarda varias horas — puedes cerrar esta página.`, status: currentJob });

  (async () => {
    try {
      const existingOcids = new Set<string>();
      let consecutiveErrors = 0;

      for (let t = 0; t < terms.length; t++) {
        if (!currentJob.running) break;
        
        // If too many consecutive errors, pause longer
        if (consecutiveErrors >= 5) {
          currentJob.progress = `Demasiados errores seguidos. Pausa de 5 minutos...`;
          await sleep(300000); // 5 min pause
          consecutiveErrors = 0;
        }

        const searchTerm = terms[t];
        currentJob.currentTerm = searchTerm;
        currentJob.termsCompleted = t;
        currentJob.progress = `[${t + 1}/${terms.length}] Buscando "${searchTerm}" en ${year}...`;

        let page = 1;
        let totalPages = 1;

        while (page <= totalPages && page <= 50 && currentJob.running) {
          try {
            const url = `${SEARCH_API}?year=${year}&search=${encodeURIComponent(searchTerm)}&page=${page}`;
            const response = await safeFetch(url);

            if (!response) {
              currentJob.errors.push(`Sin respuesta para "${searchTerm}" p${page}`);
              consecutiveErrors++;
              break;
            }

            currentJob.lastApiResponse = `HTTP ${response.status}`;

            if (!response.ok) {
              currentJob.errors.push(`HTTP ${response.status} en "${searchTerm}" p${page}`);
              consecutiveErrors++;
              if (response.status === 429) await sleep(DELAY_AFTER_429);
              break;
            }

            let searchData: any;
            try {
              const text = await response.text();
              searchData = JSON.parse(text);
            } catch {
              currentJob.errors.push(`Respuesta no-JSON en "${searchTerm}" p${page}. Posible bloqueo temporal.`);
              consecutiveErrors++;
              await sleep(60000); // 1 min
              break;
            }

            consecutiveErrors = 0; // Reset on success
            if (!searchData?.data) break;

            totalPages = searchData.pages || 1;
            const results = searchData.data || [];
            if (results.length === 0) break;

            currentJob.progress = `[${t + 1}/${terms.length}] "${searchTerm}" pág ${page}/${totalPages} — ${currentJob.count} descargados total`;

            for (const result of results) {
              if (!currentJob.running) break;
              const ocid = result.ocid;
              if (!ocid) continue;
              if (existingOcids.has(ocid)) { currentJob.skippedDuplicates++; continue; }
              existingOcids.add(ocid);

              // Save basic data from search first
              const basicProc = searchResultToProc(result, year);

              // Try to get full OCDS record
              await sleep(DELAY_BETWEEN_RECORDS);
              try {
                const recResp = await safeFetch(`${RECORD_API}?ocid=${encodeURIComponent(ocid)}`);

                if (recResp && recResp.ok) {
                  try {
                    const recText = await recResp.text();
                    const record = JSON.parse(recText);
                    if (record?.records?.[0]?.releases?.length) {
                      const releases = record.records[0].releases;
                      const release = releases[releases.length - 1];
                      const fullProc = ocdsReleaseToProc(release, result, year);
                      const { flags, score, riskLevel } = evaluateAllFlags(fullProc);
                      upsertProcedure({ ...fullProc, flags, score, risk_level: riskLevel });
                      currentJob.count++;
                      continue;
                    }
                  } catch {}
                }
              } catch {}

              // Fallback: save basic info
              const { flags, score, riskLevel } = evaluateAllFlags(basicProc);
              upsertProcedure({ ...basicProc, flags, score, risk_level: riskLevel });
              currentJob.count++;
            }

            page++;
            await sleep(DELAY_BETWEEN_PAGES);
          } catch (e: any) {
            currentJob.errors.push(`${searchTerm} p${page}: ${e.message}`);
            consecutiveErrors++;
            break;
          }
        }
      }

      if (currentJob.running) {
        rebuildConcentrationIndex(year);
        currentJob.progress = `✅ Completado: ${currentJob.count} procesos para ${year} (${currentJob.skippedDuplicates} duplicados omitidos)`;
      }
    } catch (e: any) {
      currentJob.progress = `Error: ${e.message}`;
      currentJob.errors.push(e.message);
    }
    currentJob.running = false;
  })();
});

// ══════════════════════════════════════════════════════════════
// FIELD MAPPINGS
// ══════════════════════════════════════════════════════════════
function searchResultToProc(r: any, year: number) {
  const amount = r.amount ? parseFloat(r.amount) : null;
  const budget = r.budget ? parseFloat(r.budget) : null;
  const buyerName = r.buyer || r.buyerName || null;
  const buyerId = r.buyerId || (buyerName ? 'EC-' + buyerName.substring(0, 30).replace(/[^A-Za-z0-9]/g, '-') : null);
  const suppliers: any[] = [];
  if (r.suppliers && typeof r.suppliers === 'string') suppliers.push({ id: '', name: r.suppliers });
  if (suppliers.length === 0 && r.single_provider) suppliers.push({ id: '', name: r.single_provider });

  return {
    id: r.ocid, ocid: r.ocid, title: r.title || r.description || '', description: r.description || r.title || '',
    status: 'unknown', procurement_method: r.method || '', procurement_method_details: r.internal_type || '',
    buyer_id: buyerId, buyer_name: buyerName,
    budget_amount: budget, budget_currency: 'USD', award_amount: amount, contract_amount: null, final_amount: null,
    published_date: r.date || null, submission_deadline: null, award_date: null, contract_date: null,
    suppliers, number_of_tenderers: null, items_classification: null,
    has_amendments: false, amendment_count: 0, source_year: year, regime: getRegime(r.date),
  };
}

function ocdsReleaseToProc(release: any, searchResult: any, year: number) {
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
  if (suppliers.length === 0 && searchResult?.suppliers && typeof searchResult.suppliers === 'string') {
    suppliers.push({ id: '', name: searchResult.suppliers });
  }
  if (suppliers.length === 0 && searchResult?.single_provider) suppliers.push({ id: '', name: searchResult.single_provider });

  const methodDetails = tender.procurementMethodDetails || searchResult?.internal_type || '';
  let method = tender.procurementMethod || searchResult?.method || '';
  if (!method) {
    const d = methodDetails.toLowerCase();
    if (d.includes('ínfima') || d.includes('infima')) method = 'limited';
    else if (d.includes('especial') || d.includes('emergente')) method = 'selective';
    else if (d.includes('catálogo')) method = 'direct';
    else method = 'open';
  }

  const buyerName = buyer.name || searchResult?.buyer || searchResult?.buyerName || null;
  const buyerId = buyer.id || searchResult?.buyerId || (buyerName ? 'EC-' + buyerName.substring(0, 30).replace(/[^A-Za-z0-9]/g, '-') : null);
  const dateForRegime = tender.tenderPeriod?.startDate || release.date || searchResult?.date || `${year}-06-15`;
  let amendmentCount = 0;
  for (const c of contracts) amendmentCount += (c.amendments || []).length;

  const budgetAmount = tender.value?.amount || release.planning?.budget?.amount?.amount || (searchResult?.budget ? parseFloat(searchResult.budget) : null);
  const awardAmount = firstAward.value?.amount || (searchResult?.amount ? parseFloat(searchResult.amount) : null);

  return {
    id: release.ocid || searchResult?.ocid, ocid: release.ocid || searchResult?.ocid,
    title: tender.title || tender.description || searchResult?.title || searchResult?.description || '',
    description: tender.description || searchResult?.description || '',
    status: release.tag?.includes('contract') ? 'contract' : release.tag?.includes('award') ? 'award' : release.tag?.includes('tender') ? 'tender' : 'planning',
    procurement_method: method, procurement_method_details: methodDetails,
    buyer_id: buyerId, buyer_name: buyerName,
    budget_amount: budgetAmount, budget_currency: 'USD',
    award_amount: awardAmount, contract_amount: firstContract.value?.amount || null,
    final_amount: firstContract.implementation?.finalValue?.amount || null,
    published_date: tender.tenderPeriod?.startDate || release.date || searchResult?.date || null,
    submission_deadline: tender.tenderPeriod?.endDate || null,
    award_date: firstAward.date || null, contract_date: firstContract.dateSigned || null,
    suppliers, number_of_tenderers: tender.numberOfTenderers || release.bids?.details?.length || null,
    items_classification: tender.items?.[0]?.classification?.id || null,
    has_amendments: amendmentCount > 0, amendment_count: amendmentCount,
    source_year: year, regime: getRegime(dateForRegime),
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
.st{padding:16px;border-radius:8px;margin:12px 0;font-family:monospace;font-size:12px;line-height:1.6;white-space:pre-wrap;overflow-x:auto;max-height:400px;overflow-y:auto}
.run{background:#fef3c7;border:1px solid #f59e0b}.ok{background:#d1fae5;border:1px solid #10b981}
.idle{background:#f3f4f6;border:1px solid #d1d5db}
.err{background:#fee2e2;border:1px solid #f87171}
.info{background:#eff6ff;border:1px solid #93c5fd;padding:16px;border-radius:8px;margin:16px 0;font-size:14px;line-height:1.5}
.warn{background:#fef3c7;border:1px solid #f59e0b;padding:12px;border-radius:8px;font-size:13px;margin:8px 0}
.bar{height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden;margin-top:8px}
.fill{height:100%;background:#2563eb;border-radius:4px;transition:width .5s}
</style></head><body>
<h1>OICP Admin</h1>

<div class="info">
<b>Velocidad de descarga:</b> ~12 procesos/minuto (para respetar los límites de SERCOP).<br>
Un año completo puede tardar <b>4-8 horas</b>. Puedes cerrar esta página — la descarga sigue en el servidor.<br>
Si SERCOP bloquea la IP (error 429 o HTML), el sistema espera automáticamente y reintenta.
</div>

<div class="card">
<h2>1. Diagnóstico (ejecutar primero)</h2>
<button class="diag" onclick="diag()">Probar conexión a SERCOP</button>
<div id="diag" class="st idle" style="display:none"></div>
</div>

<div class="card">
<h2>2. Prueba rápida (5-10 min)</h2>
<button class="sm" onclick="lt(2024,'agua')">agua 2024</button>
<button class="sm" onclick="lt(2024,'construccion')">construccion 2024</button>
<button class="sm" onclick="lt(2025,'servicio')">servicio 2025</button>
</div>

<div class="card">
<h2>3. Cargar año completo (4-8 horas)</h2>
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
<button class="stop" id="bs" style="display:none" onclick="stp()">Detener</button>
</div>

<div class="card"><a href="/" target="_blank">Ver plataforma OICP</a></div>

<script>
const K='${key}',B='/api/admin';
async function diag(){const el=document.getElementById('diag');el.style.display='block';el.className='st run';el.textContent='Probando conexión...';
try{const r=await fetch(B+'/test?key='+K);const d=await r.json();
const ok=d.every(t=>!t.error&&t.status!==429);
el.className=ok?'st ok':'st err';el.textContent=JSON.stringify(d,null,2);
if(!ok)el.textContent+='\\n\\n⚠️ SERCOP está bloqueando. Espera unas horas e intenta de nuevo.'}catch(e){el.textContent='Error: '+e.message}}
async function l(y){if(!confirm('Cargar '+y+'? (4-8 horas)\\n\\nPuedes cerrar la página, la descarga sigue.'))return;const r=await fetch(B+'/load?key='+K+'&year='+y,{method:'POST'});alert((await r.json()).message);ck()}
async function lt(y,t){const r=await fetch(B+'/load?key='+K+'&year='+y+'&term='+encodeURIComponent(t),{method:'POST'});alert((await r.json()).message);ck()}
async function stp(){if(!confirm('Detener?'))return;await fetch(B+'/stop?key='+K,{method:'POST'});ck()}
async function ck(){try{const r=await fetch(B+'/status?key='+K),d=await r.json(),e=document.getElementById('s'),p=document.getElementById('p'),pf=document.getElementById('pf'),pt=document.getElementById('pt'),bs=document.getElementById('bs');
if(d.running){e.className='st run';e.textContent='EN CURSO — Año: '+d.year+'\\n'+d.progress+'\\nDescargados: '+d.count+'\\nDuplicados: '+d.skippedDuplicates+'\\nIniciado: '+d.startedAt;
const pc=d.totalTerms>0?Math.round(d.termsCompleted/d.totalTerms*100):0;p.style.display='block';pf.style.width=pc+'%';pt.textContent=d.termsCompleted+'/'+d.totalTerms+' ('+pc+'%)';bs.style.display='inline-block'}
else{bs.style.display='none';p.style.display='none';if(d.count>0){e.className='st ok';e.textContent=d.progress}else{e.className='st idle';e.textContent='Sin descargas activas.'}}
if(d.errors?.length)e.textContent+='\\n\\nErrores recientes:\\n'+d.errors.slice(-3).join('\\n')}catch(e){}}
setInterval(ck,10000);ck()
</script></body></html>`);
});

export default router;
