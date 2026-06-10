/**
 * OICP Flag Engine — Motor de Banderas de Riesgo
 * Implementa 15 indicadores calibrados para Ecuador
 * Basado en OCP Red Flags Guide 2024 + LOSNCP reformada (7 oct 2025)
 */

// ── Ecuador Thresholds by Year ──────────────────────────────
interface YearThresholds {
  pie: number;
  regime: 'LOSNCP_COEFICIENTES' | 'LOSNCP_REFORMADA';
  infima_cuantia: number;
  bs_menor_cuantia_max?: number;
}

const UMBRALES: Record<number | string, YearThresholds> = {
  2019: { pie: 35_529_394_461.72, regime: 'LOSNCP_COEFICIENTES', infima_cuantia: 7_105.88, bs_menor_cuantia_max: 71_058.79 },
  2020: { pie: 35_498_420_637.20, regime: 'LOSNCP_COEFICIENTES', infima_cuantia: 7_099.68, bs_menor_cuantia_max: 70_996.84 },
  2021: { pie: 32_080_363_387.48, regime: 'LOSNCP_COEFICIENTES', infima_cuantia: 6_416.07, bs_menor_cuantia_max: 64_160.73 },
  2022: { pie: 33_899_734_759.85, regime: 'LOSNCP_COEFICIENTES', infima_cuantia: 6_779.95, bs_menor_cuantia_max: 67_799.47 },
  2023: { pie: 31_502_865_593.76, regime: 'LOSNCP_COEFICIENTES', infima_cuantia: 6_300.57, bs_menor_cuantia_max: 63_005.73 },
  2024: { pie: 33_293_903_424.91, regime: 'LOSNCP_COEFICIENTES', infima_cuantia: 6_658.78, bs_menor_cuantia_max: 66_587.81 },
  2025: { pie: 36_063_017_083.08, regime: 'LOSNCP_REFORMADA', infima_cuantia: 10_000.00 },
  2026: { pie: 46_255_572_824.33, regime: 'LOSNCP_REFORMADA', infima_cuantia: 10_000.00 },
};

export function getThreshold(year: number): YearThresholds {
  return UMBRALES[year] || UMBRALES[2026];
}

export function getInfimaThreshold(dateStr: string | null): number {
  if (!dateStr) return 10_000;
  const d = new Date(dateStr);
  // Reforma LOSNCP (RO 4S No. 140, 7-oct-2025): ínfima cuantía fija en USD 10.000.
  if (d >= new Date('2025-10-07')) return 10_000;
  const year = d.getFullYear();
  // 2025 ANTES de la reforma usa el coeficiente (0.0000002 x PGE 2025 = 7.212,60),
  // no el 10.000 post-reforma. Los procedimientos previos al 7-oct-2025 se rigen
  // por la normativa anterior (disposición transitoria).
  if (year === 2025) return 7_212.60;
  return UMBRALES[year]?.infima_cuantia || 10_000;
}

export function getRegime(dateStr: string | null): string {
  if (!dateStr) return 'LOSNCP_REFORMADA';
  return new Date(dateStr) >= new Date('2025-10-07') ? 'LOSNCP_REFORMADA' : 'LOSNCP_COEFICIENTES';
}

// ── Flag Definitions ────────────────────────────────────────
export interface Flag {
  code: string;
  category: string;
  name: string;
  name_es: string;
  description_es: string;
  severity: 0 | 1 | 2 | 3;
  ocp_ref?: string;
  active: boolean;
  detail?: string;
}

