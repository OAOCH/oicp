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
  // 2025 es un año partido en TRES tramos: hasta el 6-jul rige el coeficiente ($7.212,60),
  // del 7-jul al 6-oct rigen $10.000 por la Resolución R.E-SERCOP-2025-0152, y desde el
  // 7-oct los mismos $10.000 ya con rango de ley (Art. 50 de la LOSNCP reformada). Esta fila
  // guarda solo el valor del COEFICIENTE; los cortes por fecha los resuelve
  // getInfimaThreshold(), que es la única fuente del umbral. Antes decía 10.000 y contradecía
  // a la propia función.
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

/**
 * POLÍTICA DE CITAS A LA GUÍA DE LA OCP (revisada el 2026-08-11 contra el PDF oficial de la
 * edición 2024, código por código, no contra un resumen).
 *
 * `ocp_ref` solo se pone cuando el indicador implementa DE VERDAD lo que ese código mide. Una
 * cita falsa es peor que ninguna: un auditor la comprueba en treinta segundos y, si no cuadra,
 * pone en duda todo lo demás. De las 13 citas que había, tres eran correctas, dos eran
 * adaptaciones y ocho apuntaban a un código que mide otra cosa.
 *
 * Correcciones aplicadas:
 *  - IP-02: R059 mide adjudicado contra CONTRATO FINAL. El indicador compara adjudicado contra
 *    PRESUPUESTO REFERENCIAL, que es exactamente R031 ("Winning bid price very close or higher
 *    than estimated price"). Se cambia a R031.
 *  - CC-02: R051 es concentración de MERCADO por índice Herfindahl-Hirschman. El indicador mide
 *    la cuota de un proveedor sobre UN comprador, que es R050 ("High market share"). Se cambia.
 *  - CC-05: la fórmula implementada (sumar las ínfimas del par y comparar la SUMA contra el
 *    umbral) es literalmente la de R055, no la de R011, que exige que cada compra individual
 *    quede justo debajo del umbral y sean de la misma categoría en una ventana corta.
 *
 * Citas retiradas por no tener equivalente en la guía:
 *  - IC-02 (era R055): R055 exige sumar VARIAS adjudicaciones directas del mismo par
 *    comprador-proveedor; IC-02 evalúa un proceso aislado contra el umbral.
 *  - CC-04 (era R070): R070 es "los oferentes perdedores son contratados como subcontratistas",
 *    con datos de subcontratación que el SERCOP no publica. CC-04 mide reincidencia en consorcios.
 *  - TR-01 (era R001): R001 es la ausencia de documentos de PLANIFICACIÓN. TR-01 mira cuatro
 *    campos operativos del proceso.
 *  - TR-02 (era R013): R013 es la proporción de métodos no competitivos de un COMPRADOR. TR-02
 *    mide la longitud del texto de la descripción de un proceso.
 *  - TR-03 (era R039): R039 son preguntas de oferentes sin responder. TR-03 detecta régimen
 *    especial por el texto del procedimiento.
 *
 * Adaptaciones declaradas, que se conservan porque el parentesco es real pero no exacto:
 *  - IT-02 / R061: la guía mide el intervalo CIERRE DE OFERTAS → adjudicación; aquí se mide
 *    PUBLICACIÓN → adjudicación, porque es el par de fechas que publica el SERCOP.
 *  - IP-01 / R011: la guía agrupa dos o más procesos del mismo comprador y categoría; aquí se
 *    evalúa la cercanía al umbral de un proceso individual. La agregación de R011 la hace CC-05.
 */
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
    description_es: 'Adjudicación directa por monto superior al umbral de ínfima cuantía, fuera del catálogo electrónico.',
    severity: 3,   // sin ocp_ref: R055 exige sumar varias adjudicaciones del mismo par (ver la política arriba)
  },
  'IT-01': {
    code: 'IT-01', category: 'tiempo', name: 'Insufficient Tender Period',
    name_es: 'Plazo Insuficiente para Entregar Ofertas',
    description_es: 'El plazo para entregar ofertas es menor al mínimo. Desde el 28-oct-2025, y cuando se conocen las dos fechas reales, se aplica el término del Art. 96 del Reglamento; en el resto es una señal referencial que NO reproduce ese término.',
    severity: 1, ocp_ref: 'R003',
  },
  'IT-02': {
    code: 'IT-02', category: 'tiempo', name: 'Lightning Award',
    name_es: 'Adjudicación Relámpago',
    description_es: 'La adjudicación ocurrió en menos de 3 días hábiles desde la publicación. No aplica a ínfima cuantía.',
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
    severity: 2, ocp_ref: 'R031',
  },
  'IP-03': {
    code: 'IP-03', category: 'precio', name: 'Significant Contract Amendment',
    name_es: 'Modificación Contractual Significativa',
    description_es: 'El contrato recibió enmiendas que incrementan su valor más del 15%.',
    severity: 3, ocp_ref: 'R069',
  },
  // Las banderas de concentración (CC-01, CC-02, CC-05) miden la concentración por
  // UNIDAD DE COMPRA (buyer_id), que es quien decide la contratación. La dominancia a
  // nivel de INSTITUCIÓN (RUC consolidado) NO se evalúa como bandera: un proveedor
  // repartido entre muchas unidades de la misma institución puede no disparar CC-02
  // aunque concentre mucho a nivel institucional. Limitación declarada (decisión de
  // Oscar, 13-ago-2026); el contexto consolidado por RUC se publica en el perfil del
  // comprador (web y MCP) sin tocar banderas ni scores. Cambiar CC-02 a RUC consolidado
  // se evaluó y se DESCARTÓ: un proveedor nacional que atiende a 100 hospitales
  // independientes del mismo ministerio saldría «dominante» sin que ningún decisor lo
  // haya favorecido.
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
    severity: 3, ocp_ref: 'R050',
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
    severity: 2,   // sin ocp_ref: R070 es subcontratación de oferentes perdedores, no consorcios
  },
  'CC-05': {
    code: 'CC-05', category: 'concentracion', name: 'Possible Splitting',
    name_es: 'Posible Fraccionamiento',
    description_es: 'Un mismo comprador adjudica varias ínfimas cuantías al mismo proveedor en el año cuya suma supera el umbral anual (Art. 270 Reglamento LOSNCP).',
    severity: 3, ocp_ref: 'R055',
  },
  'TR-01': {
    code: 'TR-01', category: 'transparencia', name: 'Critical Missing Information',
    name_es: 'Información Incompleta Crítica',
    description_es: 'Faltan campos esenciales: comprador, valor o método de contratación; el proveedor solo se exige desde la adjudicación (en convocatoria todavía no existe).',
    severity: 1,   // sin ocp_ref: R001 es la ausencia de documentos de PLANIFICACIÓN
  },
  'TR-02': {
    code: 'TR-02', category: 'transparencia', name: 'Generic Description',
    name_es: 'Descripción Genérica',
    description_es: 'La descripción del proceso tiene menos de 30 caracteres.',
    severity: 0,   // sin ocp_ref: R013 es la proporción de métodos no competitivos de un COMPRADOR
  },
  'TR-03': {
    code: 'TR-03', category: 'transparencia', name: 'No Special Regime Justification',
    name_es: 'Sin Justificación de Régimen Especial',
    description_es: 'Proceso de régimen especial sin justificación documentada.',
    severity: 2,   // sin ocp_ref: R039 son preguntas de oferentes sin responder
  },
};

