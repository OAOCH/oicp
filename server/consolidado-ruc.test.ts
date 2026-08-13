/**
 * Contexto consolidado por RUC en el perfil del comprador (decisión de Oscar,
 * 13-ago-2026: opciones 1+2, NO la 3).
 *
 * Por qué existe: el mismo RUC aparece como VARIOS compradores (uno por unidad de
 * compra, más un formato «pelado» sin sufijo que viene de la vía del catálogo).
 * Verificado con el Cuerpo de Bomberos de Quito: EC-RUC-1768097950001-2525 y
 * EC-RUC-1768097950001. Quien mira UNA unidad no ve la institución completa. El
 * perfil publica el contexto consolidado SIN tocar banderas ni scores.
 *
 * Trampas que estas pruebas fijan:
 *  - El sufijo de unidad puede venir PEGADO al RUC, sin guion. Medido en producción
 *    el 13-ago-2026: 337 compradores con ese formato, 11.035 procesos y $406,5 M
 *    (p. ej. 'EC-RUC-17681528000014-240717' y 'EC-RUC-176815280000114-394030' son
 *    unidades de CNT, RUC 1768152800001). Un diseño que exigiera guion tras los 13
 *    dígitos los dejaría fuera y publicaría un total institucional INCOMPLETO como
 *    si fuera completo. El RUC son SIEMPRE los 13 primeros dígitos: no existe RUC de
 *    14, así que el resto es la unidad pegada.
 *  - Hay buyer_id que NO empiezan por EC-RUC- (formato EC- + nombre truncado que la
 *    ingesta genera cuando la fuente no trae id) y otros con MENOS de 13 dígitos:
 *    consolidado null, no inventado.
 *  - Los totales salen de a_buyers, que ya aplica la regla de plausibilidad del
 *    monto: el consolidado no puede resucitar un contract_amount absurdo.
 *  - Web (getBuyerProfile) y MCP (oicp_buyer_profile) publican cifras IDÉNTICAS
 *    (regla 11).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'oicp-consolidado-'));
process.env.DB_PATH = path.join(TMP, 'prueba.db');
process.env.JWT_SECRET = '';

const { migrate, getDb, upsertProcedure, getBuyerProfile } = await import('./db.js');
const { buildAnalytics, callTool } = await import('./mcp-server.js');

const RUC = '1768097950001';
const UNIDAD_A = `EC-RUC-${RUC}-2525`;        // unidad de compra con guion
const UNIDAD_B = `EC-RUC-${RUC}`;             // formato «pelado» (vía catálogo)
const UNIDAD_PEGADA = `EC-RUC-${RUC}9`;       // sufijo de unidad PEGADO, sin guion
const SIN_RUC = 'EC-CUERPO-DE-BOMBEROS-TRUN'; // ingesta sin id: EC- + nombre truncado
const RUC_CORTO = 'EC-RUC-176809795000';      // 12 dígitos: no es un RUC

const AWARD = 100;
let secuencia = 0;
function proceso(buyerId: string, nombre: string, monto: number, extra: any = {}) {
  const i = secuencia++;
  upsertProcedure({
    id: `proc-${i}`, ocid: `ocds-x-${i}`, title: `Proceso ${i}`,
    description: `Objeto del proceso numero ${i} con texto suficiente`,
    status: 'complete',
    procurement_method: 'open', procurement_method_details: 'Subasta Inversa Electronica',
    buyer_id: buyerId, buyer_name: nombre,
    budget_amount: monto, award_amount: monto,
    contract_amount: monto, final_amount: null,
    published_date: `${2019 + (i % 8)}-06-15T12:00:00-05:00`,
    suppliers: [{ id: `EC-RUC-179073265700${i % 2}-1`, name: `PROVEEDOR ${i % 2}` }],
    number_of_tenderers: 2, flags: [], score: 0, risk_level: 'low',
    source_year: 2019 + (i % 8), regime: 'LOSNCP',
    ...extra,
  });
}

test('preparación: tres unidades del mismo RUC (una pegada), un buyer sin RUC y uno de 12 dígitos', () => {
  migrate();
  // Unidad A: 3 procesos de $100. El primero trae un contract_amount 500x el
  // adjudicado: la regla de plausibilidad manda usar el adjudicado.
  proceso(UNIDAD_A, 'CUERPO DE BOMBEROS DMQ UNIDAD 2525', AWARD, { contract_amount: AWARD * 500 });
  proceso(UNIDAD_A, 'CUERPO DE BOMBEROS DMQ UNIDAD 2525', AWARD);
  proceso(UNIDAD_A, 'CUERPO DE BOMBEROS DMQ UNIDAD 2525', AWARD);
  // Unidad B («pelada»): 2 procesos de $50.
  proceso(UNIDAD_B, 'CUERPO DE BOMBEROS DMQ', 50);
  proceso(UNIDAD_B, 'CUERPO DE BOMBEROS DMQ', 50);
  // Unidad con el sufijo pegado (formato real medido en producción): $1.000.000 que
  // SÍ pertenecen a la institución y DEBEN entrar al consolidado.
  proceso(UNIDAD_PEGADA, 'CUERPO DE BOMBEROS DMQ UNIDAD 9', 1_000_000);
  // Sin formato RUC: 1 proceso de $77.
  proceso(SIN_RUC, 'CUERPO DE BOMBEROS TRUNCADO', 77);
  // 12 dígitos: no es un RUC, no debe consolidar con nada.
  proceso(RUC_CORTO, 'ENTIDAD CON ID DE 12 DIGITOS', 33);

  const n = (getDb().prepare('SELECT COUNT(*) AS n FROM procedures').get() as any).n;
  assert.equal(n, 8);
  buildAnalytics(getDb());
  const buyers = (getDb().prepare('SELECT COUNT(*) AS n FROM a_buyers').get() as any).n;
  assert.equal(buyers, 5, 'a_buyers debe tener los cinco compradores');
});

test('el perfil de una unidad publica cuántas unidades tiene el RUC y el total institucional', () => {
  const p: any = getBuyerProfile(UNIDAD_A);
  assert.ok(p, 'debe encontrar la unidad A');
  assert.equal(p.unidades_de_compra, 3,
    'el RUC tiene TRES unidades: la 2525, la pelada y la del sufijo pegado sin guion');
  assert.ok(p.consolidado_ruc, 'debe publicar el consolidado');
  assert.equal(p.consolidado_ruc.n_procs, 6, '3 de la A + 2 de la B + 1 de la pegada');
  assert.equal(Math.round(p.consolidado_ruc.total_usd), 1_000_400,
    '3x$100 + 2x$50 + $1M de la unidad pegada; el contract_amount absurdo no cuenta');
});

test('la unidad con sufijo pegado consolida con su institución, no queda huérfana', () => {
  const p: any = getBuyerProfile(UNIDAD_PEGADA);
  assert.ok(p, 'debe encontrar la unidad pegada');
  assert.equal(p.unidades_de_compra, 3,
    'formato real de producción (337 compradores, $406,5 M medidos el 13-ago-2026): excluirlo publicaría un consolidado incompleto');
  assert.equal(p.consolidado_ruc.n_procs, 6);
  assert.equal(Math.round(p.consolidado_ruc.total_usd), 1_000_400);
});

test('el consolidado es el mismo desde cualquiera de las unidades', () => {
  const a: any = getBuyerProfile(UNIDAD_A);
  const b: any = getBuyerProfile(UNIDAD_B);
  assert.equal(a.unidades_de_compra, b.unidades_de_compra);
  assert.equal(a.consolidado_ruc.n_procs, b.consolidado_ruc.n_procs);
  assert.equal(a.consolidado_ruc.total_usd, b.consolidado_ruc.total_usd);
});

test('un buyer_id sin formato EC-RUC- lleva consolidado null, no basura', () => {
  const p: any = getBuyerProfile(SIN_RUC);
  assert.ok(p, 'debe encontrar el comprador sin RUC');
  assert.equal(p.unidades_de_compra, null);
  assert.equal(p.consolidado_ruc, null);
});

test('un buyer_id con menos de 13 dígitos no es un RUC: consolidado null', () => {
  const p: any = getBuyerProfile(RUC_CORTO);
  assert.ok(p, 'debe encontrar el comprador de 12 dígitos');
  assert.equal(p.unidades_de_compra, null);
  assert.equal(p.consolidado_ruc, null);
});

test('el MCP publica el MISMO consolidado que la web (regla 11)', () => {
  const web: any = getBuyerProfile(UNIDAD_A);
  const mcp: any = callTool(getDb(), 'oicp_buyer_profile', { query: UNIDAD_A });
  assert.ok(!mcp.error, `el MCP debe encontrar la unidad A: ${mcp.error || ''}`);
  assert.equal(mcp.unidades_de_compra, web.unidades_de_compra);
  assert.equal(mcp.consolidado_ruc.n_procs, web.consolidado_ruc.n_procs);
  assert.equal(mcp.consolidado_ruc.total_usd, web.consolidado_ruc.total_usd);
});
