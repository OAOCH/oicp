const BASE = '/api';

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(`${BASE}${url}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export const api = {
  getStatistics: () => fetchJson<any>('/statistics'),
  searchProcedures: (params: Record<string, any>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '' && v !== null) qs.set(k, String(v));
    }
    return fetchJson<any>(`/procedures?${qs}`);
  },
  getProcedure: (id: string) => fetchJson<any>(`/procedures/${encodeURIComponent(id)}`),
  getBuyer: (id: string) => fetchJson<any>(`/buyers/${encodeURIComponent(id)}`),
  getSupplier: (id: string) => fetchJson<any>(`/suppliers/${encodeURIComponent(id)}`),
  getRankings: (type: string, year?: number) => {
    const qs = year ? `?type=${type}&year=${year}` : `?type=${type}`;
    return fetchJson<any>(`/rankings${qs}`);
  },
  getFilters: () => fetchJson<any>('/filters'),
  getMethodology: () => fetchJson<any>('/methodology'),
};
