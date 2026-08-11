/**
 * Formato de lo que se muestra en pantalla. Son defectos que un auditor de UX marca de
 * inmediato y que se detectaron probando produccion en vivo:
 *   - "Procesos Criticos" imprimia el guion largo cuando el valor real era CERO. Un guion
 *     se lee como "no se sabe", no como "ninguno".
 *   - El badge de estado imprimia `active` en crudo, en ingles, mezclado con "Finalizado" y
 *     "Contratado", porque cada pantalla tenia su propia copia de las etiquetas y ninguna
 *     cubria los valores que el SERCOP devuelve de verdad.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { statusLabel, statusColor, formatCount } from './flags.js';

const SIN_DATO = '—';   // guion largo, escapado para no depender de la codificacion

test('formatCount distingue el cero real de la ausencia de dato', () => {
  assert.equal(formatCount(0), '0', 'cero es un dato: debe imprimirse 0');
  assert.equal(formatCount(null), SIN_DATO);
  assert.equal(formatCount(undefined), SIN_DATO);
  assert.equal(formatCount(NaN), SIN_DATO);
});

test('formatCount agrupa miles en formato ecuatoriano', () => {
  assert.equal(formatCount(497290), (497290).toLocaleString('es-EC'));
});

test('statusLabel traduce los estados que el SERCOP devuelve de verdad', () => {
  assert.equal(statusLabel('active'), 'En curso');       // el que salia crudo en produccion
  assert.equal(statusLabel('complete'), 'Finalizado');
  assert.equal(statusLabel('contract'), 'Contratado');
  assert.equal(statusLabel('unsuccessful'), 'Desierto');
  assert.equal(statusLabel('planned'), 'Planificado');
});

test('statusLabel nunca deja ver un identificador tecnico en crudo', () => {
  assert.equal(statusLabel('algo_nuevo_del_sercop'), 'Algo nuevo del sercop');
  assert.equal(statusLabel(''), 'Sin estado');
  assert.equal(statusLabel(null), 'Sin estado');
  assert.equal(statusLabel('COMPLETE'), 'Finalizado', 'no debe depender de mayusculas');
});

test('statusColor siempre devuelve clases utilizables', () => {
  assert.match(statusColor('active'), /bg-/);
  assert.match(statusColor('valor-desconocido'), /bg-/);
  assert.match(statusColor(null), /bg-/);
});
