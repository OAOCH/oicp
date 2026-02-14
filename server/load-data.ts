/**
 * OICP Data Loader — Descarga datos reales de SERCOP OCDS API
 * 
 * USO:
 *   npx tsx server/load-data.ts --year 2024 --search "adquisición"
 *   npx tsx server/load-data.ts --year 2024 --all
 *   npx tsx server/load-data.ts --bulk --years 2022,2023,2024,2025
 */

import { migrate, upsertProcedure, rebuildConcentrationIndex } from './db.js';
import { evaluateAllFlags, getRegime, getInfimaThreshold, FLAG_CATALOG } from './flag-engine.js';

migrate();

// ── Config ──────────────────────────────────────────────────
const SEARCH_API = 'https://datosabiertos.compraspublicas.gob.ec/PLATAFORMA/api/search_ocds';
const RECORD_API = 'https://datosabiertos.compraspublicas.gob.ec/PLATAFORMA/api/record';

// Palabras de búsqueda comunes para capturar la mayor cantidad de procesos posibles
// La API de SERCOP requiere un término de búsqueda obligatorio (mínimo 3 caracteres)
const SEARCH_TERMS = [
  'adquisición', 'servicio', 'construcción', 'consultoría',
  'suministro', 'mantenimiento', 'provisión', 'contratación',
  'compra', 'obra', 'transporte', 'limpieza',
  'alimentación', 'medicamentos', 'equipos', 'mobiliario',
  'capacitación', 'seguridad', 'sistema', 'proyecto',
  'mejoramiento', 'rehabilitación', 'ampliación', 'reparación',
  'estudio', 'diseño', 'fiscalización', 'auditoría',
  'alquiler', 'arrendamiento', 'seguros', 'combustible',
  'uniformes', 'material', 'insumos', 'herramientas',
  'vehículos', 'tecnología', 'software', 'internet',
];

// Delay entre requests para no sobrecargar el servidor
const DELAY_MS = 500;

// ── Helpers ─────────────────────────────────────────────────
function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }

function log(msg: string) {
  const time = new Date().toLocaleTimeString('es-EC');
  console.log(`[${time}] ${msg}`);
}

function logError(msg: string) {
  const time = new Date().toLocaleTimeString('es-EC');
  console.error(`[${time}] ❌ ${msg}`);
}

async function fetchJson(url: string, retries = 3): Promise<any> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } catch (err: any) {
      if (attempt === retries) {
        logError(`Fallo después de ${retries} intentos: ${url}`);
        logError(`  Error: ${err.message}`);
        return null;
      }
      log(`  Reintento ${attempt}/${retries}...`);
      await sleep(2000 * attempt); // Espera más cada reintento
    }
  }
  return null;
}

