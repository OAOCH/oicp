/**
 * Sincronización local OICP → producción.
 *
 * SERCOP bloquea IPs de datacenter, así que el barrido corre en ESTA máquina
 * (IP ecuatoriana) y empuja los procesos nuevos a producción, donde el servidor
 * evalúa banderas, parcha agregados y re-evalúa con contexto de concentración.
 *
 * Uso (programado mar/jue 08:00 por el Programador de tareas de Windows):
 *   npx tsx server/local-sync.ts [--year 2026] [--budget-min 300] [--term agua]
 *
 * Config: archivo .sync-token (token de /api/admin/mint-sync-token) junto a
 * package.json, o variable de entorno OICP_SYNC_TOKEN.
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PROD = process.env.OICP_URL || 'https://oicp-production.up.railway.app';
const TOKEN = process.env.OICP_SYNC_TOKEN ||
  (existsSync(resolve(ROOT, '.sync-token')) ? readFileSync(resolve(ROOT, '.sync-token'), 'utf-8').trim() : '');
const CURSOR_FILE = resolve(ROOT, '.sync-cursor.json');

const SEARCH_API = 'https://datosabiertos.compraspublicas.gob.ec/PLATAFORMA/api/search_ocds';
const RECORD_API = 'https://datosabiertos.compraspublicas.gob.ec/PLATAFORMA/api/record';
const MAX_PAGES = 5000;
// Tope de páginas por término POR CORRIDA: los términos genéricos ("del", "para")
// superan las 1.000 páginas y una sola corrida se ahogaba en ellos sin llegar a
// finalizar. Los específicos cubren casi todo; el barrido genérico avanza por tandas.
const MAX_PAGES_PER_RUN = 300;
const PENDING_FILE = resolve(ROOT, '.sync-pending-finalize');

// Mantener en sincronía con server/updater.ts (TERMS y el parser del release).
const TERMS = [
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
  'municipal', 'provincial', 'ministerio', 'hospital',
  'universidad', 'escuela', 'instituto', 'empresa',
  'infraestructura', 'instalación', 'implementación',
  'evaluación', 'supervisión', 'control', 'gestión',
  // Genéricos AL FINAL: son la red de seguridad (miles de páginas cada uno);
  // primero deben completarse los términos específicos en cada corrida.
  'para', 'del', 'los', 'con', 'por', 'las',
];

function log(msg: string) { console.log(`[sync ${new Date().toISOString()}] ${msg}`); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

let lastReq = 0;
async function sercopFetch(url: string, retries = 6): Promise<any | null> {
  for (let a = 1; a <= retries; a++) {
    const gap = 350 - (Date.now() - lastReq);
    if (gap > 0) await sleep(gap);
    lastReq = Date.now();
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'OICP-sync' }, signal: AbortSignal.timeout(45000) });
      if (res.status === 429) {
        const ra = Number(res.headers.get('retry-after')) || Math.min(60, 4 * 2 ** (a - 1));
        await sleep(ra * 1000 + Math.random() * 1500);
        continue;
      }
      if (!res.ok) { if (a === retries) return null; await sleep(2000 * a); continue; }
      const text = await res.text();
      if (text.startsWith('<')) { if (a === retries) return null; await sleep(30000); continue; }
      return JSON.parse(text);
    } catch {
      if (a === retries) return null;
      await sleep(2000 * a);
    }
  }
  return null;
}

async function prod(path: string, body: any, retries = 4): Promise<any> {
  for (let a = 1; a <= retries; a++) {
    try {
      const res = await fetch(`${PROD}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-sync-token': TOKEN },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(600000),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 409) { log(`prod ocupado (${path}); espero 60s…`); await sleep(60000); continue; }
      if (!res.ok) throw new Error(`${path} HTTP ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
      return j;
    } catch (e: any) {
      if (a === retries) throw e;
      log(`  reintento ${a} ${path}: ${e.message}`);
      await sleep(10000 * a);
    }
  }
}

function releaseFrom(recData: any): any | null {
  const rels = recData?.releases?.length ? recData.releases
    : recData?.records?.[0]?.releases?.length ? recData.records[0].releases : null;
  return rels ? rels[rels.length - 1] : null;
}

function getRegimeLocal(dateStr: string | null): string {
  // LOSNCP reformada rige desde 2025-10-07 (RO 4S 140); antes coeficientes.
  if (!dateStr) return 'LOSNCP_COEFICIENTES';
  return dateStr >= '2025-10-07' ? 'LOIP' : 'LOSNCP_COEFICIENTES';
}

function releaseToProc(release: any, sr: any, year: number) {
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
  if (!m) { const d = md.toLowerCase(); m = d.includes('ínfima') || d.includes('infima') ? 'limited' : d.includes('especial') ? 'selective' : d.includes('catálogo') || d.includes('catalogo') ? 'direct' : 'open'; }
  const bn = buyer.name || sr?.buyer || null;
  const bi = buyer.id || (bn ? 'EC-' + bn.substring(0, 30).replace(/[^A-Za-z0-9]/g, '-') : null);
  let ac = 0; for (const c of co) ac += (c.amendments || []).length;
  const pub = t.tenderPeriod?.startDate || release.date || sr?.date || null;
  return {
    id: release.ocid || sr?.ocid, ocid: release.ocid || sr?.ocid,
    title: t.title || t.description || sr?.title || '', description: t.description || sr?.description || '',
    status: release.tag?.includes('contract') ? 'contract' : release.tag?.includes('award') ? 'award' : 'tender',
    procurement_method: m, procurement_method_details: md, buyer_id: bi, buyer_name: bn,
    budget_amount: t.value?.amount || release.planning?.budget?.amount?.amount || (sr?.budget ? parseFloat(sr.budget) : null),
    budget_currency: 'USD', award_amount: fa.value?.amount || (sr?.amount ? parseFloat(sr.amount) : null),
    contract_amount: fc.value?.amount || null, final_amount: fc.implementation?.finalValue?.amount || null,
    published_date: pub, submission_deadline: t.tenderPeriod?.endDate || null,
    award_date: fa.date || null, contract_date: fc.dateSigned || null,
    suppliers, number_of_tenderers: t.numberOfTenderers || release.bids?.details?.length || null,
    items_classification: t.items?.[0]?.classification?.id || null,
    has_amendments: ac > 0, amendment_count: ac, source_year: year,
    regime: getRegimeLocal(pub || `${year}-06-15`),
  };
}

function readCursor(year: number): { termIdx: number; page: number } {
  try {
    const c = JSON.parse(readFileSync(CURSOR_FILE, 'utf-8'));
    if (c.year === year && c.termIdx < TERMS.length) return { termIdx: c.termIdx, page: c.page || 1 };
  } catch { /* sin cursor */ }
  return { termIdx: 0, page: 1 };
}
function saveCursor(year: number, termIdx: number, page: number) {
  writeFileSync(CURSOR_FILE, JSON.stringify({ year, termIdx, page, savedAt: new Date().toISOString() }));
}
function clearCursor() { try { writeFileSync(CURSOR_FILE, 'null'); } catch { /* sin permisos: ignorar */ } }

