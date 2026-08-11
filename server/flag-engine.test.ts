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
  const sev2 = { ...FLAG_CATALOG['IT-02'], active: true };   // 18 (sin correlación con IC-02)
  assert.equal(calculateScore([sev3]), 30);
  assert.equal(calculateScore([sev3, sev2]), 48);
  // banderas inactivas no suman
  assert.equal(calculateScore([{ ...FLAG_CATALOG['IC-02'], active: false }]), 0);
});

test('calculateScore: correlaciones descuentan 50% sin importar el orden', () => {
  const ic01 = { ...FLAG_CATALOG['IC-01'], active: true };   // 18
  const ic02 = { ...FLAG_CATALOG['IC-02'], active: true };   // 30 -> 15 si IC-01 activa
  assert.equal(calculateScore([ic02, ic01]), 33);
  assert.equal(calculateScore([ic01, ic02]), 33);
  const ip01 = { ...FLAG_CATALOG['IP-01'], active: true };   // 18
  const cc05 = { ...FLAG_CATALOG['CC-05'], active: true };   // 30 -> 15 si IP-01 o CC-01 activa
  assert.equal(calculateScore([ip01, cc05]), 33);
  const cc01 = { ...FLAG_CATALOG['CC-01'], active: true };   // 30
  // CC-05 descuenta UNA sola vez aunque tenga dos pares activos (CC-01 e IP-01)
  assert.equal(calculateScore([cc01, ip01, cc05]), 63);
  // la bandera "a" del par nunca se descuenta
  assert.equal(calculateScore([cc01, cc05]), 45);
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

// ── Concentración: los hechos se leen DEL AÑO DEL PROCESO ──
// El contexto tiene dos índices: byPairYear (clave "comprador|proveedor|año") para lo que
// se publica "en un año", y byPair para lo histórico (CC-03, CC-04).
function ctxAnio(anio: number, porAnio: any, hist: any = {}) {
  return {
    byPairYear: new Map([[`b|s|${anio}`, { supplier_name: 'S', infima_count: 0,
      infima_total_value: 0, share_of_buyer: 0, buyer_total_procs: 0, ...porAnio }]]),
    byPair: new Map([['b|s', { supplier_name: 'S', years_active: 1, total_value: 0,
      consortium_count: 0, ...hist }]]),
  };
}

test('Concentracion: catalogo electronico se excluye por completo', () => {
  const ctx = ctxAnio(2024, { infima_count: 9, infima_total_value: 99999, share_of_buyer: 99, buyer_total_procs: 100 },
    { years_active: 7, total_value: 999999, consortium_count: 5 });
  const proc = { id: 'x', buyer_id: 'b', source_year: 2024, title: 'ORDEN DE COMPRA CE-123', procurement_method_details: 'Catálogo electrónico', suppliers: [{ id: 's', name: 'S' }], published_date: '2024-01-01' };
  assert.equal(evaluateConcentrationFlags(proc as any, ctx as any).length, 0);
});

test('CC-02: proveedor dominante (>40% y >=10 procesos del comprador ese año)', () => {
  const ctx = ctxAnio(2024, { share_of_buyer: 55, buyer_total_procs: 20 }, { total_value: 200000 });
  const proc = { id: 'x', buyer_id: 'b', source_year: 2024, procurement_method_details: 'Menor Cuantía', suppliers: [{ id: 's', name: 'S' }], published_date: '2024-01-01' };
  const f = evaluateConcentrationFlags(proc as any, ctx as any);
  assert.ok(codes(f).includes('CC-02'));
  // El detalle debe nombrar el año: sin eso, la cifra no es verificable por quien la cita.
  assert.match(f.find(x => x.code === 'CC-02')!.detail!, /en 2024/);
});

test('CC-02: NO dispara si el comprador tiene <10 procesos ESE AÑO (piso de volumen)', () => {
  const ctx = ctxAnio(2024, { share_of_buyer: 100, buyer_total_procs: 2 }, { total_value: 5000 });
  const proc = { id: 'x', buyer_id: 'b', source_year: 2024, procurement_method_details: 'Menor Cuantía', suppliers: [{ id: 's', name: 'S' }], published_date: '2024-01-01' };
  assert.ok(!codes(evaluateConcentrationFlags(proc as any, ctx as any)).includes('CC-02'));
});

// REGRESIÓN del defecto real de producción: el proceso ocds-5wno2w-RE-EPP-2017355-19-253178
// es de marzo de 2019 y llevaba CC-02 con el detalle "98.8% del gasto de este comprador",
// que era el share de 2026. Su share real de 2019 fue 17,17%, o sea que la bandera no debía
// existir, y dejaba el proceso en score 100/crítico.
test('CC-02: un proceso de 2019 NO hereda el share de 2026 (defecto real corregido)', () => {
  const ctx = {
    byPairYear: new Map<string, any>([
      ['b|s|2019', { supplier_name: 'CUERPO DE INGENIEROS', infima_count: 0, infima_total_value: 0, share_of_buyer: 17.17, buyer_total_procs: 40 }],
      ['b|s|2026', { supplier_name: 'CUERPO DE INGENIEROS', infima_count: 0, infima_total_value: 0, share_of_buyer: 98.85, buyer_total_procs: 40 }],
    ]),
    byPair: new Map<string, any>([['b|s', { supplier_name: 'CUERPO DE INGENIEROS', years_active: 8, total_value: 279_599_122, consortium_count: 0 }]]),
  };
  const de2019 = { id: 'p2019', buyer_id: 'b', source_year: 2019, procurement_method_details: 'Régimen Especial', suppliers: [{ id: 's', name: 'CUERPO DE INGENIEROS' }], published_date: '2019-03-15T12:00:00-05:00' };
  const f2019 = evaluateConcentrationFlags(de2019 as any, ctx as any);
  assert.ok(!codes(f2019).includes('CC-02'), 'con 17,17% en 2019 CC-02 no debe dispararse');

  const de2026 = { ...de2019, id: 'p2026', source_year: 2026, published_date: '2026-01-15T12:00:00-05:00' };
  const f2026 = evaluateConcentrationFlags(de2026 as any, ctx as any);
  assert.ok(codes(f2026).includes('CC-02'), 'con 98,85% en 2026 sí debe dispararse');
  assert.match(f2026.find(x => x.code === 'CC-02')!.detail!, /98\.9%|98\.8%/);
  assert.match(f2026.find(x => x.code === 'CC-02')!.detail!, /en 2026/);
});

test('CC-03: cuenta años distintos del periodo, sin ventana inventada de 7 anios', () => {
  const ctx = ctxAnio(2024, {}, { years_active: 8, total_value: 120000 });
  const proc = { id: 'x', buyer_id: 'b', source_year: 2024, procurement_method_details: 'Menor Cuantía', suppliers: [{ id: 's', name: 'S' }], published_date: '2024-01-01' };
  const f = evaluateConcentrationFlags(proc as any, ctx as any);
  assert.ok(codes(f).includes('CC-03'));
  const detalle = f.find(x => x.code === 'CC-03')!.detail!;
  assert.match(detalle, /8 años distintos/);
  // El absurdo que se publicaba en 2.861 procesos de produccion.
  assert.doesNotMatch(detalle, /de los últimos 7/);
});

test('CC-05: posible fraccionamiento (2+ infimas del AÑO que suman sobre el umbral)', () => {
  const ctx = ctxAnio(2024, { infima_count: 3, infima_total_value: 25000, share_of_buyer: 10, buyer_total_procs: 12 }, { total_value: 25000 });
  const proc = { id: 'x', buyer_id: 'b', source_year: 2024, procurement_method_details: 'Menor Cuantía', suppliers: [{ id: 's', name: 'S' }], published_date: '2024-01-01' };
  const f = evaluateConcentrationFlags(proc as any, ctx as any);
  assert.ok(codes(f).includes('CC-05'));
  assert.match(f.find(x => x.code === 'CC-05')!.detail!, /en 2024/);
});

test('CC-05: NO usa las infimas de otro año', () => {
  const ctx = {
    byPairYear: new Map<string, any>([
      ['b|s|2024', { supplier_name: 'S', infima_count: 1, infima_total_value: 900, share_of_buyer: 5, buyer_total_procs: 12 }],
      ['b|s|2022', { supplier_name: 'S', infima_count: 9, infima_total_value: 99999, share_of_buyer: 5, buyer_total_procs: 12 }],
    ]),
    byPair: new Map<string, any>([['b|s', { supplier_name: 'S', years_active: 2, total_value: 100899, consortium_count: 0 }]]),
  };
  const proc = { id: 'x', buyer_id: 'b', source_year: 2024, procurement_method_details: 'Menor Cuantía', suppliers: [{ id: 's', name: 'S' }], published_date: '2024-01-01' };
  assert.ok(!codes(evaluateConcentrationFlags(proc as any, ctx as any)).includes('CC-05'));
});

// ── CC-01 revivida: detecta ínfima por MONTO (no por texto inexistente) ──
test('CC-01 (revivida): dispara con proceso ínfima por monto + par con >=5 ínfimas en el año', () => {
  const ctx = ctxAnio(2024, { infima_count: 9, infima_total_value: 30000, share_of_buyer: 5, buyer_total_procs: 12 }, { total_value: 30000 });
  const proc = { id: 'x', buyer_id: 'b', source_year: 2024, procurement_method_details: 'Menor Cuantía', award_amount: 5000, suppliers: [{ id: 's', name: 'S' }], published_date: '2024-03-01' };
  const f = evaluateConcentrationFlags(proc as any, ctx as any);
  assert.ok(codes(f).includes('CC-01'));
  assert.match(f.find(x => x.code === 'CC-01')!.detail!, /en 2024/);
});

test('CC-01: NO dispara en catálogo electrónico aunque el par tenga muchas ínfimas', () => {
  const ctx = ctxAnio(2024, { infima_count: 9, infima_total_value: 30000, share_of_buyer: 5, buyer_total_procs: 12 }, { total_value: 30000 });
  const proc = { id: 'x', buyer_id: 'b', source_year: 2024, title: 'ORDEN DE COMPRA CE-9', procurement_method_details: 'Catálogo electrónico', award_amount: 500, suppliers: [{ id: 's', name: 'S' }], published_date: '2024-03-01' };
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
