import { useEffect, useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search as SearchIcon, Filter, ChevronLeft, ChevronRight, ExternalLink, X } from 'lucide-react';
import { api } from '../lib/api';
import { RiskBadge, FlagBadge, Loading, EmptyState } from '../components/UI';
import { formatCurrency, formatDate } from '../lib/flags';

const STATUS_LABELS: Record<string, string> = {
  planning: 'Planificación',
  tender: 'Publicado',
  award: 'Adjudicado',
  contract: 'Contratado',
  complete: 'Finalizado',
  cancelled: 'Cancelado',
  unsuccessful: 'Desierto',
  unknown: 'Sin estado',
};

const STATUS_COLORS: Record<string, string> = {
  planning: 'bg-gray-100 text-gray-700',
  tender: 'bg-blue-100 text-blue-700',
  award: 'bg-green-100 text-green-700',
  contract: 'bg-emerald-100 text-emerald-700',
  complete: 'bg-teal-100 text-teal-700',
  cancelled: 'bg-red-100 text-red-700',
  unsuccessful: 'bg-orange-100 text-orange-700',
  unknown: 'bg-gray-100 text-gray-500',
};

function StatusBadge({ status }: { status: string }) {
  const label = STATUS_LABELS[status] || status;
  const color = STATUS_COLORS[status] || 'bg-gray-100 text-gray-600';
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>{label}</span>;
}

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
  const status = searchParams.get('status') || '';
  const sortBy = searchParams.get('sortBy') || 'score';
  const sortOrder = searchParams.get('sortOrder') || 'DESC';

  const hasActiveFilters = risk || method || flag || year || status;

  const doSearch = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.searchProcedures({ q, page, risk, method, flag, year, status, sortBy, sortOrder });
      setResults(data);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [q, page, risk, method, flag, year, status, sortBy, sortOrder]);

  useEffect(() => { doSearch(); }, [doSearch]);
  useEffect(() => { api.getFilters().then(setFilters).catch(console.error); }, []);

  const updateParam = (key: string, value: string) => {
    const p = new URLSearchParams(searchParams);
    if (value) p.set(key, value); else p.delete(key);
    if (key !== 'page') p.delete('page');
    setSearchParams(p);
  };

  const clearFilters = () => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
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
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border focus:ring-2 focus:ring-brand-500 outline-none" />
        </div>
        <button onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-1.5 px-4 py-2.5 rounded-lg border transition ${showFilters ? 'bg-brand-50 border-brand-300 text-brand-700' : 'hover:bg-gray-50'}`}>
          <Filter size={16} /> Filtros
          {hasActiveFilters && <span className="w-2 h-2 rounded-full bg-brand-500"></span>}
        </button>
      </div>

      {/* Active Filter Chips */}
      {hasActiveFilters && (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-gray-500">Filtros activos:</span>
          {status && (
            <button onClick={() => updateParam('status', '')} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-brand-50 text-brand-700 text-xs font-medium hover:bg-brand-100 transition">
              {STATUS_LABELS[status] || status} <X size={12} />
            </button>
          )}
          {risk && (
            <button onClick={() => updateParam('risk', '')} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-brand-50 text-brand-700 text-xs font-medium hover:bg-brand-100 transition">
              Riesgo: {risk} <X size={12} />
            </button>
          )}
          {year && (
            <button onClick={() => updateParam('year', '')} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-brand-50 text-brand-700 text-xs font-medium hover:bg-brand-100 transition">
              Año: {year} <X size={12} />
            </button>
          )}
          {method && (
            <button onClick={() => updateParam('method', '')} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-brand-50 text-brand-700 text-xs font-medium hover:bg-brand-100 transition">
              Método: {method.substring(0, 25)}... <X size={12} />
            </button>
          )}
          {flag && (
            <button onClick={() => updateParam('flag', '')} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-brand-50 text-brand-700 text-xs font-medium hover:bg-brand-100 transition">
              Bandera: {flag} <X size={12} />
            </button>
          )}
          <button onClick={clearFilters} className="text-xs text-gray-400 hover:text-red-500 transition ml-1">
            Limpiar todos
          </button>
        </div>
      )}

      {/* Filters Panel */}
      {showFilters && (
        <div className="bg-white rounded-lg border p-4 grid sm:grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Estado</label>
            <select value={status} onChange={e => updateParam('status', e.target.value)}
              className="w-full border rounded-lg px-3 py-1.5 text-sm">
              <option value="">Todos</option>
              {filters?.statuses?.map((s: any) => (
                <option key={s.value} value={s.value}>
                  {STATUS_LABELS[s.value] || s.value} ({s.count?.toLocaleString()})
                </option>
              ))}
            </select>
          </div>
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
              {filters?.methods?.slice(0, 30).map((m: string) => (
                <option key={m} value={m}>{m.length > 55 ? m.substring(0, 52) + '...' : m}</option>
              ))}
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
            <label className="text-xs font-medium text-gray-500 mb-1 block">Bandera</label>
            <select value={flag} onChange={e => updateParam('flag', e.target.value)}
              className="w-full border rounded-lg px-3 py-1.5 text-sm">
              <option value="">Todas</option>
              <option value="IC-01">IC-01 Prov. Único</option>
              <option value="IC-02">IC-02 Alto Valor</option>
              <option value="IT-01">IT-01 Plazo Insuf.</option>
              <option value="IT-02">IT-02 Adj. Relámpago</option>
              <option value="IP-01">IP-01 Cerca Umbral</option>
              <option value="IP-02">IP-02 Dif. Precio</option>
              <option value="IP-03">IP-03 Mod. Contract.</option>
              <option value="CC-01">CC-01 Prov. Recurr.</option>
              <option value="CC-02">CC-02 Prov. Domin.</option>
              <option value="CC-03">CC-03 Prov. Perman.</option>
              <option value="CC-05">CC-05 Fraccion.</option>
              <option value="TR-01">TR-01 Info Incompl.</option>
              <option value="TR-02">TR-02 Desc. Genér.</option>
              <option value="TR-03">TR-03 Sin Justif.</option>
            </select>
          </div>
        </div>
      )}

      {/* Sort + Count */}
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
        <div className="space-y-2">
          {results.procedures.map((p: any) => (
            <Link key={p.id} to={`/proceso/${encodeURIComponent(p.id)}`}
              className="block bg-white rounded-lg border p-4 hover:border-brand-300 hover:shadow-sm transition">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <RiskBadge level={p.risk_level} />
                    {p.status && <StatusBadge status={p.status} />}
                    <span className="text-xs text-gray-400 font-mono truncate">{
                      (p.procurement_method_details || '').length > 50
                        ? (p.procurement_method_details || '').substring(0, 47) + '...'
                        : p.procurement_method_details
                    }</span>
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
                <div className="text-center shrink-0">
                  <div className="text-2xl font-bold" style={{ color: p.score > 60 ? '#ef4444' : p.score > 30 ? '#f97316' : p.score > 10 ? '#eab308' : '#22c55e' }}>
                    {p.score}
                  </div>
                  <div className="text-xs text-gray-400">score</div>
                  <a href={`https://datosabiertos.compraspublicas.gob.ec/PLATAFORMA/api/record?ocid=${encodeURIComponent(p.ocid || p.id || '')}`}
                    target="_blank" rel="noopener"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 mt-1"
                    title="Ver registro OCDS oficial">
                    OCDS <ExternalLink size={10} />
                  </a>
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
            Página {page} de {results.totalPages.toLocaleString()}
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
