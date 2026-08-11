import { useState } from 'react';
import { SEVERITY_LABELS, FLAG_CATEGORIES } from '../lib/flags';

const FLAGS = [
  { code: 'IC-01', category: 'competencia', severity: 2, ocp: 'R018', name: 'Proveedor Único en Proceso Competitivo',
    desc: 'Solo un oferente participó en un proceso que debería ser competitivo.',
    legal: 'Principio de concurrencia, Art. 6 LOSNCP reformada',
    logic: 'es_competitivo(procurement_method_details) AND number_of_tenderers == 1 — es_competitivo = el texto del procedimiento contiene "licitac", "subasta", "cotizac", "concurso" o "menor cuantía"' },
  { code: 'IC-02', category: 'competencia', severity: 3, ocp: 'R055', name: 'Alto Valor Sin Competencia',
    desc: 'Adjudicación directa o ínfima cuantía por monto superior al umbral permitido.',
    legal: 'Art. 50 LOSNCP reformada; umbrales SERCOP por año',
    logic: '(texto_procedimiento contiene "ínfima" OR procurement_method == "direct") AND valor > umbral_ínfima(fecha) — valor = award_amount, o budget_amount si no hay adjudicado' },
  { code: 'IT-01', category: 'tiempo', severity: 1, ocp: 'R003', name: 'Plazo de Publicación Insuficiente',
    desc: 'El período entre publicación y cierre de ofertas es menor al mínimo legal.',
    legal: 'Arts. 91, 96, 111 Reglamento D.E. 193',
    logic: 'valor > 10.000 AND días_hábiles(published_date, submission_deadline) < mínimo — mínimo = 9 días; 13 si valor > 100.000; 17 si valor > 500.000' },
  { code: 'IT-02', category: 'tiempo', severity: 2, ocp: 'R061', name: 'Adjudicación Relámpago',
    desc: 'La adjudicación ocurrió en menos de 3 días hábiles desde la publicación. No aplica a ínfima cuantía.',
    legal: 'Art. 111 Reglamento (mínimo 3 días hábiles para adjudicación)',
    logic: 'días_hábiles(published_date, award_date) < 3 AND el procedimiento NO es ínfima cuantía' },
  { code: 'IP-01', category: 'precio', severity: 2, ocp: 'R011', name: 'Valor Cercano al Umbral',
    desc: 'El monto está entre 85% y 100% del umbral de ínfima cuantía, posible fraccionamiento.',
    legal: 'Art. 50 LOSNCP reformada (prohibición de subdividir)',
    logic: 'valor > 0 AND valor >= umbral_ínfima(fecha) * 0,85 AND valor <= umbral_ínfima(fecha)' },
  { code: 'IP-02', category: 'precio', severity: 2, ocp: 'R059', name: 'Diferencia Presupuesto vs Adjudicación',
    desc: 'El monto adjudicado difiere más de 15% respecto al presupuesto referencial.',
    legal: 'Principio de mejor valor por dinero, Art. 6 LOSNCP',
    logic: 'budget_amount > 0 AND |award_amount − budget_amount| / budget_amount > 0,15' },
  { code: 'IP-03', category: 'precio', severity: 3, ocp: 'R069', name: 'Modificación Contractual Significativa',
    desc: 'El contrato recibió enmiendas que incrementan su valor más del 15%. Requiere datos de enmiendas que el OCDS de búsqueda de SERCOP no provee hoy, por lo que aún no registra casos.',
    legal: 'CGE Ecuador ha identificado este patrón como riesgo en auditorías',
    logic: 'has_amendments AND (contract_amount − award_amount) / award_amount > 0,15 (o el mismo cálculo con final_amount) — INACTIVA: el OCDS de SERCOP no publica enmiendas, por lo que no registra ningún caso' },
  { code: 'CC-01', category: 'concentracion', severity: 3, ocp: '', name: 'Proveedor Recurrente en Ínfima Cuantía',
    desc: 'Mismo proveedor gana 5+ ínfimas cuantías (detectadas por monto bajo el umbral anual, fuera de catálogo) del mismo comprador en un año.',
    legal: 'Art. 50 LOSNCP — prohibición de "contratación constante y recurrente". Art. 270 Reglamento — regla de agregación anual',
    logic: 'NO es catálogo electrónico AND ínfima_por_monto(proceso) AND ínfimas(comprador, proveedor, año) >= 5' },
  { code: 'CC-02', category: 'concentracion', severity: 3, ocp: 'R051', name: 'Proveedor Dominante',
    desc: 'Un proveedor concentra más del 40% del gasto de un comprador en el año del proceso, en compradores con al menos 10 procesos ese mismo año (el piso evita falsos positivos en compradores muy pequeños). El porcentaje que muestra la bandera es siempre el del año del proceso, y el detalle lo nombra. No aplica a catálogo electrónico.',
    legal: 'Principio de concurrencia Art. 6 LOSNCP',
    logic: 'NO es catálogo electrónico AND share_of_buyer > 40 AND procesos_del_comprador >= 10' },
  { code: 'CC-03', category: 'concentracion', severity: 2, ocp: '', name: 'Proveedor Histórico Permanente',
    desc: 'Un proveedor gana contratos del mismo comprador en 5 o más años distintos del período cubierto (2019 en adelante), con un monto total superior a $50,000. No hay una ventana de "últimos 7 años": se cuentan los años distintos en que contrataron juntos. No aplica a catálogo electrónico.',
    legal: 'Patrón de riesgo reconocido por OCP y OECD',
    logic: 'NO es catálogo electrónico AND años_con_ese_comprador >= 5 (de los últimos 7) AND monto_acumulado > 50.000' },
  { code: 'CC-04', category: 'concentracion', severity: 2, ocp: 'R070', name: 'Miembro Recurrente de Consorcio',
    desc: 'Un proveedor participa en 2+ procesos-consorcio con el mismo comprador (umbral bajado por la baja frecuencia de consorcios en los datos de SERCOP). No aplica a catálogo electrónico.',
    legal: 'Art. 25 LOSNCP reformada regula consorcios',
    logic: 'NO es catálogo electrónico AND el proceso tiene 2+ proveedores AND procesos_consorcio(comprador, proveedor) >= 2' },
  { code: 'CC-05', category: 'concentracion', severity: 3, ocp: 'R011', name: 'Posible Fraccionamiento',
    desc: '2+ ínfimas cuantías al mismo proveedor de un comprador cuya suma anual supera el umbral de ínfima cuantía. No aplica a catálogo electrónico.',
    legal: 'Art. 50 LOSNCP (prohibición subdivisión); Art. 270 Reglamento (regla agregación anual); Disposición General Tercera LOSNCP',
    logic: 'NO es catálogo electrónico AND ínfimas(comprador, proveedor) >= 2 AND suma_de_ínfimas > umbral_ínfima(fecha)' },
  { code: 'TR-01', category: 'transparencia', severity: 1, ocp: 'R001', name: 'Información Incompleta Crítica',
    desc: 'Faltan campos esenciales: comprador, valor, proveedor o método de contratación.',
    legal: 'Art. 17 Reglamento (obligación publicar en Portal)',
    logic: 'falta buyer_id OR falta valor OR no hay proveedores OR no hay ni procurement_method ni procurement_method_details' },
  { code: 'TR-02', category: 'transparencia', severity: 0, ocp: 'R013', name: 'Descripción Genérica',
    desc: 'La descripción del proceso tiene entre 1 y 29 caracteres.',
    legal: 'Principio de transparencia Art. 6 LOSNCP',
    logic: '0 < longitud(description o title) < 30 — una descripción completamente vacía no dispara TR-02, porque la condición > 0 lo impide. Tampoco la dispara TR-01: TR-01 no evalúa la descripción, solo la ausencia de comprador, valor, proveedor o método' },
  { code: 'TR-03', category: 'transparencia', severity: 2, ocp: 'R039', name: 'Sin Justificación Régimen Especial',
    desc: 'Proceso de régimen especial, emergente o contratación directa, por un monto superior al umbral de ínfima cuantía, sin justificación documentada en los datos OCDS.',
    legal: 'Art. 38 LOSNCP reformada; Art. 116 Reglamento',
    logic: '(texto_procedimiento contiene "especial", "emergent" o "contratación directa" OR el OCID contiene "-RE-") AND valor > umbral_ínfima(fecha)' },
];

