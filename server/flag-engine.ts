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
  // 2025 es un año partido: hasta el 6-oct rige el coeficiente ($7.212,60) y desde el
  // 7-oct la reforma fija $10.000. Esta fila guarda el valor del COEFICIENTE, que es el
  // que corresponde a la mayor parte del año; la fecha exacta la resuelve
  // getInfimaThreshold(). Antes decía 10.000 y contradecía a la propia función.
  2025: { pie: 36_063_017_083.08, regime: 'LOSNCP_COEFICIENTES', infima_cuantia: 7_212.60 },
  2026: { pie: 46_255_572_824.33, regime: 'LOSNCP_REFORMADA', infima_cuantia: 10_000.00 },
};

export function getThreshold(year: number): YearThresholds {
  return UMBRALES[year] || UMBRALES[2026];
}

/**
 * Umbral de ínfima cuantía por FECHA del proceso, verificado contra norma el 2026-08-11.
 *
 * 2025 tiene TRES tramos, no dos. La versión anterior de esta función situaba el salto a
 * USD 10.000 el 7 de octubre de 2025, y eso dejaba tres meses de procesos evaluados con el
 * umbral equivocado:
 *
 *  - Del 1 de enero al 6 de julio de 2025: coeficiente 0,0000002 del Presupuesto Inicial
 *    del Estado (LOSNCP Art. 52.1, hoy derogado) = USD 7.212,60.
 *  - **Del 7 de julio al 2 de octubre de 2025: USD 10.000**, por la Ley Orgánica de
 *    Integridad Pública. La Resolución R.E-SERCOP-2025-0152 (R.O. Quinto Suplemento No. 69
 *    de 27 de junio de 2025) dispuso expresamente que las ínfimas de más de USD 7.212,60 y
 *    hasta USD 10.000 se pueden llevar a cabo DESDE EL 7 DE JULIO DE 2025.
 *  - Desde el 7 de octubre de 2025: USD 10.000 por el Art. 50 de la LOSNCP reformada
 *    (R.O. Cuarto Suplemento No. 140 de 7 de octubre de 2025).
 *
 * Zona gris declarada: la Corte Constitucional declaró inconstitucional la Ley de Integridad
 * Pública en la sentencia 52-25-IN/25, publicada el 3 de octubre de 2025, con efectos hacia
 * el futuro. Del 3 al 6 de octubre de 2025 el umbral aplicable es jurídicamente discutible y
 * no hay pronunciamiento del SERCOP que lo resuelva. Se mantiene USD 10.000 en esa ventana
 * por continuidad con el tramo anterior, y queda advertido en la metodología publicada.
 *
 * Nota de frontera: el Art. 52.1 derogado decía "inferior a" (excluyente) y el Art. 50
 * vigente dice "igual o inferior a" USD 10.000 (incluyente). Los indicadores comparan con
 * <= , que es lo correcto para el régimen vigente y una diferencia de un centavo para el
 * anterior.
 */
