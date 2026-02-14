import { useState } from 'react';
import { SEVERITY_LABELS, FLAG_CATEGORIES } from '../lib/flags';

const FLAGS = [
  { code: 'IC-01', category: 'competencia', severity: 2, ocp: 'R018', name: 'Proveedor Único en Proceso Competitivo',
    desc: 'Solo un oferente participó en un proceso que debería ser competitivo.',
    legal: 'Principio de concurrencia, Art. 6 LOSNCP reformada',
    logic: 'tender.procurementMethod == "open" AND numberOfTenderers == 1' },
  { code: 'IC-02', category: 'competencia', severity: 3, ocp: 'R055', name: 'Alto Valor Sin Competencia',
    desc: 'Adjudicación directa o ínfima cuantía por monto superior al umbral permitido.',
    legal: 'Art. 50 LOSNCP reformada; umbrales SERCOP por año',
    logic: 'procurementMethod in ["direct","limited"] AND value > infima_threshold(year)' },
  { code: 'IT-01', category: 'tiempo', severity: 1, ocp: 'R003', name: 'Plazo de Publicación Insuficiente',
    desc: 'El período entre publicación y cierre de ofertas es menor al mínimo legal.',
    legal: 'Arts. 91, 96, 111 Reglamento D.E. 193',
    logic: 'business_days(start, end) < mínimo_por_monto_y_procedimiento' },
  { code: 'IT-02', category: 'tiempo', severity: 2, ocp: 'R061', name: 'Adjudicación Relámpago',
    desc: 'La adjudicación ocurrió en menos de 3 días hábiles desde la publicación.',
    legal: 'Art. 111 Reglamento (mínimo 3 días hábiles para adjudicación)',
    logic: 'business_days(published, awarded) < 3' },
  { code: 'IP-01', category: 'precio', severity: 2, ocp: 'R011', name: 'Valor Cercano al Umbral',
    desc: 'El monto está entre 85% y 100% del umbral de ínfima cuantía, posible fraccionamiento.',
    legal: 'Art. 50 LOSNCP reformada (prohibición de subdividir)',
    logic: 'value >= threshold * 0.85 AND value <= threshold' },
  { code: 'IP-02', category: 'precio', severity: 2, ocp: 'R059', name: 'Diferencia Presupuesto vs Adjudicación',
    desc: 'El monto adjudicado difiere más de 15% respecto al presupuesto referencial.',
    legal: 'Principio de mejor valor por dinero, Art. 6 LOSNCP',
    logic: 'abs(award - budget) / budget > 0.15' },
  { code: 'IP-03', category: 'precio', severity: 3, ocp: 'R069', name: 'Modificación Contractual Significativa',
    desc: 'El contrato recibió enmiendas que incrementan su valor más del 15%.',
    legal: 'CGE Ecuador ha identificado este patrón como riesgo en auditorías',
    logic: '(contract_value - award_value) / award_value > 0.15' },
  { code: 'CC-01', category: 'concentracion', severity: 3, ocp: '', name: 'Proveedor Recurrente en Ínfima Cuantía',
    desc: 'Mismo proveedor gana 5+ ínfimas cuantías del mismo comprador en un año fiscal.',
    legal: 'Art. 50 LOSNCP — prohibición de "contratación constante y recurrente". Art. 270 Reglamento — regla de agregación anual',
    logic: 'count(infimas, buyer, supplier, year) >= 5' },
  { code: 'CC-02', category: 'concentracion', severity: 3, ocp: 'R051', name: 'Proveedor Dominante',
    desc: 'Un proveedor recibe más del 30% del gasto total de un comprador en un año.',
    legal: 'Principio de concurrencia Art. 6 LOSNCP',
    logic: 'supplier_value / buyer_total_value > 0.30' },
  { code: 'CC-03', category: 'concentracion', severity: 2, ocp: '', name: 'Proveedor Histórico Permanente',
    desc: 'Un proveedor gana contratos del mismo comprador en 5+ de los últimos 7 años.',
    legal: 'Patrón de riesgo reconocido por OCP y OECD',
    logic: 'distinct_years(supplier, buyer, 7_years) >= 5' },
  { code: 'CC-04', category: 'concentracion', severity: 2, ocp: 'R070', name: 'Miembro Recurrente de Consorcio',
    desc: 'Una persona/empresa aparece en 8+ consorcios diferentes en 3 años.',
    legal: 'Art. 25 LOSNCP reformada regula consorcios',
    logic: 'distinct_consortia(member, 3_years) >= 8' },
  { code: 'CC-05', category: 'concentracion', severity: 3, ocp: 'R011', name: 'Posible Fraccionamiento',
    desc: '3+ contratos con CPC similar del mismo comprador en 90 días cuya suma supera el umbral de ínfima cuantía.',
    legal: 'Art. 50 LOSNCP (prohibición subdivisión); Art. 270 Reglamento (regla agregación anual); Disposición General Tercera LOSNCP',
    logic: 'contracts_same_cpc_90d >= 3 AND sum(values) > infima_threshold' },
  { code: 'TR-01', category: 'transparencia', severity: 1, ocp: 'R001', name: 'Información Incompleta Crítica',
    desc: 'Faltan campos esenciales: comprador, valor, proveedor o método de contratación.',
    legal: 'Art. 17 Reglamento (obligación publicar en Portal)',
    logic: '!buyer_id OR !value OR !suppliers OR !method' },
  { code: 'TR-02', category: 'transparencia', severity: 0, ocp: 'R013', name: 'Descripción Genérica',
    desc: 'La descripción del proceso tiene menos de 30 caracteres.',
    legal: 'Principio de transparencia Art. 6 LOSNCP',
    logic: 'len(description) < 30' },
  { code: 'TR-03', category: 'transparencia', severity: 2, ocp: 'R039', name: 'Sin Justificación Régimen Especial',
    desc: 'Proceso de régimen especial sin justificación documentada en datos OCDS.',
    legal: 'Art. 38 LOSNCP reformada; Art. 116 Reglamento',
    logic: 'method == "selective" AND !rationale' },
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
          Banderas correlacionadas (ej. IC-01 + IC-02) se ponderan al 50% para evitar doble conteo.
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
              <tr className="border-b"><td className="py-2">2019-jun 2025</td><td>LOSNCP coeficientes × PIE</td><td>$6,300 - $7,212 (variable)</td></tr>
              <tr className="border-b"><td className="py-2">7 oct 2025+</td><td>LOSNCP reformada</td><td>$10,000 (fijo)</td></tr>
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