const WEIGHTS: Record<number, number> = { 0: 3, 1: 8, 2: 18, 3: 30 };

export default function Methodology() {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1>Metodología OICP</h1>
        <p className="text-gray-500 mt-1">
          15 indicadores de riesgo calibrados para la contratación pública ecuatoriana,
          basados en la <a href="https://www.open-contracting.org/resources/red-flags-for-integrity-guide/"
          target="_blank" rel="noopener" className="text-brand-600 underline">Guía de Red Flags OCP 2024</a> y
          la LOSNCP reformada (7 octubre 2025).
        </p>
      </div>

      {/* Scoring System */}
      <div className="bg-white rounded-xl border p-6 shadow-sm">
        <h2 className="font-semibold mb-4">Sistema de Puntuación</h2>
        <p className="text-sm text-gray-600 mb-4">
          Cada bandera activa suma puntos según su severidad. El score total va de 0 a 100.
          En banderas correlacionadas (IC-01 + IC-02, CC-01 + CC-05, IP-01 + CC-05) la segunda pondera al 50% para evitar doble conteo.
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
              <tr className="border-b"><td className="py-2">2019 — 6 oct 2025</td><td>LOSNCP, coeficiente × PIE (umbral por año)</td><td>2019: $7.105,88 · 2020: $7.099,68 · 2021: $6.416,07 · 2022: $6.779,95 · 2023: $6.300,57 · 2024: $6.658,78 · 2025 hasta el 6 oct: $7.212,60</td></tr>
              <tr className="border-b"><td className="py-2">7 oct 2025 en adelante</td><td>LOSNCP reformada (R.O. 4S No. 140)</td><td>$10.000,00 (fijo)</td></tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400 mt-3">
          Fuentes: SERCOP, LOSNCP reformada R.O. CS No. 140 (7 oct 2025), Reglamento D.E. 193 (28 oct 2025).
          Los montos de 2019-2024 fueron verificados contra PDFs oficiales de SERCOP.
        </p>
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
          <p>4. OCP Red Flags for Integrity Guide 2024 — Open Contracting Partnership</p>
          <p>5. Cardinal — github.com/open-contracting/cardinal-rs</p>
          <p>6. Sentencia CC 52-25-IN/25 — Inconstitucionalidad LOIP</p>
          <p>7. Resolución RE-SERCOP-2025-0154 — Lineamientos de transición</p>
        </div>
      </div>
    </div>
  );
}
