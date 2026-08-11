/**
 * Cache en memoria para /api/statistics. Un solo contenedor en Railway, así que un
 * contenedor en proceso basta.
 *
 * Política: stale-while-revalidate. El único cómputo SÍNCRONO posible es la primera
 * petición tras un arranque en frío; a partir de ahí, cuando el caché vence se sirve el
 * valor viejo al instante y el recálculo ocurre en segundo plano (setImmediate), fuera del
 * camino de la respuesta. Así ninguna petición del usuario vuelve a quedarse esperando el
 * cómputo, que antes bloqueaba el único hilo de Node (medido en 8-131 s) e incluso dejaba
 * sin responder /api/health.
 */
let statsCache: any = null;
let statsAt = 0;
let refreshing = false;
const TTL_MS = 5 * 60 * 1000;

export function getCachedStatistics(compute: () => any): any {
  const now = Date.now();
  if (statsCache && now - statsAt < TTL_MS) return statsCache;

  if (statsCache) {
    // Vencido pero disponible: se devuelve el valor viejo y se refresca en segundo plano.
    if (!refreshing) {
      refreshing = true;
      setImmediate(() => {
        try { statsCache = compute(); statsAt = Date.now(); }
        catch { /* se conserva el valor anterior hasta el próximo intento */ }
        finally { refreshing = false; }
      });
    }
    return statsCache;
  }

  // Arranque en frío: no hay nada que servir, se computa una vez.
  statsCache = compute();
  statsAt = now;
  return statsCache;
}

export function invalidateStatsCache(): void {
  statsCache = null;
  statsAt = 0;
  entradas.clear();
}

// ── Caché con clave, misma política ──────────────────────────
// Para las consultas que también recorren `procedures` en el camino de la petición y no
// tienen agregado equivalente: los rankings (GROUP BY buyer_id con AVG y MAX sobre 1,47 M
// filas) y las opciones de filtro (tres SELECT DISTINCT sobre la tabla completa). Sin esto,
// cada carga de la página de Rankings o cada apertura del panel de filtros bloqueaba el
// hilo varios segundos.
const entradas = new Map<string, { valor: any; en: number; refrescando: boolean }>();

export function getCached<T>(clave: string, compute: () => T, ttlMs = TTL_MS): T {
  const now = Date.now();
  const e = entradas.get(clave);
  if (e && now - e.en < ttlMs) return e.valor;

  if (e) {
    if (!e.refrescando) {
      e.refrescando = true;
      setImmediate(() => {
        try { e.valor = compute(); e.en = Date.now(); }
        catch { /* se conserva el valor anterior */ }
        finally { e.refrescando = false; }
      });
    }
    return e.valor;
  }
  const valor = compute();
  entradas.set(clave, { valor, en: now, refrescando: false });
  return valor;
}
