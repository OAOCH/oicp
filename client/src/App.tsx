import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Search from './pages/Search';
import ProcedureDetail from './pages/ProcedureDetail';
import BuyerProfile from './pages/BuyerProfile';
import SupplierProfile from './pages/SupplierProfile';
import Methodology from './pages/Methodology';
import Rankings from './pages/Rankings';
import Login from './pages/Login';
import AdminUsers from './pages/AdminUsers';
import AdminAudit from './pages/AdminAudit';
import { useAuth } from './lib/auth';

function FullScreenLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-brand-600 border-t-transparent" />
    </div>
  );
}

export default function App() {
  const { loading, user, authEnabled } = useAuth();
  const location = useLocation();

  // Mientras se resuelve la sesión, no parpadear.
  if (loading) return <FullScreenLoading />;

  // Con auth activada, todo exige sesión salvo la propia pantalla de login.
  if (authEnabled && !user && location.pathname !== '/login') {
    return <Navigate to="/login" replace />;
  }
  // Si ya hay sesión y el usuario va a /login, mándalo al inicio.
  if (user && location.pathname === '/login') {
    return <Navigate to="/" replace />;
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/*"
        element={
          <Layout>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/buscar" element={<Search />} />
              <Route path="/proceso/:id" element={<ProcedureDetail />} />
              <Route path="/comprador/:id" element={<BuyerProfile />} />
              <Route path="/proveedor/:id" element={<SupplierProfile />} />
              <Route path="/metodologia" element={<Methodology />} />
              <Route path="/rankings" element={<Rankings />} />
              <Route path="/admin/usuarios" element={<AdminUsers />} />
              <Route path="/admin/auditoria" element={<AdminAudit />} />
            </Routes>
          </Layout>
        }
      />
    </Routes>
  );
}