// ── Parse OCDS Release into our DB format ───────────────────
function parseRelease(release: any, searchResult: any): any {
  const tender = release.tender || {};
  const awards = release.awards || [];
  const contracts = release.contracts || [];
  const buyer = release.buyer || tender.procuringEntity || {};
  const planning = release.planning || {};

  const firstAward = awards[0] || {};
  const firstContract = contracts[0] || {};

  // Extract all suppliers from all awards
  const suppliers: { id: string; name: string }[] = [];
  for (const award of awards) {
    for (const sup of (award.suppliers || [])) {
      const id = sup.id || sup.identifier?.id || '';
      const name = sup.name || '';
      if (id || name) {
        // Evitar duplicados
        if (!suppliers.find(s => s.id === id && s.name === name)) {
          suppliers.push({ id, name });
        }
      }
    }
  }

  // If no suppliers from awards, try from search result
  if (suppliers.length === 0 && searchResult?.single_provider) {
    suppliers.push({ id: '', name: searchResult.single_provider });
  }

  // Number of tenderers
  let nTenderers = tender.numberOfTenderers;
  if (!nTenderers && release.bids?.details) {
    nTenderers = release.bids.details.length;
  }

  // Amounts
  const budgetAmount = tender.value?.amount || planning.budget?.amount?.amount || null;
  const awardAmount = firstAward.value?.amount || null;
  const contractAmount = firstContract.value?.amount || null;
  const finalAmount = firstContract.implementation?.finalValue?.amount || null;

  // Dates
  const publishedDate = tender.tenderPeriod?.startDate || release.date || null;
  const submissionDeadline = tender.tenderPeriod?.endDate || null;
  const awardDate = firstAward.date || null;
  const contractDate = firstContract.dateSigned || null;

  // Amendments
  let amendmentCount = 0;
  for (const contract of contracts) {
    amendmentCount += (contract.amendments || []).length;
  }

  // Items classification (CPC code)
  const items = tender.items || [];
  const classification = items[0]?.classification?.id || null;

  // Procurement method details
  const methodDetails = tender.procurementMethodDetails || 
                         searchResult?.internal_type || 
                         tender.procurementMethod || '';

  // Map SERCOP method names to OCDS method
  let method = tender.procurementMethod || '';
  if (!method) {
    const details = methodDetails.toLowerCase();
    if (details.includes('ínfima') || details.includes('infima')) method = 'limited';
    else if (details.includes('régimen especial') || details.includes('emergente')) method = 'selective';
    else if (details.includes('catálogo') || details.includes('catalogo')) method = 'direct';
    else method = 'open';
  }

  const dateForRegime = publishedDate || `${searchResult?.year || 2024}-06-15`;
  const year = new Date(dateForRegime).getFullYear() || searchResult?.year || 2024;

  return {
    id: release.ocid || searchResult?.ocid,
    ocid: release.ocid || searchResult?.ocid,
    title: tender.title || tender.description || searchResult?.title || '',
    description: tender.description || searchResult?.description || '',
    status: release.tag?.includes('contract') ? 'contract' : 
            release.tag?.includes('award') ? 'award' :
            release.tag?.includes('tender') ? 'tender' : 'planning',
    procurement_method: method,
    procurement_method_details: methodDetails,
    buyer_id: buyer.id || searchResult?.buyerId || null,
    buyer_name: buyer.name || searchResult?.buyerName || null,
    budget_amount: budgetAmount,
    budget_currency: 'USD',
    award_amount: awardAmount,
    contract_amount: contractAmount,
    final_amount: finalAmount,
    published_date: publishedDate,
    submission_deadline: submissionDeadline,
    award_date: awardDate,
    contract_date: contractDate,
    suppliers,
    number_of_tenderers: nTenderers,
    items_classification: classification,
    has_amendments: amendmentCount > 0,
    amendment_count: amendmentCount,
    source_year: year,
    regime: getRegime(dateForRegime),
    raw_release: release,
  };
}

// ── Search and download ─────────────────────────────────────
async function searchProcedures(year: number, term: string, page: number = 1): Promise<any> {
  const url = `${SEARCH_API}?year=${year}&search=${encodeURIComponent(term)}&page=${page}`;
  return fetchJson(url);
}

async function getFullRecord(ocid: string): Promise<any> {
  const url = `${RECORD_API}?ocid=${encodeURIComponent(ocid)}`;
  return fetchJson(url);
}

// ── Main download function for one year + one search term ───
async function downloadByTerm(year: number, term: string, existingOcids: Set<string>): Promise<number> {
  let page = 1;
  let totalNew = 0;
  let totalPages = 1;

  log(`  Buscando "${term}" en ${year}...`);

  while (page <= totalPages) {
    const searchResult = await searchProcedures(year, term, page);
    if (!searchResult || !searchResult.data) {
      break;
    }

    totalPages = searchResult.pages || 1;
    const results = searchResult.data || [];

    if (results.length === 0) break;

    for (const result of results) {
      const ocid = result.ocid;
      if (!ocid || existingOcids.has(ocid)) continue;

      existingOcids.add(ocid);

      // Fetch full OCDS record
      await sleep(DELAY_MS);
      const record = await getFullRecord(ocid);

      if (!record || !record.records || !record.records[0]) {
        // If full record fails, create basic entry from search result
        const proc = {
          id: ocid,
          ocid,
          title: result.title || '',
          description: result.description || '',
          status: 'unknown',
          procurement_method: '',
          procurement_method_details: result.internal_type || '',
          buyer_id: result.buyerId || null,
          buyer_name: result.buyerName || null,
          budget_amount: null,
          budget_currency: 'USD',
          award_amount: null,
          contract_amount: null,
          final_amount: null,
          published_date: result.date || null,
          submission_deadline: null,
          award_date: null,
          contract_date: null,
          suppliers: result.single_provider ? [{ id: '', name: result.single_provider }] : [],
          number_of_tenderers: null,
          items_classification: null,
          has_amendments: false,
          amendment_count: 0,
          source_year: year,
          regime: getRegime(result.date),
        };
        const { flags, score, riskLevel } = evaluateAllFlags(proc);
        upsertProcedure({ ...proc, flags, score, risk_level: riskLevel });
        totalNew++;
        continue;
      }

      // Parse full record
      const releases = record.records[0].releases || [];
      const release = releases[releases.length - 1] || releases[0]; // Use latest release

      if (!release) continue;

      try {
        const proc = parseRelease(release, result);
        const { flags, score, riskLevel } = evaluateAllFlags(proc);
        upsertProcedure({ ...proc, flags, score, risk_level: riskLevel });
        totalNew++;
      } catch (err: any) {
        logError(`Error procesando ${ocid}: ${err.message}`);
      }
    }

    log(`    Página ${page}/${totalPages} — ${results.length} resultados (${totalNew} nuevos acumulados)`);
    page++;
    await sleep(DELAY_MS);
  }

  return totalNew;
}

