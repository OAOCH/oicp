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
const DELAY_MS = 600;

const SEARCH_TERMS = [
  'adquisición', 'servicio', 'construcción', 'consultoría',
  'suministro', 'mantenimiento', 'provisión', 'contratación',
  'compra', 'obra', 'transporte', 'limpieza',
  'alimentación', 'medicamentos', 'equipos', 'mobiliario',
  'capacitación', 'seguridad', 'sistema', 'proyecto',
  'mejoramiento', 'rehabilitación', 'ampliación', 'reparación',
  'estudio', 'diseño', 'fiscalización', 'auditoría',
];

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function checkAuth(req: any, res: any): boolean {
  const key = process.env.ADMIN_KEY || 'oicp-admin-2026';
  const provided = req.query.key || req.headers['x-admin-key'];
  if (provided !== key) {
    res.status(403).json({ error: 'Clave admin incorrecta. Agrega ?key=TU_CLAVE a la URL.' });
    return false;
  }
  return true;
}

// Track ongoing jobs
let currentJob: { running: boolean; year: number; progress: string; count: number; errors: string[] } = {
  running: false, year: 0, progress: '', count: 0, errors: [],
};

// Status endpoint
router.get('/status', (req, res) => {
  if (!checkAuth(req, res)) return;
  res.json(currentJob);
});

// Trigger data load
router.post('/load', async (req, res) => {
  if (!checkAuth(req, res)) return;

  const year = Number(req.query.year) || new Date().getFullYear();
  const term = req.query.term as string;

  if (currentJob.running) {
    return res.json({ message: 'Ya hay una descarga en curso', status: currentJob });
  }

  currentJob = { running: true, year, progress: 'Iniciando...', count: 0, errors: [] };
  res.json({ message: `Descarga iniciada para ${year}`, status: currentJob });

  // Run in background
  (async () => {
    try {
      const terms = term ? [term] : SEARCH_TERMS;
      const existingOcids = new Set<string>();

      for (const searchTerm of terms) {
        currentJob.progress = `Buscando "${searchTerm}" en ${year}...`;
        let page = 1;
        let totalPages = 1;

        while (page <= totalPages && page <= 20) {
          try {
            const url = `${SEARCH_API}?year=${year}&search=${encodeURIComponent(searchTerm)}&page=${page}`;
            const searchRes = await fetch(url);
            if (!searchRes.ok) throw new Error(`HTTP ${searchRes.status}`);
            const searchData = await searchRes.json();

            totalPages = searchData.pages || 1;
            const results = searchData.data || [];
            if (results.length === 0) break;

            for (const result of results) {
              const ocid = result.ocid;
              if (!ocid || existingOcids.has(ocid)) continue;
              existingOcids.add(ocid);

              await sleep(DELAY_MS);

              try {
                const recordRes = await fetch(`${RECORD_API}?ocid=${encodeURIComponent(ocid)}`);
                if (recordRes.ok) {
                  const record = await recordRes.json();
                  const releases = record?.records?.[0]?.releases || [];
                  const release = releases[releases.length - 1];

                  if (release) {
                    const proc = parseReleaseForAdmin(release, result, year);
                    const { flags, score, riskLevel } = evaluateAllFlags(proc);
                    upsertProcedure({ ...proc, flags, score, risk_level: riskLevel });
                    currentJob.count++;
                  }
                }
              } catch (e: any) {
                // Fallback: save basic data from search result
                const proc = basicProcFromSearch(result, year);
                const { flags, score, riskLevel } = evaluateAllFlags(proc);
                upsertProcedure({ ...proc, flags, score, risk_level: riskLevel });
                currentJob.count++;
              }
            }

            page++;
            await sleep(DELAY_MS);
          } catch (e: any) {
            currentJob.errors.push(`${searchTerm} p${page}: ${e.message}`);
            break;
          }
        }
      }

      rebuildConcentrationIndex(year);
      currentJob.progress = `✅ Completado: ${currentJob.count} procedimientos descargados`;
    } catch (e: any) {
      currentJob.progress = `❌ Error: ${e.message}`;
      currentJob.errors.push(e.message);
    }
    currentJob.running = false;
  })();
});

