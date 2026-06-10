/**
 * Tests unitarios del motor de banderas. Runner nativo de Node (node:test),
 * sin dependencias. Correr con: npm test  (ver package.json)
 *
 * Cada caso es sintético y prueba UNA condición de bandera de forma aislada,
 * mas el scoring y los cortes de riesgo. Documenta tambien las dos banderas
 * que hoy no pueden dispararse por diseño/datos (CC-01, IP-03).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateIndividualFlags, evaluateConcentrationFlags, getInfimaThreshold,
  getRegime, calculateScore, getRiskLevel, evaluateAllFlags, FLAG_CATALOG,
} from './flag-engine.js';

function codes(flags: any[]): string[] { return flags.map((f) => f.code); }

test('getInfimaThreshold: reforma rige desde 2025-10-07', () => {
  assert.equal(getInfimaThreshold('2024-06-15'), 6658.78);
  assert.equal(getInfimaThreshold('2023-06-15'), 6300.57); // mid-year evita el desfase de zona horaria
  assert.equal(getInfimaThreshold('2025-03-15'), 7212.60); // 2025 pre-reforma: coeficiente
  assert.equal(getInfimaThreshold('2025-10-07'), 10000); // dia de la reforma
  assert.equal(getInfimaThreshold('2025-12-01'), 10000); // post reforma
  assert.equal(getInfimaThreshold(null), 10000);         // sin fecha -> reformada
});

test('getRegime: antes/despues de la reforma', () => {
  assert.equal(getRegime('2025-01-15'), 'LOSNCP_COEFICIENTES');
  assert.equal(getRegime('2025-10-07'), 'LOSNCP_REFORMADA');
});

test('IC-01: proveedor unico en proceso competitivo', () => {
  const f = evaluateIndividualFlags({ id: 'x', procurement_method_details: 'Subasta Inversa Electrónica', number_of_tenderers: 1 });
  assert.ok(codes(f).includes('IC-01'));
});

test('IC-01: NO dispara si hay 2+ oferentes', () => {
  const f = evaluateIndividualFlags({ id: 'x', procurement_method_details: 'Subasta Inversa Electrónica', number_of_tenderers: 3 });
  assert.ok(!codes(f).includes('IC-01'));
});

test('IC-02: adjudicacion directa por monto superior al umbral', () => {
  const f = evaluateIndividualFlags({ id: 'x', procurement_method: 'direct', award_amount: 50000, published_date: '2024-06-01' });
  assert.ok(codes(f).includes('IC-02'));
});

test('IP-01: valor entre 85% y 100% del umbral de infima', () => {
  // 2024 umbral 6658.78; 95% = 6325.84
  const f = evaluateIndividualFlags({ id: 'x', award_amount: 6325, published_date: '2024-03-01', procurement_method_details: 'Menor Cuantía' });
  assert.ok(codes(f).includes('IP-01'));
});

test('IP-02: diferencia presupuesto vs adjudicacion > 15%', () => {
  const f = evaluateIndividualFlags({ id: 'x', budget_amount: 100000, award_amount: 80000, published_date: '2024-01-01' });
  assert.ok(codes(f).includes('IP-02'));
});

test('TR-01: faltan campos criticos', () => {
  const f = evaluateIndividualFlags({ id: 'x' }); // sin buyer, valor, suppliers, metodo
  assert.ok(codes(f).includes('TR-01'));
});

test('TR-02: descripcion generica (<30 chars)', () => {
  const f = evaluateIndividualFlags({ id: 'x', description: 'compra', buyer_id: 'b', award_amount: 100, suppliers: [{ id: 's', name: 'S' }], procurement_method: 'open' });
  assert.ok(codes(f).includes('TR-02'));
});

test('TR-03: regimen especial sobre umbral', () => {
  const f = evaluateIndividualFlags({ id: 'x', procurement_method_details: 'Régimen Especial - Contratación directa', award_amount: 50000, published_date: '2024-01-01' });
  assert.ok(codes(f).includes('TR-03'));
});

test('calculateScore: pesos por severidad y tope 100', () => {
  const sev3 = { ...FLAG_CATALOG['IC-02'], active: true };   // 30
  const sev2 = { ...FLAG_CATALOG['IC-01'], active: true };   // 18
  assert.equal(calculateScore([sev3]), 30);
  assert.equal(calculateScore([sev3, sev2]), 48);
  // banderas inactivas no suman
  assert.equal(calculateScore([{ ...FLAG_CATALOG['IC-02'], active: false }]), 0);
});

test('getRiskLevel: cortes low/moderate/high/critical (segun codigo real)', () => {
  assert.equal(getRiskLevel(0), 'low');
  assert.equal(getRiskLevel(10), 'low');
  assert.equal(getRiskLevel(11), 'moderate');
  assert.equal(getRiskLevel(30), 'moderate');
  assert.equal(getRiskLevel(31), 'high');
  assert.equal(getRiskLevel(60), 'high');
  assert.equal(getRiskLevel(61), 'critical');
});

test('Concentracion: catalogo electronico se excluye por completo', () => {
  const ctx = { bySupplier: new Map([['b|s', { supplier_id: 's', supplier_name: 'S', infima_count: 9, infima_total_value: 99999, share_of_buyer: 99, years_active: 7, consortium_count: 5, total_value: 999999, buyer_total_procs: 100 }]]) };
  const proc = { id: 'x', buyer_id: 'b', title: 'ORDEN DE COMPRA CE-123', procurement_method_details: 'Catálogo electrónico', suppliers: [{ id: 's', name: 'S' }], published_date: '2024-01-01' };
  assert.equal(evaluateConcentrationFlags(proc as any, ctx as any).length, 0);
});

test('CC-02: proveedor dominante (>40% y >=10 procesos del comprador)', () => {
  const ctx = { bySupplier: new Map([['b|s', { supplier_id: 's', supplier_name: 'S', infima_count: 0, infima_total_value: 0, share_of_buyer: 55, years_active: 1, consortium_count: 0, total_value: 200000, buyer_total_procs: 20 }]]) };
  const proc = { id: 'x', buyer_id: 'b', procurement_method_details: 'Menor Cuantía', suppliers: [{ id: 's', name: 'S' }], published_date: '2024-01-01' };
  assert.ok(codes(evaluateConcentrationFlags(proc as any, ctx as any)).includes('CC-02'));
});

test('CC-02: NO dispara si el comprador tiene <10 procesos (piso de volumen)', () => {
  const ctx = { bySupplier: new Map([['b|s', { supplier_id: 's', supplier_name: 'S', infima_count: 0, infima_total_value: 0, share_of_buyer: 100, years_active: 1, consortium_count: 0, total_value: 5000, buyer_total_procs: 2 }]]) };
  const proc = { id: 'x', buyer_id: 'b', procurement_method_details: 'Menor Cuantía', suppliers: [{ id: 's', name: 'S' }], published_date: '2024-01-01' };
  assert.ok(!codes(evaluateConcentrationFlags(proc as any, ctx as any)).includes('CC-02'));
});

test('CC-05: posible fraccionamiento (2+ infimas que suman sobre el umbral)', () => {
  const ctx = { bySupplier: new Map([['b|s', { supplier_id: 's', supplier_name: 'S', infima_count: 3, infima_total_value: 25000, share_of_buyer: 10, years_active: 1, consortium_count: 0, total_value: 25000, buyer_total_procs: 12 }]]) };
  const proc = { id: 'x', buyer_id: 'b', procurement_method_details: 'Menor Cuantía', suppliers: [{ id: 's', name: 'S' }], published_date: '2024-01-01' };
  assert.ok(codes(evaluateConcentrationFlags(proc as any, ctx as any)).includes('CC-05'));
});

// ── CC-01 revivida: detecta ínfima por MONTO (no por texto inexistente) ──
test('CC-01 (revivida): dispara con proceso ínfima por monto + par con >=5 ínfimas', () => {
  const ctx = { bySupplier: new Map([['b|s', { supplier_id: 's', supplier_name: 'S', infima_count: 9, infima_total_value: 30000, share_of_buyer: 5, years_active: 1, consortium_count: 0, total_value: 30000, buyer_total_procs: 12 }]]) };
  const proc = { id: 'x', buyer_id: 'b', procurement_method_details: 'Menor Cuantía', award_amount: 5000, suppliers: [{ id: 's', name: 'S' }], published_date: '2024-03-01' };
  assert.ok(codes(evaluateConcentrationFlags(proc as any, ctx as any)).includes('CC-01'));
});

test('CC-01: NO dispara en catálogo electrónico aunque el par tenga muchas ínfimas', () => {
  const ctx = { bySupplier: new Map([['b|s', { supplier_id: 's', supplier_name: 'S', infima_count: 9, infima_total_value: 30000, share_of_buyer: 5, years_active: 1, consortium_count: 0, total_value: 30000, buyer_total_procs: 12 }]]) };
  const proc = { id: 'x', buyer_id: 'b', title: 'ORDEN DE COMPRA CE-9', procurement_method_details: 'Catálogo electrónico', award_amount: 500, suppliers: [{ id: 's', name: 'S' }], published_date: '2024-03-01' };
  assert.ok(!codes(evaluateConcentrationFlags(proc as any, ctx as any)).includes('CC-01'));
});

test('IP-03 esta muerta: requiere has_amendments, que es 0 en todos los datos OCDS de search', () => {
  const f = evaluateIndividualFlags({ id: 'x', has_amendments: false, award_amount: 100, contract_amount: 200, published_date: '2024-01-01', buyer_id: 'b', suppliers: [{ id: 's', name: 'S' }], procurement_method: 'open', description: 'una descripcion suficientemente larga aqui' });
  assert.ok(!codes(f).includes('IP-03'));
});

test('evaluateAllFlags devuelve estructura {flags, score, riskLevel}', () => {
  const r = evaluateAllFlags({ id: 'x', procurement_method: 'direct', award_amount: 50000, published_date: '2024-06-01', buyer_id: 'b', suppliers: [{ id: 's', name: 'S' }], description: 'descripcion larga del proceso de prueba' });
  assert.ok(Array.isArray(r.flags));
  assert.equal(typeof r.score, 'number');
  assert.ok(['low', 'moderate', 'high', 'critical'].includes(r.riskLevel));
});
