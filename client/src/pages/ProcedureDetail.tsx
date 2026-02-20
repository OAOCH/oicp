import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Building2, User, AlertTriangle, Info } from 'lucide-react';
import { api } from '../lib/api';
import { ScoreGauge, RiskBadge, FlagCard, Loading } from '../components/UI';
import { formatCurrency, formatDate } from '../lib/flags';

// Generate a human-readable summary of why this procedure was flagged
function generateRiskSummary(proc: any, activeFlags: any[]): string {
  if (activeFlags.length === 0) {
    return 'Este procedimiento no presenta indicadores de riesgo según los criterios evaluados. Esto no garantiza la ausencia de irregularidades — solo indica que los datos disponibles no activaron ninguna de las 15 banderas del sistema.';
  }

  const parts: string[] = [];
  const severityOrder = [...activeFlags].sort((a, b) => b.severity - a.severity);

  for (const flag of severityOrder) {
    switch (flag.code) {
      case 'IC-01':
        parts.push('Se presentó un solo oferente en un proceso competitivo, lo cual reduce la presión de mercado y puede indicar restricciones indebidas en las condiciones de participación.');
        break;
      case 'IC-02':
        parts.push(`El monto adjudicado (${formatCurrency(proc.award_amount)}) supera el umbral de ínfima cuantía, pero se utilizó un método de contratación directa sin competencia abierta.`);
        break;
      case 'IT-01':
        parts.push('El plazo de publicación fue inferior al mínimo legal establecido, lo que pudo limitar la participación de potenciales oferentes.');
        break;
      case 'IT-02':
        parts.push('La adjudicación se realizó en menos de 3 días hábiles desde la publicación, un tiempo inusualmente corto para evaluar ofertas.');
        break;
      case 'IP-01':
        parts.push('El monto se encuentra entre el 85% y 100% del umbral de contratación directa, lo que podría indicar un ajuste deliberado para evitar un proceso competitivo.');
        break;
      case 'IP-02':
        parts.push('Existe una diferencia significativa (mayor al 15%) entre el presupuesto referencial y el monto adjudicado.');
        break;
      case 'IP-03':
        parts.push('El contrato tiene enmiendas que incrementan su valor en más del 15%, lo cual puede indicar una subestimación inicial deliberada.');
        break;
      case 'CC-01':
        parts.push('El proveedor adjudicado ha recibido 5 o más contratos de ínfima cuantía del mismo comprador en el mismo año, un patrón que sugiere posible direccionamiento.');
        break;
      case 'CC-02':
        parts.push('Un solo proveedor concentra más del 30% del valor total de contratos de esta entidad compradora.');
        break;
      case 'CC-03':
        parts.push('El proveedor ha mantenido contratos con la misma entidad durante 5 o más años consecutivos.');
        break;
      case 'CC-04':
        parts.push('Un miembro de consorcio aparece en 8 o más procesos, lo que puede indicar uso de figuras asociativas para evadir controles.');
        break;
      case 'CC-05':
        parts.push('Se detectaron 3 o más contratos del mismo comprador con objetos similares (mismo código CPC) en un período de 90 días, cuya suma supera el umbral de ínfima cuantía. Esto puede constituir fraccionamiento contractual prohibido por el Art. 50 de la LOSNCP.');
        break;
      case 'TR-01':
        parts.push(`Faltan campos críticos en el registro (${flag.detail || 'datos del proveedor, montos u otros'}), lo que dificulta la verificación y el control.`);
        break;
      case 'TR-02':
        parts.push('La descripción del proceso es demasiado genérica (menos de 30 caracteres), lo que limita la trazabilidad del objeto de contratación.');
        break;
      case 'TR-03':
        parts.push('Se utilizó régimen especial sin justificación documentada en los datos públicos.');
        break;
      default:
        parts.push(flag.detail || flag.name || 'Indicador de riesgo detectado.');
    }
  }

  const riskWord = proc.risk_level === 'critical' ? 'crítico' :
    proc.risk_level === 'high' ? 'alto' :
    proc.risk_level === 'moderate' ? 'moderado' : 'bajo';

  const intro = `Este procedimiento tiene un nivel de riesgo ${riskWord} (score ${proc.score}/100) basado en ${activeFlags.length} indicador${activeFlags.length > 1 ? 'es' : ''} detectado${activeFlags.length > 1 ? 's' : ''}:`;

  return intro + '\n\n• ' + parts.join('\n\n• ');
}