// Admin page (simple HTML)
router.get('/', (req, res) => {
  if (!checkAuth(req, res)) return;
  const key = req.query.key;
  res.send(`<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OICP Admin — Cargar Datos</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 700px; margin: 40px auto; padding: 0 20px; background: #f9fafb; }
  h1 { color: #1e40af; } .card { background: white; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; margin: 16px 0; }
  button { background: #2563eb; color: white; border: none; padding: 12px 24px; border-radius: 8px; font-size: 16px; cursor: pointer; margin: 4px; }
  button:hover { background: #1d4ed8; } button:disabled { background: #9ca3af; cursor: wait; }
  .status { padding: 12px; border-radius: 8px; margin: 12px 0; font-family: monospace; font-size: 14px; }
  .running { background: #fef3c7; border: 1px solid #f59e0b; } .done { background: #d1fae5; border: 1px solid #10b981; }
  .info { background: #eff6ff; border: 1px solid #3b82f6; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px; }
</style></head><body>
<h1>🔍 OICP Admin — Cargar Datos</h1>
<div class="info">
  <strong>¿Cómo funciona?</strong><br>
  Click en un botón → el sistema descarga datos de SERCOP para ese año → espera a que termine → ¡listo!<br>
  Tarda entre 20-60 minutos por año. Puedes cerrar esta página y volver después a verificar el estado.
</div>
<div class="card">
  <h2>Cargar datos por año</h2>
  <button onclick="load(2024)">📥 Cargar 2024</button>
  <button onclick="load(2025)">📥 Cargar 2025</button>
  <button onclick="load(2026)">📥 Cargar 2026</button>
  <button onclick="load(2023)">📥 Cargar 2023</button>
  <button onclick="load(2022)">📥 Cargar 2022</button>
</div>
<div class="card">
  <h2>Prueba rápida (1-2 minutos)</h2>
  <button onclick="loadTerm(2024, 'construcción')">🔎 Buscar "construcción" 2024</button>
  <button onclick="loadTerm(2025, 'servicio')">🔎 Buscar "servicio" 2025</button>
</div>
<div class="card">
  <h2>Estado actual</h2>
  <div id="status" class="status">Cargando estado...</div>
  <button onclick="checkStatus()">🔄 Actualizar estado</button>
</div>
<script>
const KEY = '${key}';
async function load(year) {
  if (!confirm('¿Iniciar descarga para ' + year + '? Puede tardar 20-60 minutos.')) return;
  const r = await fetch('/api/admin/load?key=' + KEY + '&year=' + year, { method: 'POST' });
  const d = await r.json(); alert(d.message); checkStatus();
}
async function loadTerm(year, term) {
  const r = await fetch('/api/admin/load?key=' + KEY + '&year=' + year + '&term=' + encodeURIComponent(term), { method: 'POST' });
  const d = await r.json(); alert(d.message); checkStatus();
}
async function checkStatus() {
  const r = await fetch('/api/admin/status?key=' + KEY);
  const d = await r.json();
  const el = document.getElementById('status');
  if (d.running) {
    el.className = 'status running';
    el.innerHTML = '⏳ <strong>En progreso</strong> — Año: ' + d.year + '<br>' + d.progress + '<br>Procedimientos: ' + d.count;
  } else if (d.count > 0) {
    el.className = 'status done';
    el.innerHTML = '✅ ' + d.progress + '<br>Procedimientos: ' + d.count;
  } else {
    el.className = 'status';
    el.innerHTML = 'No hay descargas activas. Click un botón para iniciar.';
  }
  if (d.errors?.length) el.innerHTML += '<br><small style="color:#dc2626">Errores: ' + d.errors.slice(-3).join('; ') + '</small>';
}
setInterval(checkStatus, 5000);
checkStatus();
</script></body></html>`);
});

// ── Parse helpers ───────────────────────────────────────────
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
      if ((id || name) && !suppliers.find(s => s.id === id && s.name === name)) {
        suppliers.push({ id, name });
      }
    }
  }
  if (suppliers.length === 0 && searchResult?.single_provider) {
    suppliers.push({ id: '', name: searchResult.single_provider });
  }

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
    id: release.ocid || searchResult?.ocid,
    ocid: release.ocid || searchResult?.ocid,
    title: tender.title || searchResult?.title || '',
    description: tender.description || searchResult?.description || '',
    status: release.tag?.includes('contract') ? 'contract' : release.tag?.includes('award') ? 'award' : 'tender',
    procurement_method: method,
    procurement_method_details: methodDetails,
    buyer_id: buyer.id || searchResult?.buyerId || null,
    buyer_name: buyer.name || searchResult?.buyerName || null,
    budget_amount: tender.value?.amount || null,
    budget_currency: 'USD',
    award_amount: firstAward.value?.amount || null,
    contract_amount: firstContract.value?.amount || null,
    final_amount: firstContract.implementation?.finalValue?.amount || null,
    published_date: tender.tenderPeriod?.startDate || release.date || null,
    submission_deadline: tender.tenderPeriod?.endDate || null,
    award_date: firstAward.date || null,
    contract_date: firstContract.dateSigned || null,
    suppliers,
    number_of_tenderers: tender.numberOfTenderers || (release.bids?.details?.length) || null,
    items_classification: tender.items?.[0]?.classification?.id || null,
    has_amendments: amendmentCount > 0,
    amendment_count: amendmentCount,
    source_year: year,
    regime: getRegime(dateForRegime),
  };
}

function basicProcFromSearch(result: any, year: number): any {
  return {
    id: result.ocid, ocid: result.ocid,
    title: result.title || '', description: result.description || '',
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