// ── Main entry point ────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let years: number[] = [];
  let searchTerms: string[] = [];
  let mode = 'single'; // single | all | bulk

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--year' && args[i + 1]) {
      years = [parseInt(args[i + 1])];
      i++;
    } else if (args[i] === '--years' && args[i + 1]) {
      years = args[i + 1].split(',').map(Number);
      i++;
    } else if (args[i] === '--search' && args[i + 1]) {
      searchTerms = [args[i + 1]];
      i++;
    } else if (args[i] === '--all') {
      mode = 'all';
    } else if (args[i] === '--bulk') {
      mode = 'bulk';
    }
  }

  // Defaults
  if (years.length === 0) years = [2024];
  if (mode === 'all' || mode === 'bulk') {
    searchTerms = SEARCH_TERMS;
  }
  if (searchTerms.length === 0) {
    console.log(`
╔════════════════════════════════════════════════════════════════╗
║  OICP Data Loader — Descarga datos de SERCOP                 ║
╠════════════════════════════════════════════════════════════════╣
║                                                                ║
║  MODO SIMPLE (una búsqueda):                                   ║
║    npx tsx server/load-data.ts --year 2024 --search "agua"     ║
║                                                                ║
║  MODO COMPLETO (muchas búsquedas, un año):                     ║
║    npx tsx server/load-data.ts --year 2024 --all               ║
║                                                                ║
║  MODO MASIVO (muchas búsquedas, varios años):                  ║
║    npx tsx server/load-data.ts --bulk --years 2022,2023,2024   ║
║                                                                ║
║  NOTA: El modo --all tarda entre 30-60 minutos por año.        ║
║        El modo --bulk puede tardar varias horas.               ║
║        Puedes cancelar con Ctrl+C y retomar después.           ║
║        No se duplican datos al correr varias veces.            ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
    `);
    return;
  }

  console.log(`
╔════════════════════════════════════════════════════════════════╗
║  OICP Data Loader — Iniciando descarga                        ║
║  Años: ${years.join(', ').padEnd(52)}║
║  Términos de búsqueda: ${String(searchTerms.length).padEnd(36)}║
║  Modo: ${mode.padEnd(53)}║
╚════════════════════════════════════════════════════════════════╝
  `);

  const existingOcids = new Set<string>();
  let grandTotal = 0;

  for (const year of years) {
    log(`\n═══ Procesando año ${year} ═══`);
    let yearTotal = 0;

    for (const term of searchTerms) {
      try {
        const newCount = await downloadByTerm(year, term, existingOcids);
        yearTotal += newCount;
      } catch (err: any) {
        logError(`Error en búsqueda "${term}" ${year}: ${err.message}`);
      }
    }

    log(`═══ Año ${year} completado: ${yearTotal} procedimientos nuevos ═══`);
    grandTotal += yearTotal;

    // Rebuild concentration index per year
    log('Reconstruyendo índice de concentración...');
    rebuildConcentrationIndex(year);
  }

  console.log(`
╔════════════════════════════════════════════════════════════════╗
║  ✅ DESCARGA COMPLETADA                                       ║
║  Total procedimientos nuevos: ${String(grandTotal).padEnd(29)}║
║  OCIDs únicos procesados: ${String(existingOcids.size).padEnd(33)}║
║                                                                ║
║  Ahora puedes abrir la app:                                    ║
║    npm run dev                                                 ║
║    → http://localhost:5173                                     ║
╚════════════════════════════════════════════════════════════════╝
  `);
}

main().catch(err => {
  logError(`Error fatal: ${err.message}`);
  process.exit(1);
});
