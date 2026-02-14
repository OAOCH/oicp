import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { Loading, EmptyState } from '../components/UI';
import { formatCurrency } from '../lib/flags';

export default function Rankings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const type = searchParams.get('type') || 'buyers';

  useEffect(() => {
    setLoading(true);
    api.getRankings(type).then(d => { setData(d); setLoading(false); }).catch(e => { console.error(e); setLoading(false); });
  }, [type]);

  const setType = (t: string) => {
    const p = new URLSearchParams(searchParams);
    p.set('type', t);
    setSearchParams(p);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1>Rankings de Riesgo</h1>
        <p className="text-sm text-gray-500 mt-1">Entidades y proveedores ordenados por indicadores de riesgo</p>
      </div>

      <div className="flex gap-2">
        {[
          { key: 'buyers', label: 'Compradores' },
          { key: 'suppliers', label: 'Proveedores' },
          { key: 'pairs', label: 'Pares Comprador-Proveedor' },
        ].map(tab => (
          <button key={tab.key} onClick={() => setType(tab.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition
              ${type === tab.key ? 'bg-brand-600 text-white' : 'bg-white border hover:bg-gray-50'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? <Loading /> : !data.length ? <EmptyState message="No hay datos disponibles" /> : (
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            {type === 'buyers' && (
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 border-b text-left text-gray-500">
                  <th className="px-4 py-3 font-medium">#</th>
                  <th className="px-4 py-3 font-medium">Entidad</th>
                  <th className="px-4 py-3 font-medium text-right">Procedimientos</th>
                  <th className="px-4 py-3 font-medium text-right">Valor Total</th>
                  <th className="px-4 py-3 font-medium text-right">Score Prom.</th>
                  <th className="px-4 py-3 font-medium text-right">Score Máx.</th>
                  <th className="px-4 py-3 font-medium text-right">Alto Riesgo</th>
                </tr></thead>
                <tbody>
                  {data.map((r: any, i: number) => (
                    <tr key={r.buyer_id} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-400">{i + 1}</td>
                      <td className="px-4 py-3">
                        <Link to={`/comprador/${encodeURIComponent(r.buyer_id)}`}
                          className="text-brand-600 hover:underline">{r.buyer_name || r.buyer_id}</Link>
                      </td>
                      <td className="px-4 py-3 text-right">{r.procedure_count}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatCurrency(r.total_value)}</td>
                      <td className="px-4 py-3 text-right font-bold"
                        style={{ color: r.avg_score > 60 ? '#ef4444' : r.avg_score > 30 ? '#f97316' : '#22c55e' }}>
                        {Math.round(r.avg_score)}
                      </td>
                      <td className="px-4 py-3 text-right">{r.max_score}</td>
                      <td className="px-4 py-3 text-right text-red-600 font-medium">{r.high_risk_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {type === 'suppliers' && (
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 border-b text-left text-gray-500">
                  <th className="px-4 py-3 font-medium">#</th>
                  <th className="px-4 py-3 font-medium">Proveedor</th>
                  <th className="px-4 py-3 font-medium text-right">Contratos</th>
                  <th className="px-4 py-3 font-medium text-right">Valor Total</th>
                  <th className="px-4 py-3 font-medium text-right">Compradores</th>
                  <th className="px-4 py-3 font-medium text-right">Ínfimas</th>
                  <th className="px-4 py-3 font-medium text-right">Concentración Máx.</th>
                </tr></thead>
                <tbody>
                  {data.map((r: any, i: number) => (
                    <tr key={r.supplier_id} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-400">{i + 1}</td>
                      <td className="px-4 py-3">
                        <Link to={`/proveedor/${encodeURIComponent(r.supplier_id)}`}
                          className="text-brand-600 hover:underline">{r.supplier_name || r.supplier_id}</Link>
                      </td>
                      <td className="px-4 py-3 text-right">{r.total_contracts}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatCurrency(r.total_value)}</td>
                      <td className="px-4 py-3 text-right">{r.distinct_buyers}</td>
                      <td className="px-4 py-3 text-right">{r.total_infimas}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={r.max_concentration > 30 ? 'text-red-600 font-bold' : ''}>
                          {r.max_concentration?.toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {type === 'pairs' && (
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 border-b text-left text-gray-500">
                  <th className="px-4 py-3 font-medium">#</th>
                  <th className="px-4 py-3 font-medium">Comprador</th>
                  <th className="px-4 py-3 font-medium">Proveedor</th>
                  <th className="px-4 py-3 font-medium">Año</th>
                  <th className="px-4 py-3 font-medium text-right">Contratos</th>
                  <th className="px-4 py-3 font-medium text-right">Valor</th>
                  <th className="px-4 py-3 font-medium text-right">% del Comprador</th>
                  <th className="px-4 py-3 font-medium text-right">Ínfimas</th>
                </tr></thead>
                <tbody>
                  {data.map((r: any, i: number) => (
                    <tr key={`${r.buyer_id}-${r.supplier_id}-${r.year}`} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-400">{i + 1}</td>
                      <td className="px-4 py-3">
                        <Link to={`/comprador/${encodeURIComponent(r.buyer_id)}`} className="text-brand-600 hover:underline text-xs">{r.buyer_id}</Link>
                      </td>
                      <td className="px-4 py-3">
                        <Link to={`/proveedor/${encodeURIComponent(r.supplier_id)}`} className="text-brand-600 hover:underline">{r.supplier_name || r.supplier_id}</Link>
                      </td>
                      <td className="px-4 py-3">{r.year}</td>
                      <td className="px-4 py-3 text-right">{r.contract_count}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatCurrency(r.total_value)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={r.share_of_buyer > 30 ? 'text-red-600 font-bold' : ''}>
                          {r.share_of_buyer?.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">{r.infima_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-700">
        Los rankings se calculan a partir de datos OCDS procesados. Un score alto no implica irregularidad,
        solo indica patrones que ameritan mayor escrutinio.
      </div>
    </div>
  );
}
