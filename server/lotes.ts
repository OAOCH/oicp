/**
 * Lotes de filas para la ingesta por red.
 *
 * `/api/admin/ingest-participaciones` acepta hasta TOPE_LOTE_INGESTA filas por petición. El cliente
 * (`local-sync.ts`) acumulaba filas y empujaba «cuando el búfer pasara de 1 500», pero un solo
 * proceso puede traer cientos de oferentes (las menores cuantías de obras invitan por sorteo a
 * centenares de contratistas): el 5-sep-2026, con 2022 ya descargado, `MCO-GADC-1752UE-2022-2616`
 * llevó el búfer por encima de 2 000, el servidor contestó 400 en los cuatro reintentos, el búfer
 * nunca se vaciaba y cada proceso siguiente volvía a chocar. Un año entero se habría perdido en
 * silencio. Por eso el búfer se parte SIEMPRE en lotes de tamaño fijo, y el tope vive en un solo
 * sitio para que el cliente no pueda volver a superarlo (regla 11).
 */

/** Filas por petición que acepta el servidor. */
export const TOPE_LOTE_INGESTA = 2000;

/** Lote que manda el cliente: por debajo del tope, con margen. */
export const LOTE_PARTICIPACIONES = 1500;

/** Parte `filas` en lotes consecutivos de a lo sumo `max` elementos, en orden y sin perder ninguno. */
export function lotesDe<T>(filas: readonly T[], max: number): T[][] {
  const tam = Math.max(1, Math.floor(max));
  const lotes: T[][] = [];
  for (let i = 0; i < filas.length; i += tam) lotes.push(filas.slice(i, i + tam));
  return lotes;
}
