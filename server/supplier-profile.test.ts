/**
 * Perfil de proveedor: los totales tienen que ser exactos y salir de la MISMA fuente
 * que el MCP (regla 11).
 *
 * Por qué existe: la versión anterior traía las 500 filas más recientes y publicaba
 * rows.length como "Contratos" y un reduce de award_amount crudo como "Valor Total".
 * En producción eso significaba que COGECOMSA aparecía con 500 contratos cuando tiene
 * 497.290, y que ROCHE mostraba $109,7 M donde el MCP decía $213,0 M. Un periodista que
 * citara la web publicaba un dato falso. Estas pruebas fijan el invariante.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'oicp-perfil-'));
process.env.DB_PATH = path.join(TMP, 'prueba.db');
process.env.JWT_SECRET = '';

const { migrate, getDb, upsertProcedure, getSupplierProfile } = await import('./db.js');
const { buildAnalytics } = await import('./mcp-server.js');

const RUC = 'EC-RUC-1790732657001-2854';
const RUC10 = '1790732657';
const N_PROCESOS = 150;          // por encima del tope de la muestra (100)
const AWARD = 1000;
// Un proceso con contract_amount 500x el adjudicado: la regla de plausibilidad manda
// usar el adjudicado. Si el total sumara el campo crudo, el resultado se dispararía.
const CONTRATO_ABSURDO = AWARD * 500;

test('preparación: base con un proveedor de 150 procesos en varios años', () => {
  migrate();
  for (let i = 0; i < N_PROCESOS; i++) {
    const anio = 2019 + (i % 8);
    upsertProcedure({
      id: `proc-${i}`, ocid: `ocds-x-${i}`, title: `Proceso ${i}`,
      description: `Objeto del proceso numero ${i} con texto suficiente`,
      status: i % 2 === 0 ? 'complete' : 'award',
      procurement_method: 'direct', procurement_method_details: 'Subasta Inversa Electronica',
      buyer_id: `EC-RUC-99999999900${i % 3}`, buyer_name: `ENTIDAD ${i % 3}`,
      budget_amount: AWARD, award_amount: AWARD,
      // Solo el primero trae el monto absurdo de la fuente.
      contract_amount: i === 0 ? CONTRATO_ABSURDO : AWARD,
      final_amount: null,
      published_date: `${anio}-06-15T12:00:00-05:00`,
      suppliers: [{ id: RUC, name: 'COMPANIA DE PRUEBA S.A.' }],
      number_of_tenderers: 1, flags: [], score: i % 100, risk_level: i % 10 === 0 ? 'critical' : 'low',
      source_year: anio, regime: 'LOSNCP',
    });
  }
  const n = (getDb().prepare('SELECT COUNT(*) AS n FROM procedures').get() as any).n;
  assert.equal(n, N_PROCESOS);
  buildAnalytics(getDb());
});

test('el total de contratos es el real, no el tope de la muestra', () => {
  const p: any = getSupplierProfile(RUC10);
  assert.ok(p, 'debe encontrar el proveedor');
  assert.equal(p.totalProcedures, N_PROCESOS,
    'totalProcedures debe ser el total del proveedor, no el número de filas listadas');
  assert.ok(p.procedures.length <= 100, 'la lista sigue acotada');
  assert.ok(p.procedures.length < p.totalProcedures, 'la lista es menor que el total');
  assert.equal(p.esMuestra, true, 'debe declararse como muestra');
});

test('el valor total aplica la regla de plausibilidad y no suma el campo crudo', () => {
  const p: any = getSupplierProfile(RUC10);
  // Esperado: 150 procesos x $1.000, porque el contrato de $500.000 del proceso 0 es
  // implausible (>100x el adjudicado) y se sustituye por el adjudicado.
  const esperado = N_PROCESOS * AWARD;
  const crudoIncorrecto = esperado - AWARD + CONTRATO_ABSURDO;
  assert.equal(Math.round(p.totalValue), esperado);
  assert.notEqual(Math.round(p.totalValue), crudoIncorrecto,
    'no debe sumar contract_amount crudo: ese fue el defecto que hacía divergir web y MCP');
});

test('la serie anual cubre todos los años, no solo los meses de la muestra', () => {
  const p: any = getSupplierProfile(RUC10);
  const anios = p.byYear.map((y: any) => y.year).sort();
  assert.deepEqual(anios, [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026],
    'debe cubrir 2019-2026: antes la serie se truncaba a los procesos más recientes');
  const sumaAnual = p.byYear.reduce((s: number, y: any) => s + y.count, 0);
  assert.equal(sumaAnual, N_PROCESOS, 'la suma de la serie anual debe dar el total');
});

test('los compradores distintos y el riesgo son exactos sobre todo el proveedor', () => {
  const p: any = getSupplierProfile(RUC10);
  assert.equal(p.distinctBuyers, 3);
  const criticos = p.riskDistribution.find((r: any) => r.risk_level === 'critical')?.count;
  assert.equal(criticos, 15, '150 procesos con 1 de cada 10 crítico');
});

test('la web y el MCP entregan la misma cifra para el mismo proveedor (regla 11)', async () => {
  const { callTool } = await import('./mcp-server.js');
  const web: any = getSupplierProfile(RUC10);
  const mcp: any = callTool(getDb(), 'oicp_supplier_profile', { query: RUC10 });
  assert.equal(web.totalProcedures, mcp.n_procs, 'los contratos deben coincidir');
  assert.equal(Math.round(web.totalValue), Math.round(mcp.total_usd), 'los montos deben coincidir al centavo');
});

test('limpieza', () => {
  try { getDb().close(); } catch { /* ya cerrada */ }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* Windows puede retener el handle */ }
});
