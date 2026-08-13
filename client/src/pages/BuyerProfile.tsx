import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api, ApiError, mensajeDeError } from '../lib/api';
import { StatCard, RiskBadge, Loading, EmptyState, ErrorState } from '../components/UI';
import { formatCurrency, formatCount } from '../lib/flags';

// La distribución llega en el orden que devuelve el GROUP BY, que es arbitrario: se veía
// "Crítico, Alto, Bajo, Moderado". Se ordena por severidad para que se lea de un vistazo.
const ORDEN_RIESGO: Record<string, number> = { critical: 0, high: 1, moderate: 2, low: 3 };

export default function BuyerProfile() {
  const { id } = useParams<{ id: string }>();
  const [profile, setProfile] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!id) return;
    api.getBuyer(id).then(setProfile).catch(setError);
  }, [id]);

  if (error) {
    const noExiste = error instanceof ApiError && error.esNoEncontrado;
    return noExiste
      ? <EmptyState message="Comprador no encontrado" />
      : <ErrorState message={mensajeDeError(error)} onRetry={() => window.location.reload()} />;
  }
  if (!profile) return <Loading />;

  return (
    <div className="space-y-6">
      <Link to="/buscar" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-brand-600">
        <ArrowLeft size={16} /> Volver
      </Link>

      <div>
        <h1 className="text-xl font-bold">{profile.buyer_name || profile.buyer_id}</h1>
        <p className="text-sm text-gray-500 font-mono">{profile.buyer_id}</p>
      </div>

      {/* Contexto institucional (13-ago-2026): el mismo RUC aparece como varias unidades de
          compra y quien mira una sola no ve la institución completa. Solo se muestra cuando
          hay más de una unidad: con una, el consolidado repetiría las cifras de arriba. */}
      {profile.consolidado_ruc && (profile.unidades_de_compra || 0) > 1 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-900">
          Esta es una de <strong>{profile.unidades_de_compra}</strong> unidades de compra de la
          institución con RUC <span className="font-mono">{profile.consolidado_ruc.ruc}</span>:
          entre todas suman <strong>{formatCount(profile.consolidado_ruc.n_procs)}</strong>{' '}
          procesos por <strong>{formatCurrency(profile.consolidado_ruc.total_usd)}</strong>. Las
          banderas de concentración se evalúan por unidad de compra, no por institución (ver{' '}
          <Link to="/metodologia" className="underline hover:text-blue-700">metodología</Link>).
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Procedimientos" value={formatCount(profile.total_procedures)} />
        <StatCard label="Valor Total" value={formatCurrency(profile.total_value)} />
        <StatCard label="Score Promedio" value={Math.round(profile.avg_score || 0)} />
        <StatCard label="Score Máximo" value={formatCount(profile.max_score)} color="text-red-600" />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Risk Distribution */}
        <div className="bg-white rounded-xl border p-5 shadow-sm">
          <h2 className="font-semibold mb-4">Distribución de Riesgo</h2>
          <div className="space-y-2">
            {[...(profile.riskDistribution || [])]
              .sort((a: any, b: any) => (ORDEN_RIESGO[a.risk_level] ?? 9) - (ORDEN_RIESGO[b.risk_level] ?? 9))
              .map((r: any) => (
                <div key={r.risk_level} className="flex items-center justify-between text-sm">
                  <RiskBadge level={r.risk_level} />
                  <span className="font-medium">{formatCount(r.count)}</span>
                </div>
              ))}
          </div>
        </div>

        {/* Top Flags */}
        <div className="bg-white rounded-xl border p-5 shadow-sm">
          <h2 className="font-semibold mb-4">Banderas Más Frecuentes</h2>
          <div className="space-y-2">
            {profile.flagDistribution?.slice(0, 8).map((f: any) => (
              <div key={f.code} className="flex items-center justify-between text-sm">
                <span className="font-mono text-brand-700">{f.code}</span>
                <span>{formatCount(f.count)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top Suppliers */}
      <div className="bg-white rounded-xl border p-5 shadow-sm">
        <h2 className="font-semibold mb-4">Principales Proveedores</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="pb-2 font-medium">Proveedor</th>
                <th className="pb-2 font-medium">Año</th>
                <th className="pb-2 font-medium text-right">Contratos</th>
                <th className="pb-2 font-medium text-right">Valor Total</th>
                <th className="pb-2 font-medium text-right">% del Gasto</th>
                <th className="pb-2 font-medium text-right">Ínfimas</th>
              </tr>
            </thead>
            <tbody>
              {profile.topSuppliers?.map((s: any, i: number) => (
                <tr key={i} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="py-2">
                    <Link to={`/proveedor/${encodeURIComponent(s.supplier_id)}`}
                      className="text-brand-600 hover:underline">{s.supplier_name || s.supplier_id}</Link>
                  </td>
                  <td className="py-2">{s.year}</td>
                  <td className="py-2 text-right">{s.contract_count}</td>
                  <td className="py-2 text-right font-mono">{formatCurrency(s.total_value)}</td>
                  <td className="py-2 text-right">
                    <span className={s.share_of_buyer > 30 ? 'text-red-600 font-bold' : ''}>
                      {s.share_of_buyer?.toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-2 text-right">{s.infima_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Link to={`/buscar?buyerId=${encodeURIComponent(profile.buyer_id)}`}
        className="inline-block text-brand-600 hover:underline text-sm">
        Ver todos los procedimientos de este comprador →
      </Link>
    </div>
  );
}
