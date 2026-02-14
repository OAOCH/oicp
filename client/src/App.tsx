import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Search from './pages/Search';
import ProcedureDetail from './pages/ProcedureDetail';
import BuyerProfile from './pages/BuyerProfile';
import SupplierProfile from './pages/SupplierProfile';
import Methodology from './pages/Methodology';
import Rankings from './pages/Rankings';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/buscar" element={<Search />} />
        <Route path="/proceso/:id" element={<ProcedureDetail />} />
        <Route path="/comprador/:id" element={<BuyerProfile />} />
        <Route path="/proveedor/:id" element={<SupplierProfile />} />
        <Route path="/metodologia" element={<Methodology />} />
        <Route path="/rankings" element={<Rankings />} />
      </Routes>
    </Layout>
  );
}
