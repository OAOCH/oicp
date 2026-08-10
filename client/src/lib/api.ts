const BASE = '/api';

/** Error de API que conserva el código HTTP para que la interfaz distinga
 *  "no existe" (404) de "el servicio falló" (500/502/red). Antes cualquier
 *  fallo se mostraba como "no encontrado" o como "0 resultados", haciendo
 *  parecer vacía a la base cuando en realidad el servidor no respondía. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
  get esNoEncontrado() { return this.status === 404; }
  /** Mensaje en español, listo para mostrar al usuario. */
  get mensajeUsuario() {
    if (this.status === 404) return 'No encontramos este registro.';
    if (this.status === 0) return 'No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.';
    if (this.status === 429) return 'Demasiadas consultas seguidas. Espera un momento e intenta de nuevo.';
    if (this.status >= 500) return 'El servicio no está disponible en este momento. Intenta de nuevo en unos minutos.';
    return 'No pudimos completar la consulta. Intenta de nuevo.';
  }
}

/** Traduce cualquier error a un mensaje presentable (sin jerga técnica). */
export function mensajeDeError(e: unknown): string {
  if (e instanceof ApiError) return e.mensajeUsuario;
  return 'No pudimos completar la consulta. Intenta de nuevo.';
}

async function fetchJson<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${url}`, { credentials: 'include' });
  } catch {
    throw new ApiError(0, 'Sin conexión con el servidor'); // red caída / servidor inalcanzable
  }
  if (res.status === 401) {
    // Sesión expirada o ausente con auth activada: al login.
    if (window.location.pathname !== '/login') window.location.href = '/login';
    throw new ApiError(401, 'No autenticado');
  }
  if (!res.ok) throw new ApiError(res.status, `API error: ${res.status}`);
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
};
