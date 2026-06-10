import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { Loading } from '../components/UI';
import { Wrench, RefreshCw, DollarSign, Activity } from 'lucide-react';

export default function AdminAudit() {
  const { user, loading: authLoading } = useAuth();
  const [output, setOutput] = useState<any>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function run(label: string, endpoint: string, warn?: string) {
    if (warn && !confirm(warn)) return;
    setRunning(label); setError(''); setOutput(null);
    try {
      const res = await fetch(endpoint, { method: 'POST', credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setOutput(data);
    } catch (e: any) { setError(e.message); } finally { setRunning(null); }
  }

  if (authLoading) return <Loading />;
  if (!user || user.role !== 'superadmin') {
    return <div className="max-w-lg mx-auto mt-12 rounded-xl border bg-white p-6 text-center text-gray-600">
      Esta sección es solo para el superadministrador.
    </div>;
  }

  const actions = [
    { label: 'Reparar budget_amount', icon: DollarSign, endpoint: '/api/admin/fix-budget', desc: 'Repara montos de presupuesto guardados como "USD".', warn: '¿Reparar budget_amount? Es seguro y rápido.' },
    { label: 'Reconstruir concentración (fix-share)', icon: Wrench, endpoint: '/api/admin/fix-share', desc: 'Recalcula share_of_buyer e índice de concentración. ~1-2 min.', warn: '¿Reconstruir el índice de concentración? Toma 1-2 minutos.' },
    { label: 'Re-normalizar banderas', icon: RefreshCw, endpoint: '/api/admin/normalize', desc: 'Re-evalúa las 15 banderas en 1.46M procesos. ~10-12 min, el sitio va lento mientras corre.', warn: '¿Re-normalizar TODAS las banderas? Toma 10-12 minutos y el sitio responderá lento. ¿Continuar?' },
  ];

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-2 mb-1"><Activity className="text-brand-600" size={22} /><h1>Operaciones de datos</h1></div>
      <p className="text-sm text-gray-500 mb-6">Herramientas de mantenimiento de la base. Úsalas con cuidado.</p>

      <div className="grid gap-3 sm:grid-cols-3 mb-6">
        {actions.map((a) => (
          <div key={a.label} className="bg-white rounded-xl border p-4 flex flex-col">
            <a.icon className="text-brand-600 mb-2" size={20} />
            <p className="font-medium text-sm text-gray-900">{a.label}</p>
            <p className="text-xs text-gray-500 mt-1 flex-1">{a.desc}</p>
            <button disabled={!!running} onClick={() => run(a.label, a.endpoint, a.warn)}
              className="mt-3 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white rounded-lg px-3 py-1.5 text-xs font-medium">
              {running === a.label ? 'Ejecutando…' : 'Ejecutar'}
            </button>
          </div>
        ))}
      </div>

      {running && <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-3 mb-4">
        Ejecutando «{running}». No cierres esta página.
      </div>}
      {error && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 mb-4">{error}</div>}

      {output && (
        <div className="bg-white rounded-xl border p-4">
          <p className="text-sm font-medium text-gray-900 mb-2">Resultado</p>
          {output.message && <p className="text-sm text-gray-700 mb-3">{output.message}</p>}
          {output.riskCounts && (
            <div className="mb-3">
              <p className="text-xs uppercase text-gray-500 mb-1">Distribución de riesgo</p>
              <div className="flex flex-wrap gap-2">
                {output.riskCounts.map((r: any) => (
                  <span key={r.risk_level} className="text-xs rounded-full bg-gray-100 px-2 py-1">{r.risk_level}: {r.count.toLocaleString()}</span>
                ))}
              </div>
            </div>
          )}
          {output.flagCounts && (
            <div className="mb-3">
              <p className="text-xs uppercase text-gray-500 mb-1">Banderas activas</p>
              <div className="flex flex-wrap gap-2">
                {output.flagCounts.map((f: any) => (
                  <span key={f.code} className="text-xs rounded-full bg-gray-100 px-2 py-1 font-mono">{f.code}: {f.count.toLocaleString()}</span>
                ))}
              </div>
            </div>
          )}
          {output.estadisticas && (
            <pre className="text-xs bg-gray-50 rounded-lg p-3 overflow-x-auto">{JSON.stringify(output.estadisticas, null, 2)}</pre>
          )}
        </div>
      )}
    </div>
  );
}
