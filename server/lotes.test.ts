/**
 * El 5-sep-2026 un proceso con cientos de oferentes desbordó el búfer del cargador por encima de
 * las 2 000 filas que acepta el servidor y 2022 se habría perdido entero. Estas pruebas fijan que el
 * cliente nunca manda más de lo que el servidor acepta, pase lo que pase con el tamaño de un proceso.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { LOTE_PARTICIPACIONES, TOPE_LOTE_INGESTA, lotesDe } from './lotes.js';

test('un búfer desbordado por un proceso con cientos de oferentes sale en lotes que nunca superan el tope', () => {
  // 1 499 filas acumuladas más un proceso de 700 oferentes: era exactamente el caso real.
  const filas = Array.from({ length: 1499 + 700 }, (_, i) => ({ i }));
  const lotes = lotesDe(filas, LOTE_PARTICIPACIONES);
  assert.ok(lotes.length >= 2);
  for (const l of lotes) assert.ok(l.length >= 1 && l.length <= LOTE_PARTICIPACIONES, `lote de ${l.length} filas`);
  assert.deepEqual(lotes.flat(), filas, 'los lotes no reproducen el búfer en orden y sin pérdidas');
});

test('el lote del cliente cabe en lo que acepta el servidor, y el tope parte exacto', () => {
  assert.ok(LOTE_PARTICIPACIONES <= TOPE_LOTE_INGESTA);
  const tam = lotesDe(Array.from({ length: 2 * TOPE_LOTE_INGESTA + 1 }, (_, i) => i), TOPE_LOTE_INGESTA).map(l => l.length);
  assert.deepEqual(tam, [TOPE_LOTE_INGESTA, TOPE_LOTE_INGESTA, 1]);
});

test('un búfer vacío no produce lotes, y un tope absurdo no rompe nada', () => {
  assert.deepEqual(lotesDe([], 1500), []);
  assert.deepEqual(lotesDe([1, 2, 3], 0), [[1], [2], [3]]);
});
