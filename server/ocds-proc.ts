/**
 * Conversión de un release OCDS del SERCOP a la fila de `procedures`.
 *
 * UNA SOLA DEFINICIÓN (regla 11). Antes vivía duplicada literalmente en `updater.ts` y en
 * `local-sync.ts`, y esa duplicación costó exactamente lo que la regla 11 predice:
 *
 *   El 11-ago-2026 se corrigió la lectura del presupuesto (`valorReferencial()`, que cae a
 *   `tender.lots[].value.amount` cuando `tender.value` viene vacío) y se empezó a guardar
 *   `tender.enquiryPeriod.endDate`. La corrección se aplicó a la copia de `updater.ts` y a
 *   `load-data.ts`, pero NO a la copia de `local-sync.ts`.
 *
 *   Y `local-sync.ts` es el ÚNICO camino que llega de verdad al SERCOP: Railway tiene la IP
 *   bloqueada, así que el barrido corre en la PC de Oscar (tarea de Windows, martes y jueves).
 *   O sea que el defecto seguía vivo justo donde entran los datos nuevos: cada corrida seguía
 *   guardando el TEXTO "USD" como presupuesto y `enquiry_deadline` en nulo.
 *
 * Por eso este módulo no tiene dependencias de base de datos ni de red: para que los dos
 * caminos puedan importarlo sin arrastrar nada, y para que no haya excusa para volver a
 * copiarlo. `ocds-proc.test.ts` verifica además que ningún otro archivo redefina el mapeo.
 */
import { valorReferencial } from './ocds-valor.js';
import { getRegime } from './flag-engine.js';

/**
 * Nombres basura que la fuente publica como si fueran nombres.
 *
 * En 83 procesos el SERCOP publica la CADENA "null" como nombre del proveedor, y pasaba tal cual
 * hasta la ficha y hasta los agregados: en el perfil de CELEC EP, un proveedor con USD 38,9
 * millones aparecía en el top 10 llamándose «null». Se normalizan a cadena vacía, y quien muestre
 * el dato cae al RUC con `nombreVisible()`. No se inventa un nombre: se dice que no lo publican.
 */
const NOMBRES_BASURA = new Set(['null', 'undefined', 'n/a', 'na', 'sin nombre', '-', '--', '.']);

export function limpiarNombre(nombre: any): string {
  const s = String(nombre ?? '').trim();
  return NOMBRES_BASURA.has(s.toLowerCase()) ? '' : s;
}

/** Qué mostrar cuando la fuente no publica el nombre. UNA sola definición para web y MCP. */
export function nombreVisible(nombre: any, id: any): string {
  const n = limpiarNombre(nombre);
  if (n) return n;
  const ruc = String(id ?? '').match(/\d{10,13}/)?.[0];
  return ruc ? `Proveedor sin nombre publicado (RUC ${ruc})` : 'Proveedor sin nombre publicado';
}

/**
 * Extrae el release vigente de un record OCDS.
 * La API devuelve `releases` al nivel superior; se acepta también el formato antiguo
 * `records[0].releases`. Se toma el ÚLTIMO, que es el estado más reciente del proceso.
 */
export function releaseFrom(recData: any): any | null {
  const rels = recData?.releases?.length ? recData.releases
    : recData?.records?.[0]?.releases?.length ? recData.records[0].releases : null;
  return rels ? rels[rels.length - 1] : null;
}

export function releaseToProc(release: any, sr: any, year: number) {
  const t = release.tender || {}, aw = release.awards || [], co = release.contracts || [];
  const buyer = release.buyer || t.procuringEntity || {};
  const fa = aw[0] || {}, fc = co[0] || {};
  const suppliers: any[] = [];
  for (const a of aw) for (const s of (a.suppliers || [])) {
    const id = s.id || s.identifier?.id || '', name = limpiarNombre(s.name);
    if ((id || name) && !suppliers.find(x => x.id === id && x.name === name)) suppliers.push({ id, name });
  }
  if (!suppliers.length && sr?.suppliers && typeof sr.suppliers === 'string') {
    const n = limpiarNombre(sr.suppliers);
    if (n) suppliers.push({ id: '', name: n });
  }
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
    // NUNCA leer `tender.value` a pelo: en la mayoría de los procesos del SERCOP viene vacío y
    // el monto está en los lotes. Ver ocds-valor.ts.
    budget_amount: valorReferencial(t, release, sr),
    budget_currency: 'USD', award_amount: fa.value?.amount || (sr?.amount ? parseFloat(sr.amount) : null),
    contract_amount: fc.value?.amount || null, final_amount: fc.implementation?.finalValue?.amount || null,
    published_date: pub, submission_deadline: t.tenderPeriod?.endDate || null,
    // Fecha desde la que corre el término del Art. 96 del Reglamento a la LOSNCP.
    enquiry_deadline: t.enquiryPeriod?.endDate || null,
    award_date: fa.date || null, contract_date: fc.dateSigned || null,
    suppliers, number_of_tenderers: t.numberOfTenderers || release.bids?.details?.length || null,
    items_classification: t.items?.[0]?.classification?.id || null,
    has_amendments: ac > 0, amendment_count: ac, source_year: year,
    regime: getRegime(pub || `${year}-06-15`),
  };
}
