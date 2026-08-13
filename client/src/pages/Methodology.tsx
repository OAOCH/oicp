import { useState, useEffect } from 'react';
import { SEVERITY_LABELS, FLAG_CATEGORIES, formatCount } from '../lib/flags';

// Estado del rellenado del presupuesto referencial, MEDIDO en el servidor.
// Esta página publicaba «falta hoy en 174.547 procesos (11,9%)» escrito a mano. El rellenado
// desde la fuente baja ese número cada hora, así que la cifra clavada se convertía en una
// afirmación falsa publicada a las pocas horas. Ahora sale de /api/version, la misma medición
// que devuelve el MCP, así que las dos superficies no pueden contradecirse (regla 11).
type EstadoPresupuesto = { total: number; pendientes: number; sin_dato: number; con_dato: number };

const fmt = (n: number) => formatCount(n);
const pct = (n: number, total: number) =>
  total > 0 ? `${(n * 100 / total).toFixed(1).replace('.', ',')}%` : '—';

const FLAGS = [
  { code: 'IC-01', category: 'competencia', severity: 2, ocp: 'R018', name: 'Proveedor Único en Proceso Competitivo',
    desc: 'Solo un oferente participó en un proceso que debería ser competitivo.',
    legal: 'Principio de concurrencia, Art. 6 LOSNCP reformada',
    logic: 'es_competitivo(procurement_method_details) AND number_of_tenderers == 1 — es_competitivo = el texto del procedimiento contiene "licitac", "subasta", "cotizac", "concurso" o "menor cuantía"' },
  { code: 'IC-02', category: 'competencia', severity: 3, ocp: '', name: 'Alto Valor Sin Competencia',
    desc: 'Adjudicación directa por monto superior al umbral de ínfima cuantía, fuera del catálogo electrónico.',
    legal: 'Art. 50 LOSNCP reformada; umbrales SERCOP por año',
    logic: 'procurement_method == "direct" AND valor > umbral_ínfima(fecha del proceso) AND NO es catálogo electrónico — valor = award_amount, o budget_amount si no hay adjudicado. CORREGIDO EL 11-AGO-2026: hasta esa fecha el indicador NO excluía el catálogo electrónico, y como el SERCOP publica esas órdenes con procurement_method "direct", 65.497 de sus 109.642 disparos (60%) eran compras de catálogo marcadas con la bandera de mayor peso del sistema por hacer algo enteramente regular. El catálogo es compra centralizada en la que el propio SERCOP precalifica proveedores y fija precios, así que la ausencia de competencia en el momento de la orden no indica direccionamiento de la entidad: la competencia ocurrió antes, al armar el catálogo. Es además el mismo criterio que el motor ya aplicaba a todas las banderas CC-*. Se eliminó también la rama que buscaba la palabra "ínfima" en el texto del procedimiento: ese texto no aparece en ningún proceso del conjunto de datos, así que aportaba 0 disparos' },
  { code: 'IT-01', category: 'tiempo', severity: 1, ocp: 'R003', name: 'Plazo Insuficiente para Entregar Ofertas',
    desc: 'El plazo para entregar ofertas es menor al mínimo. Desde el 28-oct-2025, y cuando se conocen las dos fechas reales, se aplica el término del Art. 96 del Reglamento; en el resto es una señal referencial que NO reproduce ese término.',
    legal: 'Arts. 91, 96, 111 Reglamento D.E. 193',
    logic: 'DOS REGÍMENES desde el 12-ago-2026, y el que se aplica depende de qué datos tenga el proceso. (A) TÉRMINO LEGAL DEL ART. 96, solo en procesos publicados desde el 28-oct-2025 y solo cuando se conocen las dos fechas reales: días hábiles desde el día SIGUIENTE al cierre de respuestas y aclaraciones (COA Art. 158) hasta la fecha límite de entrega de ofertas, descontando feriados (COA Art. 159), comparados contra la tabla del Registro Oficial Noveno Suplemento 153, página 69 — superior a 10.000 hasta 100.000: 2 días; hasta 500.000: 4; hasta 1.000.000: 6; de 1.000.000 en adelante: 10. Por debajo de 10.000 la tabla no asigna término y el proceso no se evalúa por este criterio. (B) REFERENCIAL en todo lo demás: días_hábiles(published_date, submission_deadline) contra 9/13/17 por monto, mínimos que NO salen de ninguna norma y que el detalle de la bandera declara como referenciales. POR QUÉ HAY DOS: la fecha límite para RESPONDER, que es de donde arranca el término legal, no está en los datos abiertos (la API publica la de PREGUNTAR, que va de 2 a 6 días antes según el Art. 91) y la fecha límite de ofertas viene vacía en el 93% de los procesos. Las dos se leen de la ficha pública del SOCE y el índice se está construyendo, así que la cobertura del régimen (A) crece con el tiempo. En Régimen Especial el portal rotula el hito como «Audiencia de Preguntas y Aclaraciones» y se lo trata como equivalente: es una interpretación y se declara como tal' },
  { code: 'IT-02', category: 'tiempo', severity: 2, ocp: 'R061', name: 'Adjudicación Relámpago',
    desc: 'La adjudicación ocurrió en menos de 3 días hábiles desde la publicación. No aplica a ínfima cuantía.',
    legal: 'Art. 111 Reglamento (mínimo 3 días hábiles para adjudicación)',
    logic: 'días_hábiles(published_date, award_date) < 3 AND NO es ínfima por monto. CORREGIDO EL 11-AGO-2026: hasta esa fecha la exclusión de ínfima cuantía se evaluaba por el TEXTO del procedimiento, y ese texto no dice "ínfima" en ningún proceso del conjunto de datos, así que la exclusión que esta metodología prometía no descartaba nada: 525 de los 2.237 disparos (23,5%) eran compras por debajo del umbral de su fecha, marcadas por ser rápidas cuando su rapidez es justamente lo esperable en una ínfima cuantía. Ahora la exclusión se evalúa POR MONTO, el mismo criterio que usan las banderas CC-*' },
  { code: 'IP-01', category: 'precio', severity: 2, ocp: 'R011', name: 'Valor Cercano al Umbral',
    desc: 'El monto está entre 85% y 100% del umbral de ínfima cuantía, posible fraccionamiento.',
    legal: 'Art. 50 LOSNCP reformada (prohibición de subdividir)',
    logic: 'valor > 0 AND valor >= umbral_ínfima(fecha) * 0,85 AND valor <= umbral_ínfima(fecha)' },
  { code: 'IP-02', category: 'precio', severity: 2, ocp: 'R031', name: 'Adjudicación Sobre el Presupuesto Referencial',
    desc: 'El monto adjudicado SUPERA en más del 15% el presupuesto referencial. Adjudicar por debajo del referencial NO activa este indicador: es el resultado esperable de la competencia y no una señal de riesgo. En los datos del SERCOP el exceso sobre el referencial es casi inexistente, así que este indicador dispara muy poco por diseño.',
    legal: 'Principio de mejor valor por dinero, Art. 6 LOSNCP',
    logic: 'budget_amount > 0 AND award_amount > 0 AND (award_amount − budget_amount) / budget_amount > 0,15. CORREGIDO EL 11-AGO-2026: hasta esa fecha se usaba el VALOR ABSOLUTO de la diferencia, así que el indicador marcaba también las adjudicaciones por debajo del referencial. Medido sobre 2024: de los 1.704 procesos marcados, cero tenían el adjudicado por encima del presupuesto y los 1.704 estaban por debajo, es decir que el indicador señalaba a entidades que adjudicaron por menos de lo presupuestado. Aquellos disparos eran falsos positivos y desaparecen con la corrección' },
  { code: 'IP-03', category: 'precio', severity: 3, ocp: 'R069', name: 'Modificación Contractual Significativa',
    desc: 'El contrato recibió enmiendas que incrementan su valor más del 15%. Requiere datos de enmiendas que el OCDS de búsqueda de SERCOP no provee hoy, por lo que aún no registra casos.',
    legal: 'CGE Ecuador ha identificado este patrón como riesgo en auditorías',
    logic: 'has_amendments AND (contract_amount − award_amount) / award_amount > 0,15 (o el mismo cálculo con final_amount) — INACTIVA: el OCDS de SERCOP no publica enmiendas, por lo que no registra ningún caso' },
  { code: 'CC-01', category: 'concentracion', severity: 3, ocp: '', name: 'Proveedor Recurrente en Ínfima Cuantía',
    desc: 'Mismo proveedor gana 5+ ínfimas cuantías (detectadas por monto bajo el umbral anual, fuera de catálogo) del mismo comprador en un año.',
    legal: 'Art. 50 LOSNCP — prohibición de "contratación constante y recurrente". Art. 270 Reglamento — regla de agregación anual',
    logic: 'NO es catálogo electrónico AND ínfima_por_monto(proceso) AND ínfimas(comprador, proveedor, AÑO DEL PROCESO) >= 5' },
  { code: 'CC-02', category: 'concentracion', severity: 3, ocp: 'R050', name: 'Proveedor Dominante',
    desc: 'Un proveedor concentra más del 40% del gasto de un comprador en el año del proceso, en compradores con al menos 10 procesos ese mismo año (el piso evita falsos positivos en compradores muy pequeños). El porcentaje que muestra la bandera es siempre el del año del proceso, y el detalle lo nombra. No aplica a catálogo electrónico.',
    legal: 'Principio de concurrencia Art. 6 LOSNCP',
    logic: 'NO es catálogo electrónico AND share_of_buyer(comprador, proveedor, AÑO DEL PROCESO) > 40 AND procesos_del_comprador(AÑO DEL PROCESO) >= 10' },
  { code: 'CC-03', category: 'concentracion', severity: 2, ocp: '', name: 'Proveedor Histórico Permanente',
    desc: 'Un proveedor gana contratos del mismo comprador en 5 o más años distintos del período cubierto (2019 en adelante), con un monto total superior a $50,000. No hay una ventana de "últimos 7 años": se cuentan los años distintos en que contrataron juntos. No aplica a catálogo electrónico.',
    legal: 'Patrón de riesgo reconocido por OCP y OECD',
    logic: 'NO es catálogo electrónico AND años_distintos_con_ese_comprador >= 5 AND monto_acumulado_del_período > 50.000' },
  { code: 'CC-04', category: 'concentracion', severity: 2, ocp: '', name: 'Miembro Recurrente de Consorcio',
    desc: 'Un proveedor participa en 2+ procesos-consorcio con el mismo comprador (umbral bajado por la baja frecuencia de consorcios en los datos de SERCOP). No aplica a catálogo electrónico.',
    legal: 'Art. 25 LOSNCP reformada regula consorcios',
    logic: 'NO es catálogo electrónico AND el proceso tiene 2+ proveedores AND procesos_consorcio(comprador, proveedor) >= 2 — el conteo de procesos-consorcio también excluye el catálogo electrónico' },
  { code: 'CC-05', category: 'concentracion', severity: 3, ocp: 'R055', name: 'Posible Fraccionamiento',
    desc: '2+ ínfimas cuantías al mismo proveedor de un comprador cuya suma anual supera el umbral de ínfima cuantía. No aplica a catálogo electrónico.',
    legal: 'Art. 50 LOSNCP (prohibición subdivisión); Art. 270 Reglamento (regla agregación anual); Disposición General Tercera LOSNCP',
    logic: 'NO es catálogo electrónico AND ínfimas(comprador, proveedor, AÑO DEL PROCESO) >= 2 AND suma_de_ínfimas_de_ese_año > umbral_ínfima(fecha del proceso)' },
  { code: 'TR-01', category: 'transparencia', severity: 1, ocp: '', name: 'Información Incompleta Crítica',
    desc: 'Faltan campos esenciales: comprador, valor, proveedor o método de contratación.',
    legal: 'Art. 17 Reglamento (obligación publicar en Portal)',
    logic: 'falta buyer_id OR falta valor OR no hay proveedores OR no hay ni procurement_method ni procurement_method_details' },
  { code: 'TR-02', category: 'transparencia', severity: 0, ocp: '', name: 'Descripción Genérica',
    desc: 'La descripción del proceso tiene entre 1 y 29 caracteres.',
    legal: 'Principio de transparencia Art. 6 LOSNCP',
    logic: '0 < longitud(description o title) < 30 — una descripción completamente vacía no dispara TR-02, porque la condición > 0 lo impide. Tampoco la dispara TR-01: TR-01 no evalúa la descripción, solo la ausencia de comprador, valor, proveedor o método' },
  { code: 'TR-03', category: 'transparencia', severity: 2, ocp: '', name: 'Sin Justificación Régimen Especial',
    desc: 'Proceso de régimen especial, emergente o contratación directa, por un monto superior al umbral de ínfima cuantía, sin justificación documentada en los datos OCDS.',
    legal: 'Art. 38 LOSNCP reformada; Art. 116 Reglamento',
    logic: '(texto_procedimiento contiene "especial", "emergent", "contratación directa" o "contratacion directa" sin tilde OR el identificador interno empieza por "OCDS-5WNO2W-RE-" OR el OCID contiene "-RE-") AND valor > umbral_ínfima(fecha). Las dos últimas condiciones son la misma en la práctica, porque el identificador interno se toma del OCID cuando existe, pero el motor las evalúa por separado y aquí se declaran las dos' },
];

