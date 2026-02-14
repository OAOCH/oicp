import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, AlertTriangle, FileText, Users } from 'lucide-react';
import { api } from '../lib/api';
import { StatCard, RiskBadge, Loading, ScoreGauge } from '../components/UI';
import { formatCurrency, formatDate } from '../lib/flags';

export default function Home() {
  const [stats, setStats] = useState<any>(null);
  const [query, setQuery] = useState('');
  const nav = useNavigate();

  useEffect(() => { api.getStatistics().then(setStats).catch(console.error); }, []);

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) nav(`/buscar?q=${encodeURIComponent(query.trim())}`);
  };

  if (!stats) return <Loading />;

  const riskMap: Record<string, number> = {};
  stats.byRisk?.forEach((r: any) => { riskMap[r.risk_level] = r.count; });

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="text-center py-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          🔍 Observatorio de Integridad de Contratación Pública
        </h1>
        <p className="text-gray-500 max-w-2xl mx-auto mb-6">
          Análisis de riesgos en contratación pública del Ecuador basado en datos abiertos OCDS.
          Identifica patrones que ameritan escrutinio ciudadano.
        </p>
        <form onSubmit={onSearch} className="max-w-xl mx-auto flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Buscar por entidad, proveedor, OCID o palabra clave..."
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
            />
          </div>
          <button type="submit" className="px-6 py-2.5 bg-brand-600 text-white rounded-lg font-medium hover:bg-brand-700 transition">
            Buscar
          </button>
        </form>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Procedimientos" value={stats.totalProcedures.toLocaleString()} sub="Total en base de datos" />
        <StatCard label="Banderas Detectadas" value={stats.totalFlags.toLocaleString()} color="text-orange-600" sub="Indicadores de riesgo activos" />
        <StatCard label="Score Promedio" value={stats.averageScore} sub={`Máximo: ${stats.maxScore}`} />
        <StatCard label="Riesgo Alto/Crítico" value={(riskMap.high || 0) + (riskMap.critical || 0)} color="text-red-600" sub="Procedimientos que requieren atención" />
      </div>

      {/* Risk Distribution */}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border p-5 shadow-sm">
          <h2 className="font-semibold mb-4">Distribución por Nivel de Riesgo</h2>
          <div className="space-y-3">
            {['low', 'moderate', 'high', 'critical'].map(level => {
              const count = riskMap[level] || 0;
              const pct = stats.totalProcedures ? (count / stats.totalProcedures * 100) : 0;
              const colors: Record<string, string> = { low: 'bg-green-500', moderate: 'bg-yellow-500', high: 'bg-orange-500', critical: 'bg-red-500' };
              const labels: Record<string, string> = { low: 'Bajo', moderate: 'Moderado', high: 'Alto', critical: 'Crítico' };
              return (
                <div key={level}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium">{labels[level]}</span>
                    <span className="text-gray-500">{count} ({pct.toFixed(1)}%)</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full ${colors[level]} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top Flags */}
        <div className="bg-white rounded-xl border p-5 shadow-sm">
          <h2 className="font-semibold mb-4">Banderas Más Frecuentes</h2>
          <div className="space-y-2">
            {stats.topFlags?.slice(0, 8).map((f: any) => (
              <Link key={f.code} to={`/buscar?flag=${f.code}`}
                className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-gray-50 transition">
                <span className="font-mono text-sm text-brand-700">{f.code}</span>
                <span className="text-sm text-gray-500">{f.count} procedimientos</span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Procedures */}
      <div className="bg-white rounded-xl border p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">Procedimientos Recientes</h2>
          <Link to="/buscar" className="text-sm text-brand-600 hover:underline">Ver todos →</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="pb-2 font-medium">Procedimiento</th>
                <th className="pb-2 font-medium">Comprador</th>
                <th className="pb-2 font-medium text-right">Monto</th>
                <th className="pb-2 font-medium text-center">Score</th>
                <th className="pb-2 font-medium">Riesgo</th>
                <th className="pb-2 font-medium">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {stats.recentProcedures?.map((p: any) => (
                <tr key={p.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="py-2 max-w-xs">
                    <Link to={`/proceso/${encodeURIComponent(p.id)}`} className="text-brand-600 hover:underline line-clamp-1">
                      {p.title || p.id}
                    </Link>
                  </td>
                  <td className="py-2 text-gray-600 line-clamp-1">{p.buyer_name || '—'}</td>
                  <td className="py-2 text-right font-mono">{formatCurrency(p.award_amount)}</td>
                  <td className="py-2 text-center">
                    <span className="font-bold" style={{ color: `${p.score > 60 ? '#ef4444' : p.score > 30 ? '#f97316' : p.score > 10 ? '#eab308' : '#22c55e'}` }}>
                      {p.score}
                    </span>
                  </td>
                  <td className="py-2"><RiskBadge level={p.risk_level} /></td>
                  <td className="py-2 text-gray-500">{formatDate(p.published_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Quick Links */}
      <div className="grid md:grid-cols-3 gap-4">
        <Link to="/rankings" className="bg-white rounded-xl border p-5 shadow-sm hover:border-brand-300 transition group">
          <Trophy className="text-brand-600 mb-2" size={24} />
          <h3 className="font-semibold group-hover:text-brand-700">Rankings</h3>
          <p className="text-sm text-gray-500">Entidades y proveedores con más alertas de riesgo</p>
        </Link>
        <Link to="/metodologia" className="bg-white rounded-xl border p-5 shadow-sm hover:border-brand-300 transition group">
          <FileText className="text-brand-600 mb-2" size={24} />
          <h3 className="font-semibold group-hover:text-brand-700">Metodología</h3>
          <p className="text-sm text-gray-500">15 indicadores calibrados para Ecuador</p>
        </Link>
        <a href="https://datosabiertos.compraspublicas.gob.ec" target="_blank" rel="noopener"
          className="bg-white rounded-xl border p-5 shadow-sm hover:border-brand-300 transition group">
          <Users className="text-brand-600 mb-2" size={24} />
          <h3 className="font-semibold group-hover:text-brand-700">Datos Fuente</h3>
          <p className="text-sm text-gray-500">Portal de Datos Abiertos de SERCOP</p>
        </a>
      </div>
    </div>
  );
}