// ── Severity Weights & Scoring ──────────────────────────────
const SEVERITY_WEIGHTS: Record<number, number> = { 0: 3, 1: 8, 2: 18, 3: 30 };

/**
 * Pares que miden el MISMO hecho: cuando los dos están activos, el segundo pondera al 50% para
 * no cobrar dos veces por una sola observación. Formato: [a, b, factor] descuenta a `b` si `a`
 * está activa.
 *
 * REPLANTEADO EL 11-AGO-2026 CON DATOS. La lista anterior tenía un par que nunca se aplicaba y
 * le faltaba el único que de verdad importa. Medido sobre los 1.470.321 procesos:
 *
 *   IC-01 + IC-02:  0 co-ocurrencias en los ocho años. Y no es casualidad de los datos: es
 *                   estructural. IC-01 exige un método COMPETITIVO y IC-02 exige
 *                   procurement_method === 'direct'. Son mutuamente excluyentes por
 *                   construcción, así que el descuento declarado nunca podía aplicarse.
 *                   Se retira: publicar un descuento que no existe es peor que no tenerlo.
 *   IC-02 + TR-03:  42.321 co-ocurrencias sobre 44.064 disparos de IC-02, el 96,0%. Los dos
 *                   exigen que el monto supere el umbral de ínfima y los dos se activan con la
 *                   contratación directa o el régimen especial: es UNA sola observación cobrada
 *                   dos veces, 30 + 18 = 48 de los 100 puntos posibles. No tenía descuento.
 *                   Se agrega, y se descuenta TR-03, que es la señal más débil de las dos.
 *   CC-01 + CC-05:  111 co-ocurrencias. Se mantiene.
 *   IP-01 + CC-05:  341 co-ocurrencias. Se mantiene.
 */