export const FLAG_CATALOG: Record<string, Omit<Flag, 'active' | 'detail'>> = {
  'IC-01': {
    code: 'IC-01', category: 'competencia', name: 'Single Bidder',
    name_es: 'Proveedor Único en Proceso Competitivo',
    description_es: 'Solo un oferente participó en un proceso que debería ser competitivo.',
    severity: 2, ocp_ref: 'R018',
  },
  'IC-02': {
    code: 'IC-02', category: 'competencia', name: 'High Value No Competition',
    name_es: 'Alto Valor Sin Competencia',
    description_es: 'Adjudicación directa o ínfima cuantía por monto superior al umbral permitido.',
    severity: 3, ocp_ref: 'R055',
  },
  'IT-01': {
    code: 'IT-01', category: 'tiempo', name: 'Insufficient Publication Period',
    name_es: 'Plazo de Publicación Insuficiente',
    description_es: 'El período entre publicación y cierre de ofertas es menor al mínimo legal.',
    severity: 1, ocp_ref: 'R003',
  },
  'IT-02': {
    code: 'IT-02', category: 'tiempo', name: 'Lightning Award',
    name_es: 'Adjudicación Relámpago',
    description_es: 'La adjudicación ocurrió en menos de 3 días hábiles desde la publicación.',
    severity: 2, ocp_ref: 'R061',
  },
  'IP-01': {
    code: 'IP-01', category: 'precio', name: 'Value Near Threshold',
    name_es: 'Valor Cercano al Umbral de Ínfima Cuantía',
    description_es: 'El monto está entre 85% y 100% del umbral de ínfima cuantía, posible fraccionamiento.',
    severity: 2, ocp_ref: 'R011',
  },
  'IP-02': {
    code: 'IP-02', category: 'precio', name: 'Significant Price Difference',
    name_es: 'Diferencia Significativa Presupuesto vs Adjudicación',
    description_es: 'El monto adjudicado difiere más de 15% del presupuesto referencial.',
    severity: 2, ocp_ref: 'R059',
  },
  'IP-03': {
    code: 'IP-03', category: 'precio', name: 'Significant Contract Amendment',
    name_es: 'Modificación Contractual Significativa',
    description_es: 'El contrato recibió enmiendas que incrementan su valor más del 15%.',
    severity: 3, ocp_ref: 'R069',
  },
  'CC-01': {
    code: 'CC-01', category: 'concentracion', name: 'Recurring Supplier Ínfima',
    name_es: 'Proveedor Recurrente en Ínfima Cuantía',
    description_es: 'Mismo proveedor gana 5+ ínfimas cuantías del mismo comprador en un año fiscal.',
    severity: 3,
  },
  'CC-02': {
    code: 'CC-02', category: 'concentracion', name: 'Dominant Supplier',
    name_es: 'Proveedor Dominante',
    description_es: 'Un proveedor recibe más del 30% del gasto total de un comprador en un año.',
    severity: 3, ocp_ref: 'R051',
  },
  'CC-03': {
    code: 'CC-03', category: 'concentracion', name: 'Historically Permanent Supplier',
    name_es: 'Proveedor Histórico Permanente',
    description_es: 'Un proveedor gana contratos del mismo comprador en 5+ de los últimos 7 años.',
    severity: 2,
  },
  'CC-04': {
    code: 'CC-04', category: 'concentracion', name: 'Recurring Consortium Member',
    name_es: 'Miembro Recurrente de Consorcio',
    description_es: 'Una persona/empresa aparece como miembro de 2+ consorcios (procesos con varios proveedores) del mismo comprador.',
    severity: 2, ocp_ref: 'R070',
  },
  'CC-05': {
    code: 'CC-05', category: 'concentracion', name: 'Possible Splitting',
    name_es: 'Posible Fraccionamiento',
    description_es: 'Un mismo comprador adjudica varias ínfimas cuantías al mismo proveedor en el año cuya suma supera el umbral anual (Art. 270 Reglamento LOSNCP).',
    severity: 3, ocp_ref: 'R011',
  },
  'TR-01': {
    code: 'TR-01', category: 'transparencia', name: 'Critical Missing Information',
    name_es: 'Información Incompleta Crítica',
    description_es: 'Faltan campos esenciales: comprador, valor, proveedor o método de contratación.',
    severity: 1, ocp_ref: 'R001',
  },
  'TR-02': {
    code: 'TR-02', category: 'transparencia', name: 'Generic Description',
    name_es: 'Descripción Genérica',
    description_es: 'La descripción del proceso tiene menos de 30 caracteres.',
    severity: 0, ocp_ref: 'R013',
  },
  'TR-03': {
    code: 'TR-03', category: 'transparencia', name: 'No Special Regime Justification',
    name_es: 'Sin Justificación de Régimen Especial',
    description_es: 'Proceso de régimen especial sin justificación documentada.',
    severity: 2, ocp_ref: 'R039',
  },
};

