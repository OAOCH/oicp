import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Building2, User } from 'lucide-react';
import { api } from '../lib/api';
import { ScoreGauge, RiskBadge, FlagCard, Loading } from '../components/UI';
import { formatCurrency, formatDate } from '../lib/flags';

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

  return (
    <div className="space-y-6">
      <Link to="/buscar" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-brand-600">
        <ArrowLeft size={16} /> Volver a búsqueda
      </Link>

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

          {/* Flags */}
          {activeFlags.length > 0 && (
            <div className="bg-white rounded-xl border p-5 shadow-sm">
              <h2 className="font-semibold mb-4">
                Banderas de Riesgo ({activeFlags.length})
              </h2>
              <div className="space-y-3">
                {activeFlags.map((f: any) => <FlagCard key={f.code} flag={f} />)}
              </div>
            </div>
          )}
        </div>

        {/* Right: Actors */}
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
            <p className="text-xs text-gray-400 mt-2">
              Score = suma de pesos por severidad (máx 100). Flags correlacionados se ponderan al 50%.
            </p>
          </div>

          {/* Source & Verification Links */}
          <div className="bg-white rounded-xl border p-5 shadow-sm">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <ExternalLink size={18} className="text-brand-600" /> Verificar en Fuente Oficial
            </h3>
            <div className="space-y-3">
              <a href={`https://www.compraspublicas.gob.ec/ProcesoContratacion/compras/PC/informacionProcesoContratacion2.cpe?idSolesercop=${(proc.ocid || proc.id || '').split('-').pop()}`}
                target="_blank" rel="noopener"
                className="flex items-center gap-2 text-sm text-brand-600 hover:underline bg-blue-50 p-3 rounded-lg">
                <ExternalLink size={14} />
                <div>
                  <div className="font-medium">Ver en Portal SERCOP</div>
                  <div className="text-xs text-gray-500">Portal oficial de compras públicas</div>
                </div>
              </a>
              <a href={`https://datosabiertos.compraspublicas.gob.ec/PLATAFORMA/api/record?ocid=${encodeURIComponent(proc.ocid || proc.id || '')}`}
                target="_blank" rel="noopener"
                className="flex items-center gap-2 text-sm text-brand-600 hover:underline bg-blue-50 p-3 rounded-lg">
                <ExternalLink size={14} />
                <div>
                  <div className="font-medium">Ver datos OCDS completos</div>
                  <div className="text-xs text-gray-500">Registro oficial en formato abierto</div>
                </div>
              </a>
            </div>
            <p className="text-xs text-gray-400 mt-3">
              ⚠️ Los datos de esta plataforma provienen del estándar OCDS publicado por SERCOP.
              Siempre verifique la información en el portal oficial antes de tomar decisiones.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
