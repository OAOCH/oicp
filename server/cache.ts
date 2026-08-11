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
}