const CORRELATED_FLAGS: [string, string, number][] = [
  ['IC-02', 'TR-03', 0.5],
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
    //
    // `ocp_ref` se resuelve APARTE porque es el único campo estático que puede tener que
    // DESAPARECER. Con el spread solo, quitar una cita del catálogo no la borraba de las filas
    // ya guardadas: la vieja sobrevivía por no estar la clave en el objeto de encima. Al
    // retirar el 2026-08-11 las cinco citas OCP que no correspondían, esas fichas habrían
    // seguido publicándolas hasta el próximo recálculo.
    return { ...f, ...catalogo, ocp_ref: catalogo.ocp_ref, severity: severidadDe(f) };
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
  /** Fecha límite para que la entidad CONTESTE preguntas: de aquí arranca el término del Art. 96.
   *  No está en los datos abiertos; sale de la ficha pública del SOCE. */
  answer_deadline?: string | null;
  status?: string | null;                 // tender|active|award|contract|complete: TR-01 exige proveedor solo desde award
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

// ── Feriados nacionales del Ecuador ─────────────────────────────────────────
//
// Art. 65 del Código del Trabajo (Codificación 17, R.O.S 167 de 16-dic-2005, reformado por el
// Art. 3 de la Ley de R.O. Suplemento 906 de 20-dic-2016), verificado textualmente en Lexis el
// 2026-08-11 sobre el texto VIGENTE:
//
//   «Además de los sábados y domingos, son días de descanso obligatorio los siguientes: 1 de
//   enero, viernes santo, 1 y 24 de mayo, 10 de agosto, 9 de octubre, 2 y 3 de noviembre, 25 de
//   diciembre y los días lunes y martes de carnaval.»
//
//   «Cuando los días feriados de descanso obligatorio establecidos en este Código, correspondan
//   al día martes, el descanso se trasladará al día lunes inmediato anterior, y si coinciden con
//   los días miércoles o jueves, el descanso se pasará al día viernes de la misma semana. [...]
//   Se exceptúan de esta disposición los días 1 de enero, 25 de diciembre y martes de carnaval.»
//
//   «Cuando los días feriados [...] correspondan a los días sábados o domingos, el descanso se
//   trasladará, respectivamente, al anterior día viernes o al posterior día lunes.»
//
// Dos decisiones de lectura, declaradas porque el texto no las resuelve:
//  1. La excepción del 1-ene, 25-dic y martes de carnaval está redactada dentro del párrafo del
//     martes/miércoles/jueves, así que NO se aplica al párrafo de sábado y domingo. Un 1 de enero
//     en sábado se traslada al viernes 31 de diciembre anterior.
//  2. El descanso se TRASLADA, no se duplica: la fecha original deja de ser feriado.
//
// El decreto ejecutivo anual de feriados puede apartarse de esta regla en un año concreto (suele
// hacerlo con los puentes). Este calendario es el del Código, y así se declara en la metodología.
const FERIADOS_FIJOS: [number, number][] = [
  [1, 1], [5, 1], [5, 24], [8, 10], [10, 9], [11, 2], [11, 3], [12, 25],
];

// Domingo de Pascua (gregoriano), algoritmo de Meeus/Jones/Butcher.
function domingoDePascua(anio: number): number {
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(anio, mes - 1, dia);
}

const DIA_MS = 86_400_000;
const aISO = (ts: number) => new Date(ts).toISOString().slice(0, 10);

function feriadosDelAnio(anio: number): string[] {
  const pascua = domingoDePascua(anio);
  const martesCarnaval = pascua - 47 * DIA_MS;
  // [timestamp, se le aplica el traslado de martes/miércoles/jueves]
  const dias: [number, boolean][] = FERIADOS_FIJOS.map(([m, d]) => {
    const ts = Date.UTC(anio, m - 1, d);
    const exento = (m === 1 && d === 1) || (m === 12 && d === 25);
    return [ts, !exento] as [number, boolean];
  });
  dias.push([pascua - 2 * DIA_MS, true]);        // viernes santo (ya es viernes)
  dias.push([pascua - 48 * DIA_MS, true]);       // lunes de carnaval
  dias.push([martesCarnaval, false]);            // martes de carnaval: exento del traslado

  return dias.map(([ts, trasladable]) => {
    const dow = new Date(ts).getUTCDay();
    if (dow === 6) return aISO(ts - DIA_MS);                      // sábado -> viernes anterior
    if (dow === 0) return aISO(ts + DIA_MS);                      // domingo -> lunes posterior
    if (!trasladable) return aISO(ts);
    if (dow === 2) return aISO(ts - DIA_MS);                      // martes -> lunes anterior
    if (dow === 3) return aISO(ts + 2 * DIA_MS);                  // miércoles -> viernes
    if (dow === 4) return aISO(ts + DIA_MS);                      // jueves -> viernes
    return aISO(ts);
  });
}

// Se cachean por año porque businessDays se llama 1,47 M veces en cada recálculo. Se incluyen el
// año anterior y el siguiente porque un traslado puede cruzar el cambio de año (un 1 de enero en
// sábado descansa el 31 de diciembre anterior).
const cacheFeriados = new Map<number, Set<string>>();
function feriados(anio: number): Set<string> {
  let s = cacheFeriados.get(anio);
  if (!s) {
    s = new Set([...feriadosDelAnio(anio - 1), ...feriadosDelAnio(anio), ...feriadosDelAnio(anio + 1)]);
    cacheFeriados.set(anio, s);
  }
  return s;
}

export function esFeriadoNacional(fechaISO: string): boolean {
  const d = String(fechaISO || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return feriados(Number(d.slice(0, 4))).has(d);
}

/**
 * Días hábiles entre dos fechas, ambos extremos incluidos y sin sábados, domingos ni feriados.
 *
 * CORREGIDO EL 11-AGO-2026. La versión anterior iteraba sobre objetos Date COMPLETOS, con hora,
 * y usaba getDay()/setDate(), que dependen de la zona horaria del servidor. El resultado no
 * dependía del calendario sino de la hora del día: medido sobre producción, de los procesos con
 * exactamente UN día calendario entre publicación y adjudicación, 311 reportaban «1 día hábil» y
 * 460 reportaban «2». El mismo intervalo, dos respuestas.
 *
 * Ahora se trabaja sobre la FECHA CALENDARIO en cadena ISO, igual que getInfimaThreshold(), y el
 * conteo es aritmético en vez de iterativo: además de ser determinista, no puede quedarse en un
 * bucle largo si la fuente publica una fecha absurda.
 *
 * FERIADOS: se descuentan desde el 11-ago-2026, con el calendario del Art. 65 del Código del
 * Trabajo verificado en Lexis (ver arriba). El COA Art. 159 los excluye del cómputo de términos.
 *
 * PENDIENTE DECLARADO: el cómputo todavía INCLUYE el día inicial, mientras que el COA Art. 158
 * dispone que los términos corren «a partir del día hábil siguiente». No se cambia aquí porque
 * mueve el significado de los umbrales de IT-01 (9/13/17), que están pendientes de una decisión
 * sobre a qué tramo corresponden y desde qué fecha aplican. Las dos cosas se resuelven juntas o
 * el indicador queda a medio camino. Se declara en la metodología publicada.
 */
function businessDays(start: string, end: string): number {
  const s = String(start || '').slice(0, 10);
  const e = String(end || '').slice(0, 10);
  const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
  const ms = ISO.exec(s);
  const me = ISO.exec(e);
  if (!ms || !me) return 0;

  const desde = Date.UTC(+ms[1], +ms[2] - 1, +ms[3]);
  const hasta = Date.UTC(+me[1], +me[2] - 1, +me[3]);
  if (hasta < desde) return 0;

  const dias = (hasta - desde) / DIA_MS + 1;       // ambos extremos incluidos
  const semanas = Math.floor(dias / 7);
  let habiles = semanas * 5;
  let dow = new Date(desde).getUTCDay();           // UTC: no depende del servidor
  for (let i = 0; i < dias % 7; i++) {
    if (dow !== 0 && dow !== 6) habiles++;
    dow = (dow + 1) % 7;
  }

  // Se restan los feriados que caen dentro del rango Y en día laborable. Se recorre el conjunto
  // de feriados (una decena por año), no los días del rango, para que el coste no dependa de la
  // longitud del intervalo.
  // Se unen en UN conjunto antes de recorrer: feriados(anio) ya incluye el año anterior y el
  // siguiente, así que iterar dos años por separado descontaría dos veces el mismo feriado.
  const delRango = new Set<string>();
  for (const anio of new Set([+ms[1], +me[1]])) {
    for (const f of feriados(anio)) if (f >= s && f <= e) delRango.add(f);
  }
  for (const f of delRango) {
    const d = new Date(Date.UTC(+f.slice(0, 4), +f.slice(5, 7) - 1, +f.slice(8, 10))).getUTCDay();
    if (d !== 0 && d !== 6) habiles--;
  }
  return Math.max(0, habiles);
}

// ── Término del Art. 96 del Reglamento ───────────────────────────────────────────────────────
// «Art. 96.- Términos para la entrega de ofertas.- De conformidad al presupuesto referencial del
// procedimiento, la entidad contratante, para establecer la fecha límite de entrega de ofertas
// técnicas, observará los términos previstos a continuación, contados a partir de fenecer la fecha
// límite para contestar respuestas y aclaraciones».
//
// Tabla verificada en el Registro Oficial Noveno Suplemento 153 de 28-oct-2025, página 69,
// extraída del PDF oficial y contrastada con una copia independiente y con Lexis. El Decreto
// Ejecutivo 461 (R.O. 3S 337, 30-jul-2026) NO reformó este artículo, ni la fe de erratas
// (R.O. 7S 155) ni los decretos 295 y 356.
//
// La tabla EMPIEZA en «superior a 10.000»: por debajo de ese monto no hay término asignado, así
// que esos procedimientos no se evalúan por este criterio.
export const ART96_VIGENCIA = '2025-10-28';

export function terminoArt96(presupuesto: number): number | null {
  if (!(presupuesto > 10_000)) return null;
  if (presupuesto <= 100_000) return 2;
  if (presupuesto <= 500_000) return 4;
  if (presupuesto <= 1_000_000) return 6;
  return 10;
}

/**
 * Días hábiles de un término administrativo: se cuenta DESDE EL DÍA HÁBIL SIGUIENTE al hecho,
 * como manda el COA Art. 158, y sin los feriados, como manda el Art. 159.
 *
 * `businessDays()` incluye ambos extremos, que es lo que sigue usando la regla referencial de
 * IT-01 por compatibilidad con sus umbrales. Aquí NO se puede: el término legal empieza al día
 * siguiente, y contar el día inicial lo sobreestima en uno.
 */
export function terminoEnDiasHabiles(desde: string, hasta: string): number {
  const d = String(desde || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return 0;
  const siguiente = new Date(Date.parse(`${d}T00:00:00Z`) + DIA_MS).toISOString().slice(0, 10);
  return businessDays(siguiente, hasta);
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

  // ── IT-01: plazo para entregar ofertas ─────────────────────────────────────────────────────
  // Dos regímenes, y el que se aplica depende de qué datos tenga el proceso:
  //
  // (A) TÉRMINO LEGAL del Art. 96. Exige las DOS fechas reales: la fecha límite para RESPONDER
  //     (de donde arranca el término) y la de entrega de ofertas. Ninguna de las dos está en los
  //     datos abiertos del SERCOP: la primera no se publica y la segunda viene vacía en el 93% de
  //     los procesos. Se obtienen de la ficha pública del SOCE (ver server/soce-ficha.ts) y se
  //     guardan en `answer_deadline` y `submission_deadline`. Solo aplica desde el 28-oct-2025,
  //     porque antes esos mínimos escalonados no existían: aplicarlos a 2019-2025 sería un
  //     anacronismo. Se cuenta desde el día hábil SIGUIENTE (COA Art. 158) y sin feriados (159).
  //
  // (B) REFERENCIAL, mientras no se tengan esas fechas: publicación → cierre de ofertas contra
  //     9/13/17 días. Esos mínimos NO salen de ninguna norma y el detalle lo dice, para que nadie
  //     cite el indicador como si reprodujera el Art. 96.
  const fechaProc = proc.published_date || proc.award_date || '';
  const presupuesto = Number(proc.budget_amount) || 0;
  const minLegal = terminoArt96(presupuesto);
  if (proc.answer_deadline && proc.submission_deadline && minLegal !== null &&
      String(fechaProc).slice(0, 10) >= ART96_VIGENCIA) {
    const dias = terminoEnDiasHabiles(proc.answer_deadline, proc.submission_deadline);
    if (dias < minLegal) {
      flags.push({
        ...FLAG_CATALOG['IT-01'], active: true,
        detail: `Art. 96: ${dias} días de término (mínimo ${minLegal} para un presupuesto de ` +
          `$${presupuesto.toLocaleString('es-EC', DOS_DECIMALES)}), contados desde el cierre de respuestas`,
      });
    }
  } else if (proc.published_date && proc.submission_deadline && value > 10_000) {
    const days = businessDays(proc.published_date, proc.submission_deadline);
    let minDays = 9;
    if (value > 500_000) minDays = 17;
    else if (value > 100_000) minDays = 13;
    if (days < minDays) {
      flags.push({
        ...FLAG_CATALOG['IT-01'], active: true,
        detail: `Referencial: ${days} días hábiles entre publicación y cierre de ofertas ` +
          `(mínimo de referencia ${minDays} para $${value.toLocaleString('es-EC', DOS_DECIMALES)}); ` +
          `no reproduce el término del Art. 96`,
      });
    }
  }

  // IT-02: Adjudicación relámpago (< 3 días hábiles).
  //
  // La exclusión de ínfima cuantía ahora se evalúa POR MONTO (isInfimaByAmount), el mismo
  // criterio que usan las banderas de concentración. Antes se evaluaba por el TEXTO del
  // procedimiento, buscando la palabra "ínfima", que no aparece en ninguno de los 1.470.321
  // procesos: la exclusión que la metodología prometía no descartaba nada, y 525 de los 2.237
  // disparos (23,5%) eran compras por debajo del umbral, marcadas por ser rápidas cuando su
  // rapidez es justamente lo esperable en una ínfima cuantía.
  //
  // Los 525 se midieron el 2026-08-11 sobre producción: 522 con el adjudicado estrictamente
  // bajo el umbral de su fecha y 3 exactamente en el umbral, que también son ínfima porque el
  // Art. 50 dice "igual o inferior" y la comparación es <=. La cifra que se publicó primero,
  // 524, se quedó corta en uno.
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
  // El PROVEEDOR solo se exige desde la adjudicación. Un proceso en convocatoria (status
  // tender/active) no lo tiene todavía por definición; exigirlo marcaba «información
  // incompleta crítica» en TODOS los procesos en curso (53.459 medidos en producción el
  // 5-sep-2026: 34.835 en tender y 18.624 en active), o sea que la bandera medía «no
  // adjudicado aún» y no una falta de transparencia. Sin status conocido se sigue exigiendo.
  const missingFields: string[] = [];
  if (!proc.buyer_id) missingFields.push('comprador');
  if (!value) missingFields.push('valor');
  const enConvocatoria = proc.status === 'tender' || proc.status === 'active';
  if (!enConvocatoria && !proc.suppliers?.length) missingFields.push('proveedor');
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

// \u00cdnfima por MONTO. Es la MISMA definici\u00f3n que SQL_ES_INFIMA_POR_MONTO en db.ts, y las dos
// tienen que dar lo mismo para el mismo proceso (regla 11): esta funci\u00f3n decide si un proceso
// ES \u00ednfima y aquella cuenta cu\u00e1ntas acumula el par comprador-proveedor. Se exporta para que
// data-integrity.test.ts pueda compararlas fila por fila; si divergen, la prueba falla.
//
// No-cat\u00e1logo y monto adjudicado positivo bajo el umbral de la fecha. El cat\u00e1logo queda fuera
// por norma, no por criterio del observatorio: el Art. 50 de la LOSNCP admite la \u00ednfima
// "siempre que no consten en el Cat\u00e1logo Electr\u00f3nico". En los datos de SERCOP el m\u00e9todo nunca
// contiene la palabra "\u00ednfima", as\u00ed que detectarla por texto deja CC-01 muerta.
export function isInfimaByAmount(proc: ProcedureData): boolean {
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