export default function ProcedureDetail() {
  const { id } = useParams<{ id: string }>();
  const [proc, setProc] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    api.getProcedure(id).then(setProc).catch(e => setError(e.message));
  }, [id]);

  if (error) return <div className="text-center py-16 text-red-500">{error}</div>;
  if (!proc) return <Loading />;

  const activeFlags = (proc.flags || []).filter((f: any) => f.active);
  const suppliers = proc.suppliers || [];
  const riskSummary = generateRiskSummary(proc, activeFlags);

  return (
    <div className="space-y-6">
      <Link to="/buscar" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-brand-600">
        <ArrowLeft size={16} /> Volver a búsqueda
      </Link>

      {/* Disclaimer */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
        <div className="flex gap-2">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <div>
            <strong>Aviso importante:</strong> Los indicadores presentados son señales analíticas generadas automáticamente a partir de datos públicos OCDS. 
            No constituyen evidencia ni prueba de irregularidad. Los datos pueden contener errores, estar incompletos o desactualizados. 
            Siempre consulte las fuentes oficiales de SERCOP antes de tomar cualquier decisión o emitir cualquier juicio.
          </div>
        </div>
      </div>

      {/* Header */}
      <div className="bg-white rounded-xl border p-6 shadow-sm">
        <div className="flex items-start justify-between gap-6">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <RiskBadge level={proc.risk_level} />
              <span className="text-xs font-mono text-gray-400">{proc.procurement_method_details}</span>
              <span className="text-xs text-gray-400">{proc.regime}</span>
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-1">{proc.title || proc.id}</h1>
            {proc.description && proc.description !== proc.title && (
              <p className="text-sm text-gray-600">{proc.description}</p>
            )}
            <p className="text-xs font-mono text-gray-400 mt-2">OCID: {proc.ocid || proc.id}</p>
          </div>
          <ScoreGauge score={proc.score} size="lg" />
        </div>
      </div>

      {/* Risk Summary */}
      <div className={`rounded-xl border p-5 shadow-sm ${
        proc.risk_level === 'critical' ? 'bg-red-50 border-red-200' :
        proc.risk_level === 'high' ? 'bg-orange-50 border-orange-200' :
        proc.risk_level === 'moderate' ? 'bg-yellow-50 border-yellow-200' :
        'bg-green-50 border-green-200'
      }`}>
        <h2 className="font-semibold mb-3 flex items-center gap-2">
          <Info size={18} />
          Resumen del Análisis
        </h2>
        <div className="text-sm leading-relaxed whitespace-pre-line">
          {riskSummary}
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {/* Left: Details */}
        <div className="md:col-span-2 space-y-6">
          {/* Key Data */}
          <div className="bg-white rounded-xl border p-5 shadow-sm">
            <h2 className="font-semibold mb-4">Datos del Procedimiento</h2>
            <div className="grid sm:grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Presupuesto Referencial</span>
                <p className="font-medium font-mono">{formatCurrency(proc.budget_amount)}</p>
              </div>
              <div>
                <span className="text-gray-500">Monto Adjudicado</span>
                <p className="font-medium font-mono">{formatCurrency(proc.award_amount)}</p>
              </div>
              <div>
                <span className="text-gray-500">Monto Contractual</span>
                <p className="font-medium font-mono">{formatCurrency(proc.contract_amount)}</p>
              </div>
              <div>
                <span className="text-gray-500">Valor Final</span>
                <p className="font-medium font-mono">{formatCurrency(proc.final_amount)}</p>
              </div>
              <div>
                <span className="text-gray-500">Fecha de Publicación</span>
                <p className="font-medium">{formatDate(proc.published_date)}</p>
              </div>
              <div>
                <span className="text-gray-500">Fecha Límite Ofertas</span>
                <p className="font-medium">{formatDate(proc.submission_deadline)}</p>
              </div>
              <div>
                <span className="text-gray-500">Fecha de Adjudicación</span>
                <p className="font-medium">{formatDate(proc.award_date)}</p>
              </div>
              <div>
                <span className="text-gray-500">N° de Oferentes</span>
                <p className="font-medium">{proc.number_of_tenderers ?? '—'}</p>
              </div>
              <div>
                <span className="text-gray-500">Estado</span>
                <p className="font-medium capitalize">{proc.status || '—'}</p>
              </div>
              <div>
                <span className="text-gray-500">Clasificación CPC</span>
                <p className="font-medium">{proc.items_classification || '—'}</p>
              </div>
              <div>
                <span className="text-gray-500">Enmiendas</span>
                <p className="font-medium">{proc.amendment_count || 0}</p>
              </div>
              <div>
                <span className="text-gray-500">Año</span>
                <p className="font-medium">{proc.source_year}</p>
              </div>
            </div>
          </div>

          {/* Flags Detail */}
          {activeFlags.length > 0 && (
            <div className="bg-white rounded-xl border p-5 shadow-sm">
              <h2 className="font-semibold mb-4">
                Detalle de Banderas de Riesgo ({activeFlags.length})
              </h2>
              <div className="space-y-3">
                {activeFlags.map((f: any) => <FlagCard key={f.code} flag={f} />)}
              </div>
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <div className="space-y-6">
          {/* Buyer */}
          <div className="bg-white rounded-xl border p-5 shadow-sm">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <Building2 size={18} className="text-brand-600" /> Comprador
            </h3>
            {proc.buyer_id ? (
              <Link to={`/comprador/${encodeURIComponent(proc.buyer_id)}`} className="text-brand-600 hover:underline text-sm">
                {proc.buyer_name || proc.buyer_id}
              </Link>
            ) : <p className="text-sm text-gray-400">No disponible</p>}
          </div>

          {/* Suppliers */}
          <div className="bg-white rounded-xl border p-5 shadow-sm">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <User size={18} className="text-brand-600" /> Proveedor(es)
            </h3>
            {suppliers.length > 0 ? (
              <div className="space-y-2">
                {suppliers.map((s: any, i: number) => (
                  <Link key={i} to={`/proveedor/${encodeURIComponent(s.id || s.name)}`}
                    className="block text-sm text-brand-600 hover:underline">
                    {s.name || s.id}
                  </Link>
                ))}
              </div>
            ) : <p className="text-sm text-gray-400">No disponible</p>}
          </div>

          {/* Score Breakdown */}
          <div className="bg-white rounded-xl border p-5 shadow-sm">
            <h3 className="font-semibold mb-3">Composición del Score</h3>
            {activeFlags.length > 0 ? (
              <div className="text-sm space-y-1">
                {activeFlags.map((f: any) => {
                  const weights: Record<number, number> = { 0: 3, 1: 8, 2: 18, 3: 30 };
                  return (
                    <div key={f.code} className="flex justify-between">
                      <span className="font-mono text-gray-600">{f.code}</span>
                      <span className="font-medium">+{weights[f.severity]}</span>
                    </div>
                  );
                })}
                <div className="border-t pt-1 mt-2 flex justify-between font-bold">
                  <span>Total</span>
                  <span>{proc.score}/100</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500">Sin banderas activas — score 0/100</p>
            )}
            <p className="text-xs text-gray-400 mt-2">
              Score = suma de pesos por severidad (máx 100). Flags correlacionados ponderados al 50%.
            </p>
          </div>

          {/* Verification Links */}
          <div className="bg-white rounded-xl border p-5 shadow-sm">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <ExternalLink size={18} className="text-brand-600" /> Verificar en Fuente Oficial
            </h3>
            <div className="space-y-3">
              <a href={`https://datosabiertos.compraspublicas.gob.ec/PLATAFORMA/api/record?ocid=${encodeURIComponent(proc.ocid || proc.id || '')}`}
                target="_blank" rel="noopener"
                className="flex items-center gap-2 text-sm text-brand-600 hover:underline bg-blue-50 p-3 rounded-lg">
                <ExternalLink size={14} />
                <div>
                  <div className="font-medium">Ver registro OCDS oficial</div>
                  <div className="text-xs text-gray-500">Datos completos publicados por SERCOP</div>
                </div>
              </a>
              <a href="https://www.compraspublicas.gob.ec/ProcesoContratacion/compras/PC/buscarProceso.cpe"
                target="_blank" rel="noopener"
                className="flex items-center gap-2 text-sm text-brand-600 hover:underline bg-blue-50 p-3 rounded-lg">
                <ExternalLink size={14} />
                <div>
                  <div className="font-medium">Buscar en Portal SERCOP</div>
                  <div className="text-xs text-gray-500">Requiere registro — busque por código del proceso</div>
                </div>
              </a>
            </div>
            <div className="mt-3 p-3 bg-gray-50 rounded-lg text-xs text-gray-500">
              <strong>Código para buscar en SERCOP:</strong>
              <p className="font-mono mt-1 select-all text-gray-700">{proc.title || proc.ocid || proc.id}</p>
            </div>
          </div>

          {/* Bottom Disclaimer */}
          <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 text-xs text-gray-500 leading-relaxed">
            <strong>Sobre esta plataforma:</strong> OICP es una herramienta de análisis independiente 
            que procesa datos públicos del estándar OCDS de SERCOP. Los indicadores de riesgo son 
            calculados algorítmicamente y tienen fines informativos y de investigación. No representan 
            acusaciones ni conclusiones legales. Los datos pueden estar incompletos o contener errores 
            de la fuente original. Para información oficial, consulte siempre{' '}
            <a href="https://www.compraspublicas.gob.ec" target="_blank" rel="noopener" className="text-brand-600 hover:underline">compraspublicas.gob.ec</a>.
          </div>
        </div>
      </div>
    </div>
  );
}
