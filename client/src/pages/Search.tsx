import { useEffect, useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search as SearchIcon, Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../lib/api';
import { RiskBadge, FlagBadge, Loading, EmptyState } from '../components/UI';
import { formatCurrency, formatDate } from '../lib/flags';

export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [results, setResults] = useState<any>(null);
  const [filters, setFilters] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const q = searchParams.get('q') || '';
  const page = Number(searchParams.get('page')) || 1;
  const risk = searchParams.get('risk') || '';
  const method = searchParams.get('method') || '';
  const flag = searchParams.get('flag') || '';
  const year = searchParams.get('year') || '';
  const sortBy = searchParams.get('sortBy') || 'score';
  const sortOrder = searchParams.get('sortOrder') || 'DESC';

  const doSearch = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.searchProcedures({ q, page, risk, method, flag, year, sortBy, sortOrder });
      setResults(data);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [q, page, risk, method, flag, year, sortBy, sortOrder]);

  useEffect(() => { doSearch(); }, [doSearch]);
  useEffect(() => { api.getFilters().then(setFilters).catch(console.error); }, []);

  const updateParam = (key: string, value: string) => {
    const p = new URLSearchParams(searchParams);
    if (value) p.set(key, value); else p.delete(key);
    if (key !== 'page') p.delete('page');
    setSearchParams(p);
  };

  return (
    <div className="space-y-4">
      <h1>Buscar Procedimientos</h1>

      {/* Search Bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input value={q}
            onChange={e => updateParam('q', e.target.value)}
            placeholder="Entidad, proveedor, OCID, palabra clave..."
            className="w-full pl-10 pr-4 py-2 rounded-lg border focus:ring-2 focus:ring-brand-500 outline-none" />
        </div>
        <button onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-1 px-4 py-2 rounded-lg border transition ${showFilters ? 'bg-brand-50 border-brand-300 text-brand-700' : 'hover:bg-gray-50'}`}>
          <Filter size={16} /> Filtros
        </button>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div className="bg-white rounded-lg border p-4 grid sm:grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Nivel de Riesgo</label>
            <select value={risk} onChange={e => updateParam('risk', e.target.value)}
              className="w-full border rounded-lg px-3 py-1.5 text-sm">
              <option value="">Todos</option>
              <option value="critical">Crítico</option>
              <option value="high">Alto</option>
              <option value="moderate">Moderado</option>
              <option value="low">Bajo</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Método</label>
            <select value={method} onChange={e => updateParam('method', e.target.value)}
              className="w-full border rounded-lg px-3 py-1.5 text-sm">
              <option value="">Todos</option>
              {filters?.methods?.map((m: string) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Año</label>
            <select value={year} onChange={e => updateParam('year', e.target.value)}
              className="w-full border rounded-lg px-3 py-1.5 text-sm">
              <option value="">Todos</option>
              {filters?.years?.map((y: number) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Bandera Específica</label>
            <select value={flag} onChange={e => updateParam('flag', e.target.value)}
              className="w-full border rounded-lg px-3 py-1.5 text-sm">
              <option value="">Todas</option>
              <option value="IC-01">IC-01 Proveedor Único</option>
              <option value="IC-02">IC-02 Alto Valor Sin Competencia</option>
              <option value="IT-01">IT-01 Plazo Insuficiente</option>
              <option value="IT-02">IT-02 Adjudicación Relámpago</option>
              <option value="IP-01">IP-01 Valor Cerca del Umbral</option>
              <option value="IP-02">IP-02 Diferencia Precio</option>
              <option value="IP-03">IP-03 Modificación Contractual</option>
              <option value="CC-01">CC-01 Proveedor Recurrente</option>
              <option value="CC-02">CC-02 Proveedor Dominante</option>
              <option value="CC-03">CC-03 Proveedor Permanente</option>
              <option value="CC-05">CC-05 Fraccionamiento</option>
              <option value="TR-01">TR-01 Info Incompleta</option>
              <option value="TR-02">TR-02 Descripción Genérica</option>
              <option value="TR-03">TR-03 Sin Justificación RE</option>
            </select>
          </div>
        </div>
      )}

      {/* Sort */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {results ? `${results.total.toLocaleString()} resultado${results.total !== 1 ? 's' : ''}` : ''}
        </p>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-500">Ordenar:</span>
          <select value={`${sortBy}-${sortOrder}`} onChange={e => {
            const [s, o] = e.target.value.split('-');
            updateParam('sortBy', s); updateParam('sortOrder', o);
          }} className="border rounded px-2 py-1">
            <option value="score-DESC">Mayor riesgo</option>
            <option value="score-ASC">Menor riesgo</option>
            <option value="award_amount-DESC">Mayor monto</option>
            <option value="published_date-DESC">Más recientes</option>
          </select>
        </div>
      </div>

      {/* Results */}
      {loading ? <Loading /> : !results?.procedures?.length ? <EmptyState /> : (
        <div className="space-y-3">
          {results.procedures.map((p: any) => (
            <Link key={p.id} to={`/proceso/${encodeURIComponent(p.id)}`}
              className="block bg-white rounded-lg border p-4 hover:border-brand-300 hover:shadow-sm transition">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <RiskBadge level={p.risk_level} />
                    <span className="text-xs text-gray-400 font-mono">{p.procurement_method_details}</span>
                  </div>
                  <h3 className="font-medium text-brand-700 line-clamp-1">{p.title || p.id}</h3>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {p.buyer_name || 'Comprador desconocido'} · {formatDate(p.published_date)} · {formatCurrency(p.award_amount)}
                  </p>
                  {p.flags?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {p.flags.filter((f: any) => f.active).slice(0, 4).map((f: any) => (
                        <FlagBadge key={f.code} flag={f} />
                      ))}
                      {p.flags.filter((f: any) => f.active).length > 4 && (
                        <span className="text-xs text-gray-400 self-center">+{p.flags.filter((f: any) => f.active).length - 4} más</span>
                      )}
                    </div>
                  )}
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold" style={{ color: p.score > 60 ? '#ef4444' : p.score > 30 ? '#f97316' : p.score > 10 ? '#eab308' : '#22c55e' }}>
                    {p.score}
                  </div>
                  <div className="text-xs text-gray-400">score</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Pagination */}
      {results && results.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 py-4">
          <button onClick={() => updateParam('page', String(page - 1))} disabled={page <= 1}
            className="flex items-center gap-1 px-3 py-1.5 rounded border text-sm disabled:opacity-30 hover:bg-gray-50">
            <ChevronLeft size={16} /> Anterior
          </button>
          <span className="text-sm text-gray-500">
            Página {page} de {results.totalPages}
          </span>
          <button onClick={() => updateParam('page', String(page + 1))} disabled={page >= results.totalPages}
            className="flex items-center gap-1 px-3 py-1.5 rounded border text-sm disabled:opacity-30 hover:bg-gray-50">
            Siguiente <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
