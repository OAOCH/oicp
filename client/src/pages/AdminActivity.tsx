import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Loading } from '../components/UI';
import { Activity, Clock, Eye, ArrowLeft } from 'lucide-react';

const EC_TZ = 'America/Guayaquil';

function ecTime(utc: string): string {
  const d = new Date(utc.replace(' ', 'T') + 'Z');
  return d.toLocaleString('es-EC', { timeZone: EC_TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function pathLabel(p: string, q: string): string {
  let label = p;
  if (p === '/statistics') label = 'Portada (estadísticas)';
  else if (p === '/procedures') label = 'Búsqueda de procesos';
  else if (p.startsWith('/procedures/')) label = `Proceso: ${decodeURIComponent(p.slice(12)).slice(0, 60)}`;
  else if (p.startsWith('/buyers/')) label = `Comprador: ${decodeURIComponent(p.slice(8)).slice(0, 50)}`;
  else if (p.startsWith('/suppliers/')) label = `Proveedor: ${decodeURIComponent(p.slice(11)).slice(0, 50)}`;
  else if (p === '/rankings') label = 'Rankings';
  else if (p === '/filters') label = 'Filtros de búsqueda';
  if (q) {
    try {
      const o = JSON.parse(q);
      const parts: string[] = [];
      if (o.q) parts.push(`"${o.q}"`);
      if (o.year) parts.push(o.year);
      if (o.risk) parts.push(`riesgo ${o.risk}`);
      if (o.type) parts.push(o.type);
      if (parts.length) label += ` — ${parts.join(', ')}`;
    } catch { /* query ilegible: se muestra solo la página */ }
  }
  return label;
}

export default function AdminActivity() {
  const { user, loading: authLoading } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [email, setEmail] = useState('');
  const [days, setDays] = useState(30);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/auth/users', { credentials: 'include' })
      .then(r => r.json())
      .then(j => {
        setUsers(j.users || []);
        const firstViewer = (j.users || []).find((u: any) => u.role !== 'superadmin');
        if (firstViewer) setEmail(firstViewer.email);
        else if (j.users?.length) setEmail(j.users[0].email);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!email) return;
    setLoading(true); setError('');
    fetch(`/api/auth/activity?email=${encodeURIComponent(email)}&days=${days}`, { credentials: 'include' })
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; })
      .then(setData)
      .catch(e => { setError(e.message); setData(null); })
      .finally(() => setLoading(false));
  }, [email, days]);

  if (authLoading) return <Loading />;
  if (!user || user.role !== 'superadmin') {
    return <div className="max-w-lg mx-auto mt-12 rounded-xl border bg-white p-6 text-center text-gray-600">
      Esta sección es solo para el superadministrador.
    </div>;
  }

  return (
    <div className="max-w-4xl mx-auto">
      <Link to="/admin/usuarios" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-2">
        <ArrowLeft size={14} /> Gestión de accesos
      </Link>
      <div className="flex items-center gap-2 mb-1"><Activity className="text-brand-600" size={22} /><h1>Actividad por usuario</h1></div>
      <p className="text-sm text-gray-500 mb-4">Sesiones y páginas visitadas. Horas en hora de Ecuador (GMT-5).</p>

      <div className="flex flex-wrap gap-3 mb-5">
        <select value={email} onChange={e => setEmail(e.target.value)}
          className="rounded-lg border px-3 py-1.5 text-sm bg-white">
          {users.map(u => <option key={u.email} value={u.email}>{u.email}{u.role === 'superadmin' ? ' (tú)' : ''}</option>)}
        </select>
        <select value={days} onChange={e => setDays(Number(e.target.value))}
          className="rounded-lg border px-3 py-1.5 text-sm bg-white">
          <option value={7}>Últimos 7 días</option>
          <option value={30}>Últimos 30 días</option>
          <option value={90}>Últimos 90 días</option>
        </select>
      </div>

      {loading && <Loading />}
      {error && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 mb-4">{error}</div>}

      {data && !loading && (
        <>
          <div className="grid gap-3 sm:grid-cols-3 mb-5">
            <div className="bg-white rounded-xl border p-4">
              <p className="text-xs uppercase text-gray-500">Sesiones</p>
              <p className="text-2xl font-semibold text-gray-900">{data.sesiones.length}</p>
            </div>
            <div className="bg-white rounded-xl border p-4">
              <p className="text-xs uppercase text-gray-500">Acciones totales</p>
              <p className="text-2xl font-semibold text-gray-900">{data.total_eventos}</p>
            </div>
            <div className="bg-white rounded-xl border p-4">
              <p className="text-xs uppercase text-gray-500">Tiempo activo aprox.</p>
              <p className="text-2xl font-semibold text-gray-900">
                {data.sesiones.reduce((s: number, x: any) => s + x.minutos, 0)} min
              </p>
            </div>
          </div>

          {data.total_eventos === 0 && (
            <div className="rounded-lg bg-gray-50 border text-gray-600 text-sm px-4 py-3 mb-4">
              Sin actividad registrada en este período. (El registro corre desde que se activó esta función;
              la navegación anterior no quedó guardada.)
            </div>
          )}

          {data.sesiones.length > 0 && (
            <div className="bg-white rounded-xl border p-4 mb-5">
              <p className="text-sm font-medium text-gray-900 mb-2 flex items-center gap-1"><Clock size={15} /> Sesiones</p>
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs uppercase text-gray-500">
                  <th className="py-1">Inicio (Ecuador)</th><th>Fin</th><th>Duración</th><th>Acciones</th>
                </tr></thead>
                <tbody>
                  {data.sesiones.slice(0, 20).map((s: any, i: number) => (
                    <tr key={i} className="border-t">
                      <td className="py-1.5">{ecTime(s.inicio)}</td>
                      <td>{ecTime(s.fin)}</td>
                      <td>{s.minutos < 1 ? '<1 min' : `${s.minutos} min`}</td>
                      <td>{s.eventos}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}

          {data.eventos_recientes.length > 0 && (
            <div className="bg-white rounded-xl border p-4">
              <p className="text-sm font-medium text-gray-900 mb-2 flex items-center gap-1"><Eye size={15} /> Qué ha visto (más reciente primero)</p>
              <div className="max-h-96 overflow-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {data.eventos_recientes.map((e: any, i: number) => (
                      <tr key={i} className="border-t">
                        <td className="py-1.5 text-gray-500 whitespace-nowrap pr-3">{ecTime(e.ts)}</td>
                        <td className="text-gray-800">{pathLabel(e.path, e.query)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