// ── Severity Weights & Scoring ──────────────────────────────
const SEVERITY_WEIGHTS: Record<number, number> = { 0: 3, 1: 8, 2: 18, 3: 30 };

const CORRELATED_FLAGS: [string, string, number][] = [
  ['IC-01', 'IC-02', 0.5],
  ['CC-01', 'CC-05', 0.5],
  ['IP-01', 'CC-05', 0.5],
];

export function calculateScore(flags: Flag[]): number {
  const activeFlags = flags.filter(f => f.active);
  const sorted = [...activeFlags].sort((a, b) => SEVERITY_WEIGHTS[b.severity] - SEVERITY_WEIGHTS[a.severity]);
  const usedCodes = new Set<string>();
  let score = 0;

  for (const flag of sorted) {
    let weight = SEVERITY_WEIGHTS[flag.severity];
    for (const [a, b, factor] of CORRELATED_FLAGS) {
      if (flag.code === b && usedCodes.has(a)) {
        weight = Math.round(weight * factor);
      }
    }
    score += weight;
    usedCodes.add(flag.code);
  }

  return Math.min(100, score);
}

export function getRiskLevel(score: number): string {
  if (score <= 10) return 'low';
  if (score <= 30) return 'moderate';
  if (score <= 60) return 'high';
  return 'critical';
}

// ── Individual Flag Evaluators ──────────────────────────────

interface ProcedureData {
  id: string;
  ocid?: string;
  procurement_method?: string;
  procurement_method_details?: string;
  buyer_id?: string;
  budget_amount?: number | null;
  award_amount?: number | null;
  contract_amount?: number | null;
  final_amount?: number | null;
  published_date?: string;
  submission_deadline?: string;
  award_date?: string;
  number_of_tenderers?: number;
  title?: string;
  description?: string;
  items_classification?: string;
  has_amendments?: boolean;
  amendment_count?: number;
  suppliers?: { id: string; name: string }[];
}

