/**
 * UNA sola definición de la medición del presupuesto referencial (regla 11), compartida por
 * db.ts (web: /api/version y el pie de página) y mcp-server.ts (oicp_methodology).
 *
 * Vive en un módulo puro porque mcp-server no puede importar db.js (abre la base real al
 * importarse y el MCP trabaja con una conexión inyectada), y antes cada lado tenía su copia
 * del mismo SELECT con SUM(CASE typeof(budget_amount)...) sobre procedures: un recorrido de
 * las 1,47 M filas completas que congelaba la plataforma 16 a 28 s cada vez que vencía la
 * caché de 5 minutos (medido en producción el 1-sep-2026). Las tres consultas de aquí se
 * resuelven por índice: dos parciales (budget_amount IS NULL y typeof = 'text') creados en
 * migrate(), y COUNT(*) sobre el índice de cobertura más chico. La prueba
 * estado-presupuesto.test.ts hace EXPLAIN QUERY PLAN sobre estas mismas cadenas.
 */
export const SQL_PRESUPUESTO_TOTAL = `SELECT COUNT(*) AS n FROM procedures`;
export const SQL_PRESUPUESTO_PENDIENTES = `SELECT COUNT(*) AS n FROM procedures WHERE typeof(budget_amount) = 'text'`;
export const SQL_PRESUPUESTO_SIN_DATO = `SELECT COUNT(*) AS n FROM procedures WHERE budget_amount IS NULL`;

export type EstadoPresupuesto = { total: number; pendientes: number; sin_dato: number; con_dato: number };

/** Ejecuta las tres consultas sobre la conexión que se le dé. Sin caché: eso lo pone cada lado. */
export function medirPresupuesto(db: { prepare: (sql: string) => { get: () => any } }): EstadoPresupuesto {
  const total = Number(db.prepare(SQL_PRESUPUESTO_TOTAL).get()?.n || 0);
  const pendientes = Number(db.prepare(SQL_PRESUPUESTO_PENDIENTES).get()?.n || 0);
  const sin_dato = Number(db.prepare(SQL_PRESUPUESTO_SIN_DATO).get()?.n || 0);
  return { total, pendientes, sin_dato, con_dato: total - pendientes - sin_dato };
}
