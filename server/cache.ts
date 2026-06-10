/**
 * Cache muy simple en memoria para /api/statistics (la query tarda 8-131s).
 * Un solo contenedor en Railway, así que un Map en proceso basta.
 * Se invalida al terminar normalize/fix-share/fix-budget/upload-db.
 */
let statsCache: any = null;
let statsAt = 0;
const TTL_MS = 5 * 60 * 1000;

export function getCachedStatistics(compute: () => any): any {
  const now = Date.now();
  if (statsCache && now - statsAt < TTL_MS) return statsCache;
  statsCache = compute();
  statsAt = now;
  return statsCache;
}

export function invalidateStatsCache(): void {
  statsCache = null;
  statsAt = 0;
}
