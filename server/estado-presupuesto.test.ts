/**
 * Costo de estadoPresupuesto(): la medición que alimenta /api/version, el pie de página de
 * la web y la metodología NO puede recorrer la tabla entera.
 *
 * Por qué existe: la versión anterior hacía un solo SELECT con SUM(CASE typeof(...)) sobre
 * procedures, o sea leía las 1,47 M filas completas. Con caché de 5 minutos, cada primera
 * carga tras cinco minutos de silencio pagaba el recorrido: 16 a 28 segundos medidos en
 * producción el 1-sep-2026 (cuatro llamadas del monitor de GitHub, tres por encima de su
 * timeout de 25 s). Y como better-sqlite3 es síncrono en el único hilo de Node, durante
 * esos segundos la plataforma entera dejaba de responder: web, MCP y /api/health.
 *
 * La defensa es la misma del guardián de oicp_sql: el plan de ejecución. Las consultas
 * de presupuesto deben resolverse por índice (parciales para IS NULL y typeof = 'text';
 * COUNT(*) a secas usa el índice más pequeño sin leer filas), y esta prueba lo exige
 * leyendo EXPLAIN QUERY PLAN sobre las MISMAS cadenas SQL que corren en producción.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'oicp-presupuesto-'));
process.env.DB_PATH = path.join(TMP, 'prueba.db');
process.env.JWT_SECRET = '';

const {
  migrate, getDb, upsertProcedure, estadoPresupuesto,
  SQL_PRESUPUESTO_TOTAL, SQL_PRESUPUESTO_PENDIENTES, SQL_PRESUPUESTO_SIN_DATO,
} = await import('./db.js');

function proceso(i: number, budget: number | null) {
  upsertProcedure({
    id: `proc-${i}`, ocid: `ocds-x-${i}`, title: `Proceso ${i}`,
    description: `Objeto del proceso numero ${i} con texto suficiente`,
    status: 'complete', procurement_method: 'open', procurement_method_details: 'Subasta Inversa Electronica',
    buyer_id: 'EC-RUC-1768097950001-2525', buyer_name: 'ENTIDAD',
    budget_amount: budget, award_amount: 100, contract_amount: 100, final_amount: null,
    published_date: `2024-06-15T12:00:00-05:00`,
    suppliers: [{ id: 'EC-RUC-1790732657001-1', name: 'PROVEEDOR' }],
    number_of_tenderers: 2, flags: [], score: 0, risk_level: 'low', source_year: 2024, regime: 'LOSNCP',
  });
}

function plan(sql: string): string {
  return (getDb().prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as any[]).map(r => r.detail).join(' | ');
}

test('preparación: 2 con presupuesto, 2 sin dato y 1 guardado como texto "USD"', () => {
  migrate();
  proceso(0, 500); proceso(1, 700);
  proceso(2, null); proceso(3, null);
  proceso(4, 900);
  // La ingesta ya normaliza con Number(), así que el texto solo puede entrar por SQL directo:
  // es exactamente el defecto histórico que la medición debe seguir viendo si reaparece.
  getDb().prepare(`UPDATE procedures SET budget_amount = 'USD' WHERE id = 'proc-4'`).run();
  assert.equal((getDb().prepare('SELECT COUNT(*) AS n FROM procedures').get() as any).n, 5);
});

test('mide bien: total, pendientes (texto), sin dato (NULL) y con dato', () => {
  const e = estadoPresupuesto();
  assert.deepEqual(e, { total: 5, pendientes: 1, sin_dato: 2, con_dato: 2 });
});

test('sin_dato se resuelve por índice, no recorriendo la tabla', () => {
  const p = plan(SQL_PRESUPUESTO_SIN_DATO);
  assert.match(p, /USING (COVERING )?INDEX/i, `debe usar índice; plan: ${p}`);
  assert.doesNotMatch(p, /SCAN procedures(?! USING)/i, `no puede recorrer la tabla; plan: ${p}`);
});

test('pendientes (typeof = text) se resuelve por índice, no recorriendo la tabla', () => {
  const p = plan(SQL_PRESUPUESTO_PENDIENTES);
  assert.match(p, /USING (COVERING )?INDEX/i, `debe usar índice; plan: ${p}`);
  assert.doesNotMatch(p, /SCAN procedures(?! USING)/i, `no puede recorrer la tabla; plan: ${p}`);
});

test('el total usa un índice de cobertura (cuenta entradas, no lee filas)', () => {
  const p = plan(SQL_PRESUPUESTO_TOTAL);
  assert.match(p, /COVERING INDEX/i, `COUNT(*) debe contar sobre un índice; plan: ${p}`);
});
