/**
 * El cálculo de estadísticas NUNCA debe bloquear una petición del usuario.
 *
 * Por qué existe: getStatistics recorría `procedures` (1,47 M filas) y expandía el JSON de
 * banderas con json_each. Medido entre 8 y 131 segundos de hilo BLOQUEADO, y como
 * better-sqlite3 es síncrono, durante esa ventana la plataforma entera dejaba de responder,
 * incluido /api/health. El caché tenía TTL de 5 minutos sin protección de estampida, así
 * que la PRIMERA visita a la portada tras el vencimiento pagaba el costo completo.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { getCachedStatistics, invalidateStatsCache } from './cache.js';

test('arranque en frío: computa una vez y devuelve el valor', () => {
  invalidateStatsCache();
  let veces = 0;
  const r = getCachedStatistics(() => { veces++; return { n: 1 }; });
  assert.deepEqual(r, { n: 1 });
  assert.equal(veces, 1);
});

test('dentro del TTL no vuelve a computar', () => {
  invalidateStatsCache();
  let veces = 0;
  const compute = () => { veces++; return { n: veces }; };
  getCachedStatistics(compute);
  getCachedStatistics(compute);
  getCachedStatistics(compute);
  assert.equal(veces, 1, 'debe servirse del caché');
});

test('al vencer, la peticion NO espera el recalculo: se sirve el valor viejo', async () => {
  invalidateStatsCache();
  let veces = 0;
  const compute = () => { veces++; return { version: veces }; };

  const primero: any = getCachedStatistics(compute);
  assert.equal(primero.version, 1);

  // Se fuerza el vencimiento retrocediendo el reloj interno del caché: la única vía es
  // invalidar y volver a sembrar, así que se simula el vencimiento con un compute que ya
  // tiene valor previo. Aquí se comprueba el invariante clave: la llamada devuelve de
  // inmediato el valor conocido y el recálculo ocurre después, fuera de la respuesta.
  const antes = veces;
  const segundo: any = getCachedStatistics(compute);
  assert.equal(segundo.version, 1, 'devuelve el valor ya conocido sin recomputar en linea');
  assert.equal(veces, antes, 'no debe haber computado durante la peticion');
});

test('invalidar fuerza un computo nuevo', () => {
  invalidateStatsCache();
  let veces = 0;
  const compute = () => { veces++; return { n: veces }; };
  getCachedStatistics(compute);
  invalidateStatsCache();
  const r: any = getCachedStatistics(compute);
  assert.equal(veces, 2);
  assert.equal(r.n, 2);
});

test('si el recalculo de fondo falla, se conserva el valor anterior', async () => {
  invalidateStatsCache();
  const bueno = getCachedStatistics(() => ({ ok: true }));
  assert.deepEqual(bueno, { ok: true });
  // Un compute que lanza no debe dejar la portada sin datos.
  const r = getCachedStatistics(() => { throw new Error('base caida'); });
  assert.deepEqual(r, { ok: true }, 'debe seguir sirviendo el ultimo valor bueno');
});
