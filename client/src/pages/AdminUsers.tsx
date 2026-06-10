import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { Loading } from '../components/UI';
import { Shield, Trash2, UserPlus } from 'lucide-react';

interface User { email: string; role: string; invited_by?: string; invited_at?: string; last_login_at?: string; }

export default function AdminUsers() {
  const { user, loading: authLoading } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('viewer');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/users', { credentials: 'include' });
      if (!res.ok) throw new Error('No autorizado');
      const data = await res.json();
      setUsers(data.users || []);
      setError('');
    } catch (e: any) {
      setError('No se pudo cargar la lista. ¿Tienes rol de superadmin?');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/auth/users', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error');
      setEmail(''); setRole('viewer');
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function changeRole(u: User, newRole: string) {
    await fetch(`/api/auth/users/${encodeURIComponent(u.email)}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: newRole }),
    });
    await load();
  }

  async function remove(u: User) {
    if (!confirm(`¿Revocar el acceso de ${u.email}?`)) return;
    const res = await fetch(`/api/auth/users/${encodeURIComponent(u.email)}`, { method: 'DELETE', credentials: 'include' });
    if (!res.ok) { const d = await res.json(); alert(d.error || 'No se pudo eliminar'); return; }
    await load();
  }

  if (authLoading) return <Loading />;
  if (!user || user.role !== 'superadmin') {
    return <div className="max-w-lg mx-auto mt-12 rounded-xl border bg-white p-6 text-center text-gray-600">
      Esta sección es solo para el superadministrador.
    </div>;
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-2 mb-1"><Shield className="text-brand-600" size={22} /><h1>Gestión de accesos</h1></div>
      <p className="text-sm text-gray-500 mb-6">Solo los correos en esta lista pueden ingresar. No hay registro público.</p>

      <form onSubmit={add} className="bg-white rounded-xl border p-4 mb-6 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[220px]">
          <label className="block text-sm font-medium text-gray-700 mb-1">Correo a autorizar</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="persona@correo.com"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Rol</label>
          <select value={role} onChange={(e) => setRole(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500">
            <option value="viewer">Viewer</option>
            <option value="superadmin">Superadmin</option>
          </select>
        </div>
        <button disabled={busy} className="flex items-center gap-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white rounded-lg px-4 py-2 text-sm font-medium">
          <UserPlus size={16} /> Agregar
        </button>
      </form>

      {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}

      {loading ? <Loading /> : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-left text-xs uppercase">
              <tr><th className="px-4 py-2">Correo</th><th className="px-4 py-2">Rol</th><th className="px-4 py-2 hidden sm:table-cell">Último ingreso</th><th className="px-4 py-2"></th></tr>
            </thead>
            <tbody className="divide-y">
              {users.map((u) => (
                <tr key={u.email}>
                  <td className="px-4 py-2 font-medium text-gray-900">{u.email}</td>
                  <td className="px-4 py-2">
                    <select value={u.role} onChange={(e) => changeRole(u, e.target.value)} disabled={u.email === user.email}
                      className="rounded border border-gray-200 px-2 py-1 text-xs disabled:opacity-60">
                      <option value="viewer">viewer</option>
                      <option value="superadmin">superadmin</option>
                    </select>
                  </td>
                  <td className="px-4 py-2 text-gray-500 hidden sm:table-cell">{u.last_login_at || '—'}</td>
                  <td className="px-4 py-2 text-right">
                    {u.email !== user.email && (
                      <button onClick={() => remove(u)} className="text-red-500 hover:text-red-700" title="Revocar acceso"><Trash2 size={16} /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
