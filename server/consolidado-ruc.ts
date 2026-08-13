/**
 * Contexto consolidado por RUC para el perfil del comprador.
 *
 * Decisión de Oscar (13-ago-2026, opciones 1+2 y NO la 3): el mismo RUC aparece como
 * VARIOS compradores (uno por unidad de compra, más un formato «pelado» sin sufijo que
 * viene de la vía del catálogo), así que quien mira UNA unidad no ve la institución
 * completa. El perfil publica el contexto consolidado por RUC SIN tocar banderas ni
 * scores: las CC-* siguen midiendo por unidad de compra (buyer_id), que es quien decide
 * la contratación, y esa limitación se declara en la metodología.
 *
 * Vive en su propio módulo (regla 11: UNA definición) porque lo comparten db.ts (web) y
 * mcp-server.ts (MCP), y mcp-server NO puede importar db.js: db.js abre la base real al
 * importarse, y tanto el MCP como sus pruebas trabajan con una conexión inyectada.
 *
 * Los totales salen de a_buyers (tabla chica, ~7 mil filas, cálculo al vuelo): es un
 * agregado EXISTENTE con mantenimiento incremental ya cableado y controlado por la
 * boleta, así que aquí no se crea ningún agregado nuevo ni hace falta recálculo.
 */
import type Database from 'better-sqlite3';

/**
 * Los 13 dígitos del RUC dentro de un buyer_id, o null si el formato no es el del RUC.
 *
 * Son los 13 PRIMEROS dígitos tras 'EC-RUC-', sin exigir guion después: el sufijo de
 * unidad puede venir PEGADO al RUC (medido en producción el 13-ago-2026: 337
 * compradores así, con 11.035 procesos y $406,5 M; p. ej.
 * 'EC-RUC-17681528000014-240717' es una unidad de CNT, RUC 1768152800001). Un RUC
 * tiene SIEMPRE 13 dígitos, no existe de 14, así que lo que sigue es la unidad. Una
 * versión que exigía guion tras los 13 dígitos dejaba esos $406 M fuera del
 * consolidado y lo publicaba como si fuera completo.
 *
 * Con MENOS de 13 dígitos no hay RUC, y hay buyer_id sin formato RUC ('EC-' + nombre
 * truncado, generados por la ingesta cuando la fuente no trae id): para esos no hay
 * consolidado, y se responde null en vez de inventarlo.
 */
export function rucDeBuyerId(buyerId: string): string | null {
  const m = /^EC-RUC-(\d{13})/.exec(buyerId || '');
  return m ? m[1] : null;
}

export interface ConsolidadoRuc {
  unidades_de_compra: number | null;
  consolidado_ruc: { ruc: string; n_procs: number; total_usd: number } | null;
}

const SIN_CONSOLIDADO: ConsolidadoRuc = { unidades_de_compra: null, consolidado_ruc: null };

export function consolidadoPorRuc(db: Database.Database, buyerId: string): ConsolidadoRuc {
  const ruc = rucDeBuyerId(buyerId);
  if (!ruc) return SIN_CONSOLIDADO;
  // Sin agregados no hay total exacto que ofrecer: mejor un perfil sin consolidado que
  // un total falso (mismo criterio que getSupplierProfile).
  const hay = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='a_buyers'`).get();
  if (!hay) return SIN_CONSOLIDADO;
  // Por PREFIJO, sin exigir guion: captura la unidad pelada, las '-NNN' y las pegadas
  // (ver rucDeBuyerId). El patrón es seguro contra comodines: ruc son \d{13}.
  const row = db.prepare(`
    SELECT COUNT(*) AS unidades,
           COALESCE(SUM(n_procs), 0) AS n_procs,
           COALESCE(SUM(total_usd), 0) AS total_usd
    FROM a_buyers WHERE buyer_id LIKE ?
  `).get(`EC-RUC-${ruc}%`) as any;
  if (!row || !row.unidades) return SIN_CONSOLIDADO;
  return {
    unidades_de_compra: row.unidades,
    consolidado_ruc: { ruc, n_procs: row.n_procs, total_usd: row.total_usd },
  };
}