const WEIGHTS: Record<number, number> = { 0: 3, 1: 8, 2: 18, 3: 30 };

export default function Methodology() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [presupuesto, setPresupuesto] = useState<EstadoPresupuesto | null>(null);

  // Si la llamada falla no se inventa ninguna cifra: la sección se redacta sin números. El pie
  // de página ya publicó una vez una cobertura clavada como valor de reserva y eso fue un dato
  // falso servido como si fuera real.
  useEffect(() => {
    fetch('/api/version')
      .then(r => r.json())
      .then(v => { if (v?.presupuesto) setPresupuesto(v.presupuesto); })
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1>Metodología OICP</h1>
        <p className="text-gray-500 mt-1">
          15 indicadores de riesgo calibrados para la contratación pública ecuatoriana,
          basados en <a href="https://www.open-contracting.org/wp-content/uploads/2024/12/OCP2024-RedFlagProcurement-1.pdf"
          target="_blank" rel="noopener" className="text-brand-600 underline">Red flags in public procurement (Open
          Contracting Partnership, 2024)</a> y la LOSNCP reformada (7 octubre 2025).
        </p>
      </div>

      {/* Cómo se cuentan los días hábiles: se publicaba como una función sin definir en
          IT-01 e IT-02, y su implementación tiene dos particularidades que cambian el
          resultado. Un auditor tiene derecho a saberlas para reproducir el indicador. */}
      <div className="bg-white rounded-xl border p-6 shadow-sm">
        <h2 className="font-semibold mb-3">Cómo se cuentan los días hábiles</h2>
        <div className="text-sm text-gray-600 space-y-2">
          <p>
            Los indicadores IT-01 e IT-02 usan una cuenta de días hábiles que excluye sábados y
            domingos e <strong>incluye ambos extremos del intervalo</strong>: si la publicación y la
            adjudicación caen el mismo día laborable, el resultado es 1 y no 0. Por eso la condición
            «menos de 3 días hábiles» de IT-02 equivale, en la práctica, a menos de dos días
            transcurridos.
          </p>
          <p>
            <strong>Los feriados sí se descuentan desde el 11 de agosto de 2026.</strong> El
            calendario es el del <strong>Art. 65 del Código del Trabajo</strong> (Codificación 17,
            R.O. Suplemento 167 de 16 dic 2005, reformado por la Ley de R.O. Suplemento 906 de 20
            dic 2016), verificado sobre el texto vigente: 1 de enero, viernes santo, 1 y 24 de mayo,
            10 de agosto, 9 de octubre, 2 y 3 de noviembre, 25 de diciembre, y los lunes y martes de
            carnaval. Las tres fiestas móviles se calculan desde el domingo de Pascua. Se aplican
            las reglas de traslado del mismo artículo: si cae martes pasa al lunes anterior, si cae
            miércoles o jueves pasa al viernes de esa semana, y si cae sábado o domingo pasa al
            viernes anterior o al lunes posterior; quedan exceptuados del primer traslado el 1 de
            enero, el 25 de diciembre y el martes de carnaval. El descanso <em>se traslada</em>, no
            se duplica: la fecha original deja de contar como feriado.
          </p>
          <p className="text-xs text-gray-500">
            Dos advertencias honestas sobre ese calendario. Primera: el <strong>decreto ejecutivo
            anual</strong> de feriados puede apartarse del Código en un año concreto, sobre todo
            al armar puentes; lo que aquí se aplica es la regla del Código, no el decreto de cada
            año. Segunda: la excepción del 1 de enero, el 25 de diciembre y el martes de carnaval
            está redactada dentro del párrafo del martes, miércoles y jueves, así que aquí
            <strong> no</strong> se extiende al traslado de sábados y domingos; es una lectura, y
            se declara como tal.
          </p>
          <p>
            <strong>Corregido el 11 de agosto de 2026:</strong> hasta esa fecha la cuenta se hacía
            sobre las fechas con su hora, así que el resultado dependía de la hora del día y no del
            calendario. Medido sobre producción: de los procesos con exactamente <strong>un día
            calendario</strong> entre publicación y adjudicación, 311 reportaban «1 día hábil» y 460
            reportaban «2». Ahora la cuenta se hace sobre la fecha calendario y es independiente de
            la zona horaria, así que el mismo intervalo da siempre el mismo número.
          </p>
          {/* Este párrafo decía «aquí se cuenta el día inicial Y NO SE DESCUENTAN FERIADOS» y
              contradecía, tres párrafos más arriba y en la misma página, la corrección del
              11-ago-2026 que sí los descuenta. Publicar dos versiones opuestas de la misma regla
              es peor que publicar la incompleta: quien la cite no sabe cuál rige (regla 10). */}
          <p>
            <strong>Lo que este conteo todavía NO es:</strong> el término legal. El Código Orgánico
            Administrativo dispone en su Art. 158 que los términos corren «a partir del día hábil
            siguiente», y en su Art. 159 que se excluyen los feriados.{' '}
            <strong>La segunda condición ya se cumple</strong> desde el 11 de agosto de 2026, con el
            calendario del Art. 65 descrito arriba. <strong>La primera no:</strong> aquí se cuenta el
            día inicial, así que estos dos indicadores miden un intervalo de días laborables y no un
            término administrativo, y sobreestiman el término en un día. No se cambió porque mueve el
            significado de los mínimos de IT-01 (9/13/17), que están pendientes de una decisión sobre
            a qué tramo del procedimiento corresponden y desde qué fecha aplican; las dos cosas se
            resuelven juntas o el indicador queda a medio camino. Se declara aquí en vez de
            esconderse: <strong>al citar IT-01 o IT-02 conviene verificar las fechas en el portal
            oficial</strong>.
          </p>
        </div>
      </div>

      {/* Scoring System */}
      <div className="bg-white rounded-xl border p-6 shadow-sm">
        <h2 className="font-semibold mb-4">Sistema de Puntuación</h2>
        <p className="text-sm text-gray-600 mb-4">
          Cada bandera activa suma puntos según su severidad. El score total va de 0 a 100.
          En banderas correlacionadas (IC-02 + TR-03, CC-01 + CC-05, IP-01 + CC-05) la segunda pondera al 50% para evitar doble conteo.
        </p>
        <p className="text-xs text-gray-500 mb-4">
          <strong>Los pares se replantearon el 11 de agosto de 2026, midiendo.</strong> Hasta esa
          fecha la lista declaraba el par IC-01 + IC-02, que tiene <strong>cero</strong>
          co-ocurrencias en los ocho años y no puede tenerlas: IC-01 exige un método competitivo e
          IC-02 exige contratación directa, así que son excluyentes por construcción y el descuento
          publicado nunca se aplicaba. En cambio faltaba el par que sí importa:{' '}
          <strong>IC-02 + TR-03 co-ocurre en 42.321 de los 44.064 disparos de IC-02, el 96,0%</strong>.
          Los dos exigen que el monto supere el umbral de ínfima y los dos se activan con la
          contratación directa o el régimen especial: era una sola observación cobrada dos veces,
          30 + 18 = 48 de los 100 puntos posibles, sin ningún descuento.
        </p>
        <div className="grid grid-cols-4 gap-4 mb-4">
          {[0, 1, 2, 3].map(sev => {
            const s = SEVERITY_LABELS[sev];
            return (
              <div key={sev} className={`text-center p-3 rounded-lg ${s.bg}`}>
                <div className={`text-lg font-bold ${s.color}`}>+{WEIGHTS[sev]}</div>
                <div className={`text-xs ${s.color}`}>{s.label}</div>
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-4 gap-2 text-center text-xs">
          <div className="bg-green-50 p-2 rounded"><strong>0-10</strong><br />Bajo</div>
          <div className="bg-yellow-50 p-2 rounded"><strong>11-30</strong><br />Moderado</div>
          <div className="bg-orange-50 p-2 rounded"><strong>31-60</strong><br />Alto</div>
          <div className="bg-red-50 p-2 rounded"><strong>61-100</strong><br />Crítico</div>
        </div>
      </div>

      {/* Legal Context */}
      <div className="bg-white rounded-xl border p-6 shadow-sm">
        <h2 className="font-semibold mb-4">Marco Normativo</h2>
        <p className="text-sm text-gray-600 mb-3">
          Los umbrales e indicadores se adaptan automáticamente según la fecha del proceso:
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-gray-500">
              <th className="pb-2 font-medium">Período</th>
              <th className="pb-2 font-medium">Régimen</th>
              <th className="pb-2 font-medium">Ínfima Cuantía</th>
            </tr></thead>
            <tbody className="text-gray-700">
              <tr className="border-b"><td className="py-2">2019 — 6 jul 2025</td><td>LOSNCP, coeficiente × PIE (umbral por año)</td><td>2019: $7.105,88 · 2020: $7.099,68 · 2021: $6.416,07 · 2022: $6.779,95 · 2023: $6.300,57 · 2024: $6.658,78 · 2025 hasta el 6 jul: $7.212,60</td></tr>
              <tr className="border-b"><td className="py-2">7 jul — 6 oct 2025</td><td>Ley Orgánica de Integridad Pública, aplicada por la Resolución R.E-SERCOP-2025-0152</td><td>$10.000,00 (fijo)</td></tr>
              <tr className="border-b"><td className="py-2">7 oct 2025 en adelante</td><td>LOSNCP reformada, Art. 50 (R.O. 4S No. 140)</td><td>$10.000,00 (fijo)</td></tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400 mt-3">
          Fuentes: SERCOP, LOSNCP reformada R.O. Cuarto Suplemento No. 140 (7 oct 2025), Reglamento D.E. 193 (28 oct 2025).
          Los montos de 2019-2024 fueron verificados contra PDFs oficiales de SERCOP.
        </p>
        <p className="text-xs text-gray-500 mt-2">
          <strong>2025 tiene tres tramos, no dos.</strong> El salto a USD 10.000 ocurrió el <strong>7 de julio</strong> de
          2025 y no el 7 de octubre: la Resolución R.E-SERCOP-2025-0152 (R.O. Quinto Suplemento No. 69, 27 jun 2025)
          dispuso en su numeral 4 que «las contrataciones de ínfima cuantía que superen el monto de siete mil doscientos
          doce dólares con sesenta centavos (7.212,60 USD) hasta el monto de diez mil dólares (10.000,00 USD) podrán
          realizarse a partir del 07 de julio de 2025». La reforma de la LOSNCP del 7 de octubre fijó el mismo monto en
          el Art. 50, esta vez con rango de ley. Hasta el 11 de agosto de 2026 la plataforma situaba el corte en octubre
          y evaluaba con el umbral equivocado los tres meses intermedios.
        </p>
        <p className="text-xs text-gray-500 mt-2">
          <strong>Zona gris declarada:</strong> la Corte Constitucional declaró inconstitucional la Ley Orgánica de
          Integridad Pública en la sentencia 52-25-IN/25, publicada el 3 de octubre de 2025, con efectos hacia el futuro.
          Entre el 3 y el 6 de octubre de 2025 el umbral aplicable es jurídicamente discutible y no hay pronunciamiento
          del SERCOP que lo resuelva. La plataforma mantiene USD 10.000 en esa ventana por continuidad con el tramo
          anterior, y lo declara aquí en vez de esconderlo.
        </p>
      </div>

      {/* Política de citas a la guía de la OCP. Se publica porque un auditor comprueba una cita
          en treinta segundos, y una cita falsa pone en duda todo lo demás. */}
      <div className="bg-white rounded-xl border p-6 shadow-sm">
        <h2 className="font-semibold mb-3">Cómo se citan las banderas de la OCP</h2>
        <div className="text-sm text-gray-600 space-y-2">
          <p>
            El código <strong>R0xx</strong> que acompaña a una bandera solo aparece cuando el
            indicador implementa de verdad lo que ese código mide en la guía. Los indicadores sin
            código no tienen equivalente en la guía y se declaran así en vez de citar algo parecido.
          </p>
          <p>
            El <strong>11 de agosto de 2026</strong> se revisaron las 13 citas que había, una por
            una, contra el PDF oficial de la edición 2024. Tres eran correctas (IC-01/R018,
            IT-01/R003, IP-03/R069). Tres apuntaban a un código equivocado y se corrigieron:
            <strong> IP-02</strong> citaba R059, que compara el adjudicado contra el contrato final,
            cuando el indicador compara el adjudicado contra el presupuesto referencial, que es
            R031; <strong>CC-02</strong> citaba R051, que es concentración de mercado por índice
            Herfindahl-Hirschman, cuando mide la cuota de un proveedor sobre un comprador, que es
            R050; y <strong>CC-05</strong> citaba R011 cuando la fórmula que implementa, sumar las
            ínfimas del par y comparar la suma contra el umbral, es literalmente la de R055.
          </p>
          <p>
            Cinco citas se <strong>retiraron</strong> por no tener equivalente: IC-02 (R055 exige
            sumar varias adjudicaciones directas del mismo par, no evaluar un proceso aislado),
            CC-04 (R070 es la contratación de oferentes perdedores como subcontratistas, un dato que
            el SERCOP no publica), TR-01 (R001 es la ausencia de documentos de planificación),
            TR-02 (R013 es la proporción de métodos no competitivos de un comprador) y TR-03 (R039
            son preguntas de oferentes sin responder).
          </p>
          <p>
            Dos se conservan como <strong>adaptaciones declaradas</strong>, porque el parentesco es
            real pero no exacto: <strong>IT-02 / R061</strong>, donde la guía mide el intervalo
            entre el cierre de ofertas y la adjudicación y aquí se mide desde la publicación,
            porque es el par de fechas que publica el SERCOP; y <strong>IP-01 / R011</strong>, donde
            la guía agrupa dos o más procesos del mismo comprador y categoría y aquí se evalúa la
            cercanía al umbral de un proceso individual. La agregación que pide R011 la hace CC-05.
          </p>
        </div>
      </div>

      {/* All Flags */}
      <div>
        <h2 className="font-semibold mb-4">Catálogo de 15 Banderas</h2>
        <div className="space-y-3">
          {FLAGS.map(flag => {
            const sev = SEVERITY_LABELS[flag.severity];
            const cat = FLAG_CATEGORIES[flag.category];
            const isOpen = expanded === flag.code;
            return (
              <div key={flag.code} className="bg-white rounded-lg border shadow-sm overflow-hidden">
                <button onClick={() => setExpanded(isOpen ? null : flag.code)}
                  className="w-full text-left p-4 flex items-center gap-3 hover:bg-gray-50 transition">
                  <span className={`font-mono text-sm font-bold ${sev.color} w-12`}>{flag.code}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${sev.bg} ${sev.color}`}>{sev.label}</span>
                  <span className="flex-1 font-medium text-sm">{flag.name}</span>
                  <span className="text-xs text-gray-400">{cat?.label}</span>
                  <span className="text-gray-400">{isOpen ? '▲' : '▼'}</span>
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 border-t bg-gray-50 space-y-2 text-sm">
                    <p className="text-gray-700">{flag.desc}</p>
                    <div className="grid sm:grid-cols-2 gap-2 text-xs">
                      <div><strong>Base normativa:</strong> {flag.legal}</div>
                      <div><strong>Ref. OCP:</strong> {flag.ocp || 'N/A'}</div>
                      <div className="sm:col-span-2"><strong>Lógica:</strong> <code className="bg-white px-1 rounded">{flag.logic}</code></div>
                      <div><strong>Peso:</strong> +{WEIGHTS[flag.severity]} puntos</div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Calidad del dato de origen. Se publica porque condiciona qué puede y qué no puede
          medir la plataforma, y un auditor lo va a encontrar de todos modos. */}
      <div className="bg-white rounded-xl border p-6 shadow-sm">
        <h2 className="font-semibold mb-3">Qué no se puede medir con estos datos</h2>
        <div className="text-sm text-gray-600 space-y-2">
          {/* Las cifras NO van escritas a mano. El rellenado desde la fuente las mueve cada hora,
              así que un número clavado aquí sería una afirmación falsa publicada a las pocas horas.
              Salen medidas de /api/version, la misma medición que usa el MCP (regla 4 y regla 11). */}
          <p>
            <strong>
              {presupuesto && presupuesto.pendientes > 0
                ? `El presupuesto referencial falta todavía en ${fmt(presupuesto.pendientes)} procesos (${pct(presupuesto.pendientes, presupuesto.total)} del total), y es un defecto nuestro, no de la fuente.`
                : 'El presupuesto referencial ya se releyó de la fuente en todo el corpus.'}
            </strong>{' '}
            En esas filas quedó guardada la palabra «USD» en el campo del monto en vez de la cifra.
            La causa, encontrada el 11 de agosto de 2026: la ingesta leía el presupuesto de{' '}
            <code>tender.value</code>, que en estos procesos el SERCOP publica vacío, cuando el
            monto vive en <code>tender.lots[].value</code>. Se llegó a concluir que el dato era
            irrecuperable y era falso: la fuente sí lo publica. Comprobado contra la API del
            SERCOP en cinco procesos de esa bolsa, con montos entre $16.812,60 y $536.037,63.
          </p>
          <p>
            La lectura ya está corregida, así que todo proceso que se incorpore o se actualice
            desde ahora trae su presupuesto.{' '}
            {presupuesto && presupuesto.pendientes > 0 ? (
              <>
                <strong>El rellenado de los anteriores está en curso</strong>, releyéndolos de la
                fuente contra una API con límite de peticiones; la cifra de arriba se mide al
                cargar esta página, así que baja sola. Mientras tanto, los indicadores que dependen
                del referencial, sobre todo <strong>IP-02</strong>, no pueden evaluar esos procesos.
              </>
            ) : (
              <>
                El rellenado terminó.{' '}
                {presupuesto ? (
                  <>
                    Quedan <strong>{fmt(presupuesto.sin_dato)} procesos</strong> (
                    {pct(presupuesto.sin_dato, presupuesto.total)}) sin presupuesto porque el SERCOP
                    no lo publica para ellos, sobre todo de régimen especial.
                  </>
                ) : null}
              </>
            )}{' '}
            Donde falta también el monto adjudicado, lo que marca la plataforma es TR-01
            (información incompleta), que es lo correcto.
          </p>
          <p>
            <strong>El SERCOP no publica enmiendas contractuales</strong> en el OCDS de búsqueda, así
            que IP-03 no registra ningún caso y se declara inactiva.
          </p>
          <p>
            <strong>Los días hábiles todavía no son el término legal.</strong> Desde el 11 de agosto
            de 2026 sí descuentan los feriados del Art. 65 del Código del Trabajo, pero el cómputo
            sigue incluyendo el día inicial, mientras que el COA Art. 158 manda contar «a partir del
            día hábil siguiente». No se cambió porque mueve el significado de los mínimos de IT-01
            (9/13/17), que están pendientes de una decisión sobre a qué tramo del procedimiento
            corresponden y desde qué fecha aplican. Las dos cosas se resuelven juntas.
          </p>
          <p>
            <strong>IP-02 dispara muy poco y eso es el resultado, no un fallo.</strong> Tras la
            corrección del 11 de agosto de 2026 quedan 5 procesos marcados en todo el período
            2019-2026: son los únicos donde el Estado adjudicó por encima del referencial en más del
            15%. Se declara aquí en vez de rellenar el indicador con falsos positivos para que
            «dispare».
          </p>
          <p>
            <strong>La concentración se mide por unidad de compra, no por institución.</strong> Las
            banderas CC-01, CC-02 y CC-05 evalúan la concentración sobre cada comprador
            (<code>buyer_id</code>), que corresponde a la unidad de compra que decide la
            contratación; el mismo RUC institucional puede aparecer como varias unidades de compra
            distintas. La dominancia a nivel de institución (RUC consolidado) no se evalúa como
            bandera: un proveedor repartido entre muchas unidades de la misma institución puede no
            disparar CC-02 aunque concentre mucho a nivel institucional. Se declara como
            limitación, y desde el 13 de agosto de 2026 el perfil de cada comprador publica como
            contexto cuántas unidades de compra tiene su RUC y el total institucional consolidado,
            sin afectar banderas ni scores.
          </p>
        </div>
      </div>

      {/* Disclaimer */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
        <h2 className="font-semibold text-amber-800 mb-2">Aviso Importante</h2>
        <ul className="text-sm text-amber-700 space-y-1">
          <li>Los indicadores son señales analíticas, <strong>NO</strong> evidencia de corrupción.</li>
          <li>Los datos provienen del estándar OCDS publicado por SERCOP y pueden contener errores o estar desactualizados.</li>
          <li>Los umbrales legales se actualizan anualmente y pueden no reflejar cambios recientes.</li>
          <li>Para información oficial, consulte directamente el <a href="https://portal.compraspublicas.gob.ec" target="_blank" rel="noopener" className="underline">Portal de SERCOP</a>.</li>
          <li>Este sistema NO es una herramienta oficial del gobierno ecuatoriano.</li>
        </ul>
      </div>

      {/* References */}
      <div className="bg-white rounded-xl border p-6 shadow-sm">
        <h2 className="font-semibold mb-4">Referencias</h2>
        <div className="text-sm text-gray-600 space-y-1">
          <p>1. SERCOP — Montos de Contratación Pública 2019-2026</p>
          <p>2. LOSNCP Reformada — R.O. Cuarto Suplemento No. 140, 7 octubre 2025</p>
          <p>3. Reglamento General D.E. 193 — R.O. Noveno Suplemento No. 153, 28 octubre 2025</p>
          <p>4. Red flags in public procurement: a guide to using data to detect and mitigate risks — Open Contracting Partnership, 2024. (El título «Red Flags for Integrity Guide» corresponde a la edición de 2016, no a esta.)</p>
          <p>5. Cardinal — github.com/open-contracting/cardinal-rs</p>
          <p>6. Sentencia CC 52-25-IN/25 — Inconstitucionalidad LOIP</p>
          <p>7. Resolución RE-SERCOP-2025-0154 — Lineamientos de transición</p>
        </div>
      </div>
    </div>
  );
}
