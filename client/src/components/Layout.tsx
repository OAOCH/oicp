import { Link, useLocation } from 'react-router-dom';
import { Search, BookOpen, Trophy, Home, Shield, LogOut } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAuth } from '../lib/auth';

const NAV = [
  { to: '/', label: 'Inicio', icon: Home },
  { to: '/buscar', label: 'Buscar', icon: Search },
  { to: '/rankings', label: 'Rankings', icon: Trophy },
  { to: '/metodologia', label: 'Metodología', icon: BookOpen },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { user, authEnabled, logout } = useAuth();

  return (
    <div className="min-h-screen flex flex-col">
      {/* Disclaimer Banner */}
      <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-center text-xs text-amber-800">
        <strong>AVISO:</strong> Los indicadores son señales analíticas basadas en datos públicos OCDS. No constituyen evidencia de irregularidad.
        Los datos pueden contener errores o no estar actualizados. Consulte las fuentes oficiales de SERCOP para información definitiva.
      </div>

      {/* Header */}
      <header className="bg-white border-b shadow-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-2">
          <Link to="/" className="flex items-center gap-2 font-bold text-brand-700 shrink-0">
            <span className="text-xl">🔍</span>
            <span className="hidden sm:inline">OICP</span>
            <span className="hidden lg:inline text-sm font-normal text-gray-500">
              Observatorio de Integridad de Contratación Pública
            </span>
          </Link>
          <nav className="flex gap-1 items-center">
            {NAV.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors
                  ${pathname === to ? 'bg-brand-50 text-brand-700 font-medium' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                <Icon size={16} />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            ))}
            {user?.role === 'superadmin' && (
              <Link
                to="/admin/usuarios"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors
                  ${pathname.startsWith('/admin') ? 'bg-brand-50 text-brand-700 font-medium' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                <Shield size={16} />
                <span className="hidden sm:inline">Admin</span>
              </Link>
            )}
            {authEnabled && user && (
              <div className="flex items-center gap-2 pl-2 ml-1 border-l">
                <span className="hidden md:inline text-xs text-gray-500 max-w-[160px] truncate" title={user.email}>{user.email}</span>
                <button onClick={logout} title="Cerrar sesión" className="flex items-center gap-1 text-gray-500 hover:text-gray-800 text-sm">
                  <LogOut size={16} />
                </button>
              </div>
            )}
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t bg-white py-6 px-4 mt-auto">
        <div className="max-w-7xl mx-auto text-center text-xs text-gray-500 space-y-2">
          <p>
            OICP — Observatorio de Integridad de Contratación Pública del Ecuador
          </p>
          <p>
            Datos fuente: <a href="https://datosabiertos.compraspublicas.gob.ec" target="_blank" rel="noopener" className="underline">SERCOP Datos Abiertos</a> |
            Estándar: <a href="https://standard.open-contracting.org" target="_blank" rel="noopener" className="underline">OCDS</a> |
            Metodología basada en <a href="https://www.open-contracting.org/resources/red-flags-for-integrity-guide/" target="_blank" rel="noopener" className="underline">OCP Red Flags Guide 2024</a>
          </p>
          <p className="text-gray-400">
            Este sistema NO es una herramienta oficial del gobierno. Los indicadores son referenciales y pueden contener errores.
            No garantizamos la exactitud ni completitud de la información. Use bajo su propia responsabilidad.
          </p>
        </div>
      </footer>
    </div>
  );
}
