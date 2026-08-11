import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api, ApiError, mensajeDeError } from '../lib/api';
import { StatCard, RiskBadge, Loading, EmptyState, ErrorState } from '../components/UI';
import { formatCurrency, formatDate, statusLabel, statusColor, formatCount } from '../lib/flags';

export default function SupplierProfile() {
  const { id } = useParams<{ id: string }>();
  const [profile, setProfile] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    if (!id) return;
    api.getSupplier(id).then(setProfile).catch(setError);
  }, [id]);

  if (error) {
    const noExiste = error instanceof ApiError && error.esNoEncontrado;
    return noExiste
      ? <EmptyState message="Proveedor no encontrado" />
      : <ErrorState message={mensajeDeError(error)} onRetry={() => window.location.reload()} />;
  }
  if (!profile) return <Loading />;

  const filteredProcedures = statusFilter
    ? profile.procedures?.filter((p: any) => p.status === statusFilter)
    : profile.procedures;
  // El desglose de riesgo omite los niveles con cero, así que la ausencia de la entrada
  // 'critical' significa CERO críticos, no "dato desconocido". Solo cuando no hay desglose
  // (base sin agregados) el valor es realmente desconocido.
  const hayRiesgo = Array.isArray(profile.riskDistribution) && profile.riskDistribution.length > 0;
  const criticos = hayRiesgo
    ? (profile.riskDistribution.find((r: any) => r.risk_level === 'critical')?.count ?? 0)
    : null;
  // El desglose por estado y la lista se calculan sobre la MUESTRA, no sobre el total:
  // rotularlos con el total del proveedor fue justo el defecto que se corrigió.
  const enMuestra = profile.muestraProcesos ?? profile.procedures?.length ?? 0;

  return (
    <div className="space-y-6">
      <Link to="/buscar" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-brand-600">
        <ArrowLeft size={16} /> Volver
      </Link>

      <div>
        <h1 className="text-xl font-bold">{profile.supplier?.name || id}</h1>
        <p className="text-sm text-gray-500 font-mono">{profile.supplier?.id}</p>
      </div>

      {/* Los totales salen de los agregados: son exactos sobre todos los procesos del
          proveedor (2019-2026), no sobre la muestra que se lista más abajo. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Contratos" value={formatCount(profile.totalProcedures)} />
        <StatCard label="Valor Total" value={profile.totalValue == null ? '—' : formatCurrency(profile.totalValue)} />
        <StatCard label="Procesos Críticos" value={formatCount(criticos)} />
        <StatCard label="Compradores Distintos" value={formatCount(profile.distinctBuyers)} />
      </div>

      {profile.agregadosNoDisponibles && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Los totales de este proveedor no están disponibles en este momento porque los
          agregados de la base se están reconstruyendo. Lo que se muestra abajo es una
          muestra de sus procesos, no el total.
        </div>
      )}

      {/* Status Breakdown */}
      {profile.byStatus?.length > 0 && (
        <div className="bg-white rounded-xl border p-5 shadow-sm">
          <h2 className="font-semibold mb-3">Desglose por Estado</h2>
          <p className="text-xs text-gray-500 mb-3">
            Calculado sobre los {enMuestra} procesos listados abajo, no sobre el total del proveedor.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setStatusFilter('')}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${
                !statusFilter ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
              Todos ({enMuestra})
            </button>
            {profile.byStatus.map((s: any) => (
              <button key={s.status}
                onClick={() => setStatusFilter(statusFilter === s.status ? '' : s.status)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${
                  statusFilter === s.status ? 'bg-brand-600 text-white ring-2 ring-brand-300' : `${statusColor(s.status)} hover:opacity-80`
                }`}>
                {statusLabel(s.status)} ({s.count})
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Year Breakdown */}
      {profile.byYear?.length > 0 && (
        <div className="bg-white rounded-xl border p-5 shadow-sm">
          <h2 className="font-semibold mb-3">Actividad por Año</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {profile.byYear.map((y: any) => (
              <div key={y.year} className="text-center p-3 rounded-lg bg-gray-50">
                <div className="text-lg font-bold text-brand-700">{y.year}</div>
                <div className="text-sm text-gray-600">{y.count} proc.</div>
                <div className="text-xs text-gray-400 font-mono">{formatCurrency(y.value)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Concentration */}
      {profile.concentration?.length > 0 && (
        <div className="bg-white rounded-xl border p-5 shadow-sm">
          <h2 className="font-semibold mb-4">Concentración por Comprador</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="pb-2 font-medium">Comprador</th>
                  <th className="pb-2 font-medium">Año</th>
                  <th className="pb-2 font-medium text-right">Contratos</th>
                  <th className="pb-2 font-medium text-right">Valor</th>
                  <th className="pb-2 font-medium text-right">% del Comprador</th>
                  <th className="pb-2 font-medium text-right">Ínfimas</th>
                </tr>
              </thead>
              <tbody>
                {profile.concentration.map((c: any, i: number) => (
                  <tr key={i} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="py-2">
                      <Link to={`/comprador/${encodeURIComponent(c.buyer_id)}`}
                        className="text-brand-600 hover:underline">{c.buyer_id}</Link>
                    </td>
                    <td className="py-2">{c.year}</td>
                    <td className="py-2 text-right">{c.contract_count}</td>
                    <td className="py-2 text-right font-mono">{formatCurrency(c.total_value)}</td>
                    <td className="py-2 text-right">
                      <span className={c.share_of_buyer > 30 ? 'text-red-600 font-bold' : ''}>
                        {c.share_of_buyer?.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-2 text-right">{c.infima_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Procedures */}
      <div className="bg-white rounded-xl border p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">
            Procedimientos {statusFilter ? `— ${statusLabel(statusFilter)}` : ''}
            <span className="text-sm font-normal text-gray-400 ml-2">({filteredProcedures?.length || 0})</span>
          </h2>
        </div>
        {profile.esMuestra && (
          <p className="text-xs text-gray-500 mb-3">
            Muestra de sus procesos más recientes
            {profile.totalProcedures != null && <> de un total de {profile.totalProcedures}</>}.
            Para el detalle completo, filtra en la búsqueda por este proveedor.
          </p>
        )}
        <div className="space-y-2">
          {filteredProcedures?.slice(0, 50).map((p: any) => (
            <Link key={p.id} to={`/proceso/${encodeURIComponent(p.id)}`}
              className="flex items-center justify-between py-2 px-3 rounded hover:bg-gray-50 transition border-b last:border-0">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  {p.status && (
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${statusColor(p.status)}`}>
                      {statusLabel(p.status)}
                    </span>
                  )}
                  <p className="text-sm font-medium text-brand-700 line-clamp-1">{p.title || p.id}</p>
                </div>
                <p className="text-xs text-gray-500">{p.buyer_name} · {formatDate(p.published_date)}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {/* monto_usd, no award_amount crudo: una sola definición de monto (regla 11). */}
                <span className="font-mono text-sm">{formatCurrency(p.monto_usd ?? p.award_amount)}</span>
                <RiskBadge level={p.risk_level} />
              </div>
            </Link>
          ))}
          {filteredProcedures?.length > 50 && (
            <p className="text-sm text-gray-400 text-center py-2">
              Mostrando 50 de {filteredProcedures.length} procedimientos
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
