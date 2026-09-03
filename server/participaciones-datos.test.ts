/**
 * Capa de datos de los oferentes: tabla `participaciones`, agregado `a_participantes`,
 * herramienta MCP `oicp_oferentes` y el control de la boleta.
 *
 * Por qué existe: la pregunta de negocio es «¿qué empresas participan muchas veces y nunca
 * ganan, y frente a QUIÉN pierden?» (oferentes de acompañamiento). Estas pruebas fijan que
 * la carga es idempotente, que el agregado cuenta bien y encuentra al ganador frecuente,
 * que el MCP publica lo mismo que la tabla, y que la boleta grita si el agregado se
 * desfasa (trampa 0b del proyecto: todo agregado nuevo necesita su control).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'oicp-particip-'));
process.env.DB_PATH = path.join(TMP, 'prueba.db');
process.env.JWT_SECRET = '';

const { migrate, getDb, upsertProcedure, upsertParticipaciones } = await import('./db.js');
const { buildAnalytics, callTool } = await import('./mcp-server.js');
const { verificarAnio } = await import('./verificar-anio.js');

const COMPRADOR = 'EC-RUC-1760000000001-99';
const A = { id: 'EC-RUC-1790000000001-10', ruc10: '1790000000', nombre: 'A S.A.' };
const B = { id: 'EC-RUC-0990000000001-11', ruc10: '0990000000', nombre: 'B S.A.' };
const C = { id: 'EC-RUC-0190000000001-12', ruc10: '0190000000', nombre: 'C S.A.' };

function proceso(i: number, ganador: { id: string; nombre: string }) {
  upsertProcedure({
    id: `proc-${i}`, ocid: `proc-${i}`, title: `Proceso ${i}`, description: `Objeto del proceso ${i} con texto`,
    status: 'complete', procurement_method: 'open', procurement_method_details: 'Subasta Inversa Electronica',
    buyer_id: COMPRADOR, buyer_name: 'ENTIDAD', budget_amount: 1000, award_amount: 900, contract_amount: 900,
    final_amount: null, published_date: '2024-06-15T12:00:00-05:00',
    suppliers: [{ id: ganador.id, name: ganador.nombre }], number_of_tenderers: 2, flags: [], score: 0,
    risk_level: 'low', source_year: 2024, regime: 'LOSNCP',
  });
}
const fila = (ocid: string, o: typeof A, gano: 0 | 1, puja: number | null) => ({
  ocid, buyer_id: COMPRADOR, source_year: 2024, oferente_id: o.id, ruc10: o.ruc10, nombre: o.nombre,
  gano, n_pujas: puja === null ? 0 : 1, puja_min: puja, puja_ultima: puja === null ? null : '2024-06-15T10:00:00-05:00',
});

// Tres subastas: B pierde dos veces frente a A y gana una frente a C.
const FILAS = [
  fila('proc-1', A, 1, 900), fila('proc-1', B, 0, 950),
  fila('proc-2', A, 1, 800), fila('proc-2', B, 0, 820),
  fila('proc-3', B, 1, 700), fila('proc-3', C, 0, 750),
];

test('preparación: tres procesos y sus participaciones; la carga es idempotente', () => {
  migrate();
  proceso(1, A); proceso(2, A); proceso(3, B);
  const r1 = upsertParticipaciones(FILAS);
  assert.equal(r1.insertadas, 6);
  const r2 = upsertParticipaciones(FILAS);
  assert.equal((getDb().prepare('SELECT COUNT(*) AS n FROM participaciones').get() as any).n, 6,
    'cargar dos veces lo mismo no duplica filas');
  assert.ok(r2, 'la segunda carga responde igual sin fallar');
});

test('el agregado cuenta participaciones, ganadas y perdidas, y encuentra al ganador frecuente', () => {
  buildAnalytics(getDb());
  const b = getDb().prepare(`SELECT * FROM a_participantes WHERE ruc10 = ?`).get(B.ruc10) as any;
  assert.ok(b, 'B debe estar en a_participantes');
  assert.equal(b.n_particip, 3);
  assert.equal(b.n_ganadas, 1);
  assert.equal(b.n_perdidas, 2);
  assert.equal(b.ganador_frecuente_ruc10, A.ruc10, 'B pierde dos veces frente a A');
  assert.equal(b.n_frente_ganador, 2);
  const a = getDb().prepare(`SELECT * FROM a_participantes WHERE ruc10 = ?`).get(A.ruc10) as any;
  assert.equal(a.n_particip, 2);
  assert.equal(a.n_perdidas, 0);
  assert.equal(a.ganador_frecuente_ruc10, null, 'A nunca perdió: no tiene ganador frecuente');
});

test('oicp_oferentes por nombre publica el perfil con las mismas cifras del agregado', () => {
  const r: any = callTool(getDb(), 'oicp_oferentes', { query: 'B S.A.' });
  assert.ok(!r.error, r.error);
  assert.equal(r.ruc10, B.ruc10);
  assert.equal(r.n_particip, 3);
  assert.equal(r.n_perdidas, 2);
  assert.equal(r.ganador_frecuente?.ruc10, A.ruc10);
  assert.equal(r.ganador_frecuente?.n, 2);
  assert.ok(Array.isArray(r.perdidas_recientes) && r.perdidas_recientes.length === 2, 'lista las dos derrotas');
  assert.equal(r.perdidas_recientes[0].ganador_nombre, A.nombre);
  assert.ok(r.disclaimer, 'siempre con disclaimer');
});

test('oicp_oferentes sin query devuelve el ranking de quienes más pierden, con piso de participaciones', () => {
  const r: any = callTool(getDb(), 'oicp_oferentes', { min_participaciones: 3 });
  assert.ok(!r.error, r.error);
  assert.equal(r.ranking.length, 1, 'solo B alcanza el piso de 3 participaciones');
  assert.equal(r.ranking[0].ruc10, B.ruc10);
  const r2: any = callTool(getDb(), 'oicp_oferentes', { min_participaciones: 2 });
  assert.deepEqual(r2.ranking.map((x: any) => x.ruc10), [B.ruc10, A.ruc10], 'ordenado por derrotas, A con cero');
});

test('oicp_sql: participaciones se consulta por columna indexada y se rechaza sin filtro', () => {
  const ok: any = callTool(getDb(), 'oicp_sql', { sql: `SELECT ocid, gano FROM participaciones WHERE ruc10 = '${B.ruc10}'` });
  assert.ok(!ok.error, ok.error);
  assert.equal(ok.data.length, 3);
  const mal: any = callTool(getDb(), 'oicp_sql', { sql: `SELECT COUNT(*) FROM participaciones` });
  assert.ok(mal.error, 'un recorrido completo de participaciones debe rechazarse por costo');
});

test('la boleta cuadra el agregado con la tabla y grita si se desfasa', async () => {
  const ok = await verificarAnio(2024, getDb());
  assert.ok(ok.controles.participantes, 'la boleta debe tener el control participantes');
  assert.equal(ok.controles.participantes.ok, true, ok.controles.participantes.detalle);
  getDb().prepare(`UPDATE a_participantes SET n_perdidas = 99 WHERE ruc10 = ?`).run(B.ruc10);
  const mal = await verificarAnio(2024, getDb());
  assert.equal(mal.controles.participantes.ok, false, 'un agregado desfasado tiene que ser FALLA');
  assert.equal(mal.veredicto, 'FALLA');
});