export function getInfimaThreshold(dateStr: string | null): number {
  if (!dateStr) return 10_000;
  // Se compara la fecha CALENDARIO como cadena ISO, no como objeto Date. Con Date, una
  // fecha sin hora ('2025-07-07') se interpreta en UTC y una con offset de Ecuador
  // ('2025-07-07T00:00:00-05:00') son cinco horas distintas, así que el mismo día caía a un
  // lado o al otro del corte según cómo viniera escrito. La comparación lexicográfica de
  // YYYY-MM-DD es determinista y no depende de zona horaria.
  const fecha = String(dateStr).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return 10_000;
  // Vale tanto para el tramo de la Ley de Integridad Pública (desde el 7-jul-2025) como
  // para la LOSNCP reformada (desde el 7-oct-2025): el monto es el mismo.
  if (fecha >= '2025-07-07') return 10_000;
  const year = Number(fecha.slice(0, 4));
  if (year === 2025) return 7_212.60;   // 1-ene al 6-jul-2025: coeficiente
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
    name_es: 'Adjudicación Sobre el Presupuesto Referencial',
    description_es: 'El monto adjudicado supera en más del 15% el presupuesto referencial. Adjudicar por DEBAJO del referencial no activa este indicador: es el resultado esperable de la competencia y no una señal de riesgo.',
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
    description_es: 'Un proveedor recibe más del 40% del gasto total de un comprador en el año del proceso, en compradores con 10 o más procesos ese mismo año.',
    severity: 3, ocp_ref: 'R051',
  },
  'CC-03': {
    code: 'CC-03', category: 'concentracion', name: 'Historically Permanent Supplier',
    name_es: 'Proveedor Histórico Permanente',
    description_es: 'Un proveedor gana contratos del mismo comprador en 5 o más años distintos del período cubierto, con un monto acumulado superior a $50.000.',
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

/**
 * Severidad de una bandera. Se resuelve por CÓDIGO desde el catálogo y solo se usa el valor
 * guardado como respaldo.
 *
 * Importa más de lo que parece: si una bandera llega sin `severity` (porque viene de una
 * fila guardada con otro formato), `SEVERITY_WEIGHTS[undefined]` es undefined, el score sale
 * NaN, SQLite lo guarda como NULL y getRiskLevel(NaN) falla los tres cortes y devuelve
 * 'critical'. Serían 1,47 M procesos marcados como críticos sin un solo error en el log.
 */
function severidadDe(flag: { code: string; severity?: number }): number {
  const delCatalogo = FLAG_CATALOG[flag.code]?.severity;
  if (typeof delCatalogo === 'number') return delCatalogo;
  return typeof flag.severity === 'number' ? flag.severity : 0;
}

/**
 * Completa los campos ESTÁTICOS de una bandera desde el catálogo: nombre, descripción,
 * categoría, severidad y referencia OCP. Los campos propios del proceso (`code`, `active`,
 * `detail`) se conservan tal como están guardados.
 *
 * Con esto, el texto que ve el usuario sale SIEMPRE del catálogo vigente y no de lo que se
 * escribió en la base el día que se evaluó el proceso. Es lo que cierra la regla 10 de forma
 * estructural: corregir una descripción surte efecto de inmediato en los 1,47 M de procesos,
 * sin reescribir ninguna fila, y no puede quedar desincronizada.
 *
 * Tolera a propósito las dos formas (con y sin campos estáticos guardados), porque la base
 * puede tener filas escritas por versiones distintas. Un código que no esté en el catálogo
 * no revienta: se degrada al propio código.
 */
export function hidratarBanderas(flags: any[]): any[] {
  if (!Array.isArray(flags)) return [];
  return flags.map(f => {
    const catalogo = FLAG_CATALOG[f?.code];
    if (!catalogo) {
      // Código desconocido (catálogo cambiado o dato corrupto): nunca acceder a undefined.
      return { ...f, name_es: f?.name_es || f?.code || 'Indicador', severity: severidadDe(f || { code: '' }) };
    }
    // ORDEN IMPORTANTE: primero lo guardado, después el catálogo ENCIMA. Al revés, el texto
    // que quedó escrito en la fila el día de la evaluación pisaría al corregido, y la regla 10
    // seguiría rota exactamente igual que antes. `active` y `detail` sobreviven porque el
    // catálogo no los define (son datos del proceso, no del indicador).
    return { ...f, ...catalogo, severity: severidadDe(f) };
  });
}

export function calculateScore(flags: Flag[]): number {
  const activeFlags = flags.filter(f => f.active);
  // El descuento por correlación es independiente del orden de evaluación:
  // la bandera "b" del par se pondera al 50% (una sola vez, aunque tenga
  // varios pares) si su par "a" también está activa. Con el sort anterior
  // los pares IC-01→IC-02 e IP-01→CC-05 nunca descontaban.
  const activeCodes = new Set(activeFlags.map(f => f.code));
  let score = 0;

  for (const flag of activeFlags) {
    let weight = SEVERITY_WEIGHTS[severidadDe(flag)];
    if (CORRELATED_FLAGS.some(([a, b]) => flag.code === b && activeCodes.has(a))) {
      weight = Math.round(weight * 0.5);
    }
    score += weight;
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
  published_date?: string | null;
  submission_deadline?: string | null;
  award_date?: string | null;
  number_of_tenderers?: number | null;
  title?: string;
  description?: string;
  items_classification?: string | null;
  has_amendments?: boolean;
  amendment_count?: number | null;
  suppliers?: { id: string; name: string }[];
  // Año del proceso. Es la clave con la que las banderas de concentración buscan los
  // hechos DE SU AÑO; sin él caerían al año derivado de published_date.
  source_year?: number | null;
}

// Formato de moneda del texto de las banderas. Sin locale, toLocaleString() usaba el del
// servidor (inglés) y la ficha mostraba "$40,328,858.64" mientras el resto de la interfaz
// mostraba "$40.328.858,64": dos formatos para la misma cifra en la misma pantalla.
const DOS_DECIMALES = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;

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

  // IC-02: Alto valor sin competencia.
  //
  // Se EXCLUYE el catálogo electrónico, armonizando con el criterio que este mismo motor
  // aplica a todas las banderas de concentración (ver evaluateConcentrationFlags): el
  // catálogo es compra centralizada en la que el SERCOP precalifica proveedores y fija
  // precios, así que la ausencia de competencia en el momento de la orden no indica
  // direccionamiento de la entidad; la competencia ocurrió antes, al armar el catálogo.
  // El SERCOP publica esas órdenes con procurement_method "direct", y por eso 65.497 de los
  // 109.642 disparos de IC-02 (60%) eran compras de catálogo marcadas con la bandera de
  // mayor peso del sistema por hacer algo enteramente regular. Mantener el catálogo aquí y
  // excluirlo en las CC-* era una incoherencia interna sin justificación.
  //
  // Se eliminó también la rama que detectaba la ínfima por el TEXTO del procedimiento
  // (`isInfima`): buscaba la palabra "ínfima", que no aparece en ninguno de los 1.470.321
  // procesos, así que aportaba 0 disparos. Y no se puede sustituir por la detección por
  // monto, porque son condiciones incompatibles: si el monto supera el umbral, el proceso no
  // es ínfima por monto. Un proceso declarado ínfima con monto sobre el umbral no es
  // detectable con los datos que publica el SERCOP.
  if (proc.procurement_method === 'direct' && value > threshold && !isCatalogoElectronico(proc)) {
    flags.push({
      ...FLAG_CATALOG['IC-02'], active: true,
      detail: `Adjudicación directa $${value.toLocaleString('es-EC', DOS_DECIMALES)} > umbral $${threshold.toLocaleString('es-EC', DOS_DECIMALES)}`,
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
        detail: `${days} días hábiles (mínimo: ${minDays} para $${value.toLocaleString('es-EC', DOS_DECIMALES)})`,
      });
    }
  }

  // IT-02: Adjudicación relámpago (< 3 días hábiles).
  //
  // La exclusión de ínfima cuantía ahora se evalúa POR MONTO (isInfimaByAmount), el mismo
  // criterio que usan las banderas de concentración. Antes se evaluaba por el TEXTO del
  // procedimiento, buscando la palabra "ínfima", que no aparece en ninguno de los 1.470.321
  // procesos: la exclusión que la metodología prometía no descartaba nada, y 524 de los 2.237
  // disparos (23%) eran compras por debajo del umbral, marcadas por ser rápidas cuando su
  // rapidez es justamente lo esperable en una ínfima cuantía.
  if (proc.published_date && proc.award_date) {
    const days = businessDays(proc.published_date, proc.award_date);
    if (days < 3 && !isInfimaByAmount(proc)) {
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
      detail: `Valor $${value.toLocaleString('es-EC', DOS_DECIMALES)} = ${pct}% del umbral $${threshold.toLocaleString('es-EC', DOS_DECIMALES)}`,
    });
  }

  // IP-02: Adjudicación POR ENCIMA del presupuesto referencial (>15%).
  //
  // CORRECCIÓN DE DIRECCIÓN (2026-08-11). La versión anterior usaba el valor ABSOLUTO de la
  // diferencia, así que marcaba por igual las adjudicaciones por encima y por debajo del
  // referencial. Medido en producción sobre 2024: de los 1.704 procesos marcados, CERO tenían
  // el adjudicado por encima del presupuesto y los 1.704 estaban por debajo. Es decir, el
  // indicador señalaba de forma sistemática a entidades que adjudicaron por MENOS de lo
  // presupuestado, que es el resultado esperable de una competencia sana y no un riesgo.
  // La guía de banderas de la Open Contracting Partnership lo dice expresamente: se espera
  // que las ofertas caigan por debajo del precio estimado por efecto de la competencia.
  //
  // Ahora solo dispara cuando el Estado adjudicó por ENCIMA del referencial en más del 15%,
  // que sí es el supuesto de riesgo (presupuesto subestimado, direccionamiento o sobreprecio).
  // En estos datos ese caso es casi inexistente, y eso se declara en la metodología en vez de
  // rellenar el indicador con falsos positivos para que "dispare".
  if (proc.budget_amount && proc.award_amount && proc.budget_amount > 0) {
    const exceso = (proc.award_amount - proc.budget_amount) / proc.budget_amount;
    if (exceso > 0.15) {
      flags.push({
        ...FLAG_CATALOG['IP-02'], active: true,
        detail: `Adjudicado ${(exceso * 100).toFixed(1)}% POR ENCIMA del presupuesto referencial: $${proc.award_amount.toLocaleString('es-EC', DOS_DECIMALES)} frente a $${proc.budget_amount.toLocaleString('es-EC', DOS_DECIMALES)}`,
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
      detail: `Posible régimen especial (${proc.procurement_method_details || 'contratación directa'}) de $${value.toLocaleString('es-EC', DOS_DECIMALES)} sin justificación en datos OCDS`,
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

/** Hechos del par comprador-proveedor EN UN AÑO concreto. */
export interface PairYearConcentration {
  supplier_name: string;
  infima_count: number;
  infima_total_value: number;
  share_of_buyer: number;      // % del gasto del comprador EN ESE AÑO
  buyer_total_procs: number;   // procesos del comprador EN ESE AÑO (piso de volumen de CC-02)
}

/** Hechos del par acumulados entre años (los que por definición son históricos). */
export interface PairConcentration {
  supplier_name: string;
  years_active: number;        // cuántos años distintos del período contrataron juntos
  total_value: number;         // monto acumulado en todo el período
  consortium_count: number;    // procesos-consorcio del par (excluye catálogo electrónico)
}

export interface ConcentrationContext {
  // "buyer_id|supplier_id|año" -> hechos DEL AÑO DEL PROCESO. CC-01, CC-02 y CC-05 leen de
  // aquí. Antes el contexto colapsaba los años con Math.max y ese máximo se aplicaba a
  // TODOS los procesos del par, así que un proceso de 2019 se marcaba con el porcentaje de
  // 2026: en producción había un proceso de marzo de 2019 con CC-02 diciendo "98.8% del
  // gasto de este comprador" cuando su share real de 2019 fue 17,17%. Lo publicado siempre
  // dijo "en un año", así que el defecto estaba en el código, no en el texto.
  byPairYear: Map<string, PairYearConcentration>;
  // "buyer_id|supplier_id" -> hechos históricos. Solo CC-03 y CC-04 leen de aquí, porque
  // son indicadores que por definición miran todo el período.
  byPair: Map<string, PairConcentration>;
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

  // El año del proceso. Todo lo que se publica como "en un año" se mide contra ESTE año.
  const anio = proc.source_year || (proc.published_date ? Number(String(proc.published_date).slice(0, 4)) : 0);

  for (const supplier of (proc.suppliers || [])) {
    if (!supplier.id) continue;
    const par = `${proc.buyer_id}|${supplier.id}`;
    const cy = ctx.byPairYear.get(`${par}|${anio}`);   // hechos del año del proceso
    const cp = ctx.byPair.get(par);                     // hechos históricos del par

    // CC-01: Proveedor recurrente en ínfima cuantía: 5+ ínfimas del par EN EL AÑO DEL
    // PROCESO. El detalle nombra el año para que la cifra sea verificable.
    if (isInf && cy && cy.infima_count >= 5) {
      flags.push({
        ...FLAG_CATALOG['CC-01'], active: true,
        detail: `${supplier.name} tiene ${cy.infima_count} ínfimas con este comprador en ${anio}`,
      });
    }

    // CC-02: Proveedor dominante: >40% del gasto del comprador EN EL AÑO DEL PROCESO, y
    // solo si el comprador tuvo volumen suficiente ESE AÑO (>=10 procesos). Un 100% en un
    // comprador con 1-2 procesos no discrimina nada.
    if (cy && cy.share_of_buyer > 40 && cy.buyer_total_procs >= 10) {
      flags.push({
        ...FLAG_CATALOG['CC-02'], active: true,
        detail: `${supplier.name} representa ${cy.share_of_buyer.toFixed(1)}% del gasto de este comprador en ${anio} (${cy.buyer_total_procs} procesos del comprador ese año)`,
      });
    }

    // CC-03: Proveedor histórico permanente: 5+ años DISTINTOS del período con el mismo
    // comprador y monto acumulado > $50.000. No hay ninguna ventana de "últimos 7 años" en
    // el código, y publicarla producía el absurdo "presente en 8 de los últimos 7 años".
    if (cp && cp.years_active >= 5 && cp.total_value > 50000) {
      flags.push({
        ...FLAG_CATALOG['CC-03'], active: true,
        detail: `${supplier.name} contrató con este comprador en ${cp.years_active} años distintos del período, por $${Math.round(cp.total_value).toLocaleString('es-EC', DOS_DECIMALES)} acumulados`,
      });
    }

    // CC-04: Miembro recurrente de consorcio (2+ procesos-consorcio del par). Umbral bajo
    // a propósito: en estos datos solo hay 41 procesos-consorcio en total.
    if (isConsortium && cp && cp.consortium_count >= 2) {
      flags.push({
        ...FLAG_CATALOG['CC-04'], active: true,
        detail: `${supplier.name} aparece en ${cp.consortium_count} consorcios con este comprador`,
      });
    }

    // CC-05: Posible fraccionamiento: 2+ ínfimas del par EN EL AÑO cuya suma supera el
    // umbral de ínfima de la fecha del proceso.
    if (cy && cy.infima_count >= 2 && cy.infima_total_value > threshold) {
      flags.push({
        ...FLAG_CATALOG['CC-05'], active: true,
        detail: `${cy.infima_count} ínfimas a ${supplier.name} en ${anio} suman $${Math.round(cy.infima_total_value).toLocaleString('es-EC', DOS_DECIMALES)} (umbral de ínfima: $${threshold.toLocaleString('es-EC', DOS_DECIMALES)})`,
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