function businessDays(start: string, end: string): number {
  const s = new Date(start);
  const e = new Date(end);
  let count = 0;
  const current = new Date(s);
  while (current <= e) {
    const day = current.getDay();
    if (day !== 0 && day !== 6) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

function isInfima(method?: string): boolean {
  if (!method) return false;
  const m = method.toLowerCase();
  return m.includes('ínfima') || m.includes('infima') || m.includes('ínfima');
}

function isCompetitive(method?: string): boolean {
  if (!method) return false;
  const m = method.toLowerCase();
  return m.includes('licitac') || m.includes('subasta') || m.includes('cotizac') ||
    m.includes('concurso') || m.includes('menor cuantía');
}

export function evaluateIndividualFlags(proc: ProcedureData): Flag[] {
  const flags: Flag[] = [];
  const date = proc.published_date || proc.award_date || null;
  const threshold = getInfimaThreshold(date);
  const value = proc.award_amount || proc.budget_amount || 0;

  // IC-01: Single bidder in competitive process
  if (isCompetitive(proc.procurement_method_details) && proc.number_of_tenderers === 1) {
    flags.push({ ...FLAG_CATALOG['IC-01'], active: true, detail: `Solo 1 oferente en ${proc.procurement_method_details}` });
  }

  // IC-02: High value without competition
  if (isInfima(proc.procurement_method_details) && value > threshold) {
    flags.push({
      ...FLAG_CATALOG['IC-02'], active: true,
      detail: `Valor $${value.toLocaleString()} supera umbral ínfima $${threshold.toLocaleString()}`,
    });
  }
  if (proc.procurement_method === 'direct' && value > threshold) {
    flags.push({
      ...FLAG_CATALOG['IC-02'], active: true,
      detail: `Adjudicación directa $${value.toLocaleString()} > umbral $${threshold.toLocaleString()}`,
    });
  }

  // IT-01: Insufficient publication period
  if (proc.published_date && proc.submission_deadline && value > 10_000) {
    const days = businessDays(proc.published_date, proc.submission_deadline);
    let minDays = 9;
    if (value > 500_000) minDays = 17;
    else if (value > 100_000) minDays = 13;
    if (days < minDays) {
      flags.push({
        ...FLAG_CATALOG['IT-01'], active: true,
        detail: `${days} días hábiles (mínimo: ${minDays} para $${value.toLocaleString()})`,
      });
    }
  }

  // IT-02: Lightning award (< 3 business days)
  if (proc.published_date && proc.award_date) {
    const days = businessDays(proc.published_date, proc.award_date);
    if (days < 3 && !isInfima(proc.procurement_method_details)) {
      flags.push({
        ...FLAG_CATALOG['IT-02'], active: true,
        detail: `Adjudicado en ${days} días hábiles desde publicación`,
      });
    }
  }

  // IP-01: Value near ínfima threshold (85%-100%)
  if (value > 0 && value >= threshold * 0.85 && value <= threshold) {
    const pct = ((value / threshold) * 100).toFixed(1);
    flags.push({
      ...FLAG_CATALOG['IP-01'], active: true,
      detail: `Valor $${value.toLocaleString()} = ${pct}% del umbral $${threshold.toLocaleString()}`,
    });
  }

  // IP-02: Significant difference budget vs award (>15%)
  if (proc.budget_amount && proc.award_amount && proc.budget_amount > 0) {
    const diff = Math.abs(proc.award_amount - proc.budget_amount) / proc.budget_amount;
    if (diff > 0.15) {
      flags.push({
        ...FLAG_CATALOG['IP-02'], active: true,
        detail: `Diferencia ${(diff * 100).toFixed(1)}% entre presupuesto ($${proc.budget_amount.toLocaleString()}) y adjudicación ($${proc.award_amount.toLocaleString()})`,
      });
    }
  }

  // IP-03: Significant contract amendment (>15% increase)
  if (proc.has_amendments && proc.award_amount && proc.contract_amount) {
    const increase = (proc.contract_amount - proc.award_amount) / proc.award_amount;
    if (increase > 0.15) {
      flags.push({
        ...FLAG_CATALOG['IP-03'], active: true,
        detail: `Contrato incrementado ${(increase * 100).toFixed(1)}% por enmiendas`,
      });
    }
  }
  if (proc.has_amendments && proc.award_amount && proc.final_amount) {
    const increase = (proc.final_amount - proc.award_amount) / proc.award_amount;
    if (increase > 0.15) {
      flags.push({
        ...FLAG_CATALOG['IP-03'], active: true,
        detail: `Valor final ${(increase * 100).toFixed(1)}% mayor al adjudicado`,
      });
    }
  }

  // TR-01: Critical missing information
  const missingFields: string[] = [];
  if (!proc.buyer_id) missingFields.push('comprador');
  if (!value) missingFields.push('valor');
  if (!proc.suppliers?.length) missingFields.push('proveedor');
  if (!proc.procurement_method && !proc.procurement_method_details) missingFields.push('método');
  if (missingFields.length > 0) {
    flags.push({
      ...FLAG_CATALOG['TR-01'], active: true,
      detail: `Faltan: ${missingFields.join(', ')}`,
    });
  }

  // TR-02: Generic description (<30 chars)
  const desc = proc.description || proc.title || '';
  if (desc.length < 30 && desc.length > 0) {
    flags.push({
      ...FLAG_CATALOG['TR-02'], active: true,
      detail: `Descripción de solo ${desc.length} caracteres`,
    });
  }

  // TR-03: Régimen especial sin justificación
  // En los datos de SERCOP el régimen especial aparece como "Contratación directa"
  // o por el prefijo "RE-" en el OCID. Se marca cuando es contratación directa
  // de monto relevante (posible régimen especial sin justificación documentada).
  const methodLower = (proc.procurement_method_details || '').toLowerCase();
  const isRegimenEspecial =
    methodLower.includes('especial') ||
    methodLower.includes('emergent') ||
    methodLower.includes('contratación directa') ||
    methodLower.includes('contratacion directa') ||
    (proc.id || '').toUpperCase().startsWith('OCDS-5WNO2W-RE-') ||
    (proc.ocid || '').toUpperCase().includes('-RE-');
  if (isRegimenEspecial && value > threshold) {
    flags.push({
      ...FLAG_CATALOG['TR-03'], active: true,
      detail: `Posible régimen especial (${proc.procurement_method_details || 'contratación directa'}) de $${value.toLocaleString()} sin justificación en datos OCDS`,
    });
  }

  // Remove duplicate codes (keep first)
  const seen = new Set<string>();
  return flags.filter(f => {
    if (seen.has(f.code)) return false;
    seen.add(f.code);
    return true;
  });
}

// ── Concentration Flags (require historical context) ────────
// Evaluated using the concentration_index SQL table.
// The context is a per-procedure lookup object, built by the caller
// from the concentration_index table. This scales to millions of rows
// without loading everything into memory.

export interface SupplierConcentration {
  supplier_id: string;
  supplier_name: string;
  infima_count: number;        // ínfimas de este proveedor con este comprador, en el año del proceso
  infima_total_value: number;  // suma de montos de esas ínfimas
  share_of_buyer: number;      // % del gasto del comprador que va a este proveedor, en el año
  years_active: number;        // en cuántos años distintos (de los 7) este proveedor ganó a este comprador
  consortium_count: number;    // en cuántos procesos-consorcio (2+ proveedores) participó con este comprador
  total_value: number;         // monto total adjudicado al par comprador-proveedor (todos los años)
  buyer_total_procs: number;   // total de procesos del comprador (volumen, para el piso de CC-02)
}

export interface ConcentrationContext {
  // "buyer_id|supplier_id" -> datos de concentración de ese par
  bySupplier: Map<string, SupplierConcentration>;
}

function isCatalogoElectronico(proc: any): boolean {
  const m = (proc.procurement_method_details || '').toLowerCase();
  const t = (proc.title || '').toUpperCase();
  return m.includes('cat\u00e1logo electr\u00f3nico') || m.includes('catalogo electronico') || t.startsWith('ORDEN DE COMPRA CE');
}

// \u00cdnfima por MONTO (mismo criterio que el \u00edndice de concentraci\u00f3n en db.ts):
// no-cat\u00e1logo y monto adjudicado positivo bajo el umbral anual. En los datos de
// SERCOP el m\u00e9todo nunca contiene la palabra "\u00ednfima", as\u00ed que detectarla por
// texto deja CC-01 muerta; las banderas de concentraci\u00f3n usan este criterio.
function isInfimaByAmount(proc: ProcedureData): boolean {
  if (isCatalogoElectronico(proc)) return false;
  const value = proc.award_amount || 0;
  if (value <= 0) return false;
  const date = proc.published_date || proc.award_date || null;
  return value <= getInfimaThreshold(date);
}

export function evaluateConcentrationFlags(
  proc: ProcedureData,
  ctx: ConcentrationContext
): Flag[] {
  const flags: Flag[] = [];

  // CALIBRACION: el catalogo electronico es compra centralizada (SERCOP precalifica
  // proveedores y fija precios). La concentracion comprador-proveedor en catalogo NO
  // indica direccionamiento del comprador, asi que las banderas de concentracion no
  // aplican. Solo se evaluan en contratacion tradicional (licitacion, cotizacion,
  // menor cuantia, regimen especial, contratacion directa).
  if (isCatalogoElectronico(proc)) return [];

  const date = proc.published_date || proc.award_date || null;
  const threshold = getInfimaThreshold(date);
  // CC-01 usa ínfima por MONTO (no por el texto del método, que nunca dice "ínfima"
  // en los datos de SERCOP). Antes daba 0 disparos por esa incompatibilidad.
  const isInf = isInfimaByAmount(proc);
  const isConsortium = (proc.suppliers || []).length >= 2;

  for (const supplier of (proc.suppliers || [])) {
    if (!supplier.id) continue;
    const key = `${proc.buyer_id}|${supplier.id}`;
    const c = ctx.bySupplier.get(key);
    if (!c) continue;

    // CC-01: Proveedor recurrente en ínfima cuantía (5+ ínfimas mismo comprador en el año)
    if (isInf && c.infima_count >= 5) {
      flags.push({
        ...FLAG_CATALOG['CC-01'], active: true,
        detail: `${supplier.name} tiene ${c.infima_count} ínfimas con este comprador en el año`,
      });
    }

    // CC-02: Proveedor dominante (>40% del gasto del comprador, solo si el comprador
    // tiene volumen suficiente: >=10 procesos. Un 100% en un comprador con 1-2 procesos no discrimina).
    if (c.share_of_buyer > 40 && c.buyer_total_procs >= 10) {
      flags.push({
        ...FLAG_CATALOG['CC-02'], active: true,
        detail: `${supplier.name} representa ${c.share_of_buyer.toFixed(1)}% del gasto de este comprador`,
      });
    }

    // CC-03: Proveedor histórico permanente (5+ años con el mismo comprador) y con monto
    // total significativo (>50k), para descartar recurrencia de compras menores.
    if (c.years_active >= 5 && c.total_value > 50000) {
      flags.push({
        ...FLAG_CATALOG['CC-03'], active: true,
        detail: `${supplier.name} presente en ${c.years_active} de los últimos 7 años con este comprador`,
      });
    }

    // CC-04: Miembro recurrente de consorcio (en 2+ procesos-consorcio del mismo comprador)
    // Umbral bajado a 2+ porque en estos datos solo hay 41 procesos-consorcio en total.
    if (isConsortium && c.consortium_count >= 2) {
      flags.push({
        ...FLAG_CATALOG['CC-04'], active: true,
        detail: `${supplier.name} aparece en ${c.consortium_count} consorcios con este comprador`,
      });
    }

    // CC-05: Posible fraccionamiento (suma de ínfimas mismo proveedor+comprador > umbral anual)
    if (c.infima_count >= 2 && c.infima_total_value > threshold) {
      flags.push({
        ...FLAG_CATALOG['CC-05'], active: true,
        detail: `${c.infima_count} ínfimas a ${supplier.name} suman $${c.infima_total_value.toLocaleString()} (umbral anual: $${threshold.toLocaleString()})`,
      });
    }
  }

  // Remove duplicate codes
  const seen = new Set<string>();
  return flags.filter(f => {
    if (seen.has(f.code)) return false;
    seen.add(f.code);
    return true;
  });
}

// ── Full evaluation ─────────────────────────────────────────
export function evaluateAllFlags(
  proc: ProcedureData,
  ctx?: ConcentrationContext
): { flags: Flag[]; score: number; riskLevel: string } {
  const individual = evaluateIndividualFlags(proc);
  const concentration = ctx ? evaluateConcentrationFlags(proc, ctx) : [];

  // Merge (individual first, then concentration, no duplicates)
  const allFlags: Flag[] = [...individual];
  const codes = new Set(individual.map(f => f.code));
  for (const f of concentration) {
    if (!codes.has(f.code)) {
      allFlags.push(f);
      codes.add(f.code);
    }
  }

  const score = calculateScore(allFlags);
  const riskLevel = getRiskLevel(score);

  return { flags: allFlags, score, riskLevel };
}

// ── OCDS Release Parser ─────────────────────────────────────
export function parseOcdsRelease(release: any): ProcedureData {
  const tender = release.tender || {};
  const awards = release.awards || [];
  const contracts = release.contracts || [];
  const buyer = release.buyer || tender.procuringEntity || {};
  const firstAward = awards[0] || {};
  const firstContract = contracts[0] || {};

  const suppliers = (firstAward.suppliers || []).map((s: any) => ({
    id: s.id || s.identifier?.id || '',
    name: s.name || '',
  }));

  return {
    id: release.ocid || release.id,
    procurement_method: tender.procurementMethod,
    procurement_method_details: tender.procurementMethodDetails,
    buyer_id: buyer.id || buyer.identifier?.id,
    budget_amount: tender.value?.amount || release.planning?.budget?.amount?.amount,
    award_amount: firstAward.value?.amount,
    contract_amount: firstContract.value?.amount,
    final_amount: firstContract.implementation?.finalValue?.amount,
    published_date: tender.tenderPeriod?.startDate || release.date,
    submission_deadline: tender.tenderPeriod?.endDate,
    award_date: firstAward.date,
    number_of_tenderers: tender.numberOfTenderers ||
      (release.bids?.details ? release.bids.details.length : undefined),
    title: tender.title || tender.description,
    description: tender.description || tender.title,
    items_classification: tender.items?.[0]?.classification?.id,
    has_amendments: (firstContract.amendments?.length || 0) > 0,
    amendment_count: firstContract.amendments?.length || 0,
    suppliers,
  };
}
