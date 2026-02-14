import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api } from '../lib/api';
import { StatCard, RiskBadge, Loading, EmptyState } from '../components/UI';
import { formatCurrency, formatDate } from '../lib/flags';

export default function SupplierProfile() {
  const { id } = useParams<{ id: string }>();
  const [profile, setProfile] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    api.getSupplier(id).then(setProfile).catch(e => setError(e.message));
  }, [id]);

  if (error) return <EmptyState message="Proveedor no encontrado" />;
  if (!profile) return <Loading />;

  return (
    <div className="space-y-6">
      <Link to="/buscar" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-brand-600">
        <ArrowLeft size={16} /> Volver
      </Link>

      <div>
        <h1 className="text-xl font-bold">{profile.supplier?.name || id}</h1>
        <p className="text-sm text-gray-500 font-mono">{profile.supplier?.id}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Contratos" value={profile.totalProcedures} />
        <StatCard label="Valor Total" value={formatCurrency(profile.totalValue)} />
        <StatCard label="Score Promedio" value={profile.averageScore} />
        <StatCard label="Compradores Distintos" value={profile.distinctBuyers} />
      </div>

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

      {/* Recent Procedures */}
      <div className="bg-white rounded-xl border p-5 shadow-sm">
        <h2 className="font-semibold mb-4">Procedimientos Recientes</h2>
        <div className="space-y-2">
          {profile.procedures?.slice(0, 20).map((p: any) => (
            <Link key={p.id} to={`/proceso/${encodeURIComponent(p.id)}`}
              className="flex items-center justify-between py-2 px-3 rounded hover:bg-gray-50 transition border-b last:border-0">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-brand-700 line-clamp-1">{p.title || p.id}</p>
                <p className="text-xs text-gray-500">{p.buyer_name} · {formatDate(p.published_date)}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm">{formatCurrency(p.award_amount)}</span>
                <RiskBadge level={p.risk_level} />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