async function main() {
  const args = process.argv.slice(2);
  const argOf = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const year = Number(argOf('--year')) || new Date().getFullYear();
  const budgetMin = Number(argOf('--budget-min')) || 240;
  const oneTerm = argOf('--term');
  const terms = oneTerm ? [oneTerm] : TERMS;

  if (!TOKEN) { console.error('Falta el token: crea el archivo .sync-token o exporta OICP_SYNC_TOKEN'); process.exit(1); }

  // Recuperación: si una corrida anterior murió (apagado/batería) después de
  // ingerir pero antes de finalizar, la finalización quedó pendiente en el
  // servidor (corte de datos y banderas de concentración desactualizados).
  if (existsSync(PENDING_FILE)) {
    const pendYear = Number(readFileSync(PENDING_FILE, 'utf-8').trim()) || year;
    log(`finalización pendiente de una corrida interrumpida (año ${pendYear}); ejecutando primero…`);
    try {
      const fin = await prod('/api/admin/ingest-finalize', { year: pendYear });
      log(`finalización recuperada: ${JSON.stringify(fin)}`);
      try { unlinkSync(PENDING_FILE); } catch { /* mejor esfuerzo */ }
    } catch (e: any) {
      log(`no se pudo recuperar la finalización (seguirá pendiente): ${e.message}`);
    }
  }
  // Marca que esta corrida deberá finalizar (se borra al finalizar con éxito).
  writeFileSync(PENDING_FILE, String(year));

  const t0 = Date.now();
  const budgetMs = budgetMin * 60_000;
  let inserted = 0, skipped = 0, searched = 0, errors = 0;
  let buffer: any[] = [];
  let outOfBudget = false;

  const flush = async () => {
    if (!buffer.length) return;
    const r = await prod('/api/admin/ingest', { procs: buffer });
    inserted += r.inserted || 0;
    skipped += r.skipped || 0;
    buffer = [];
  };

  const start = oneTerm ? { termIdx: 0, page: 1 } : readCursor(year);
  log(`inicio: año ${year}, presupuesto ${budgetMin} min, reanudando en término ${start.termIdx + 1}/${terms.length} pág ${start.page}`);

  for (let t = start.termIdx; t < terms.length; t++) {
    if (outOfBudget) break;
    const term = terms[t];
    let page = (t === start.termIdx ? start.page : 1), totalPages = 1;
    const pageCap = page + MAX_PAGES_PER_RUN - 1;
    while (page <= totalPages && page <= MAX_PAGES && page <= pageCap && !outOfBudget) {
      if (Date.now() - t0 > budgetMs) { outOfBudget = true; if (!oneTerm) saveCursor(year, t, page); break; }
      const sd = await sercopFetch(`${SEARCH_API}?year=${year}&search=${encodeURIComponent(term)}&page=${page}`);
      searched++;
      if (!sd) { log(`  búsqueda "${term}" pág ${page}: sin respuesta`); errors++; break; }
      if (!sd.data?.length) break;
      totalPages = sd.pages || 1;
      const ocids = sd.data.map((r: any) => r.ocid).filter(Boolean);
      const srByOcid = new Map(sd.data.map((r: any) => [r.ocid, r]));
      const { missing } = await prod('/api/admin/missing-ocids', { ocids });
      for (const ocid of missing) {
        if (Date.now() - t0 > budgetMs) { outOfBudget = true; if (!oneTerm) saveCursor(year, t, page); break; }
        const recData = await sercopFetch(`${RECORD_API}?ocid=${encodeURIComponent(ocid)}`);
        const release = recData ? releaseFrom(recData) : null;
        if (!release) { errors++; continue; }
        try {
          buffer.push(releaseToProc(release, srByOcid.get(ocid), year));
          if (buffer.length >= 100) await flush();
        } catch (e: any) { errors++; log(`  parse ${ocid}: ${e.message}`); }
      }
      if (page % 25 === 0 || missing.length) {
        log(`  [${t + 1}/${terms.length}] "${term}" pág ${page}/${Math.min(totalPages, MAX_PAGES)} — nuevos ${inserted} · vistos ${skipped}`);
      }
      page++;
    }
    if (page > pageCap && page <= totalPages) {
      log(`  término "${term}": tope de ${MAX_PAGES_PER_RUN} págs/corrida alcanzado (${page - 1}/${totalPages}); continúa en tandas`);
    }
  }
  await flush();
  if (!outOfBudget && !oneTerm) clearCursor();

  log(`barrido ${outOfBudget ? 'PARCIAL (presupuesto agotado, cursor guardado)' : 'COMPLETO'}: nuevos ${inserted}, vistos ${skipped}, búsquedas ${searched}, errores ${errors}`);
  if (inserted > 0 || outOfBudget === false) {
    log('finalizando en producción (concentración + banderas + agregados)…');
    const fin = await prod('/api/admin/ingest-finalize', { year });
    log(`finalizado: ${JSON.stringify(fin)}`);
    try { unlinkSync(PENDING_FILE); } catch { /* mejor esfuerzo */ }
  }
  log('OK');
  process.exit(0);
}

main().catch(e => { console.error(`[sync] ERROR: ${e.stack || e.message}`); process.exit(1); });
