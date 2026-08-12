/**
 * Pruebas del limitador de emisión.
 *
 * La prueba que importa es la de CONCURRENCIA: la versión anterior pasaba cualquier prueba en
 * serie y emitía N peticiones de golpe con N hilos. Así que aquí se lanzan hilos de verdad y se
 * miden los instantes de emisión, no el número de llamadas.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { crearLimitador } from './limitador.js';

// Nota sobre las tolerancias: `setTimeout` en Windows tiene una resolución de ~15 ms y puede
// despertar unos milisegundos antes. Por eso no se compara hueco a hueco con el valor exacto,
// que mediría el reloj del sistema y no el limitador. Se comprueban dos cosas que SÍ distinguen
// la versión correcta de la rota: el tiempo TOTAL que tardan N emisiones (la versión rota las
// suelta casi todas de golpe, así que tarda ~0) y que no haya ráfagas dentro de una ventana.
const TOLERANCIA = 0.8;

test('en serie, N emisiones tardan lo que suman sus huecos', async () => {
  const GAP = 40, N = 5;
  const lim = crearLimitador(GAP);
  const t0 = Date.now();
  for (let i = 0; i < N; i++) await lim.turno();
  const transcurrido = Date.now() - t0;
  assert.ok(transcurrido >= (N - 1) * GAP * TOLERANCIA,
    `${N} emisiones en ${transcurrido} ms, esperaba al menos ${Math.round((N - 1) * GAP * TOLERANCIA)}`);
});

test('CON VARIOS HILOS no hay ráfaga: es donde fallaba la versión anterior', async () => {
  const GAP = 40, HILOS = 12;
  const lim = crearLimitador(GAP);
  const emisiones: number[] = [];
  // 12 hilos pidiendo turno a la vez es exactamente el caso que rompía el limitador viejo:
  // los 12 leían el mismo instante, dormían lo mismo y despertaban juntos, así que salían 12
  // peticiones en el mismo milisegundo. Ese caso tardaría ~0 ms en total.
  const t0 = Date.now();
  await Promise.all(Array.from({ length: HILOS }, async () => {
    await lim.turno();
    emisiones.push(Date.now());
  }));
  const transcurrido = Date.now() - t0;
  assert.equal(emisiones.length, HILOS);
  assert.ok(transcurrido >= (HILOS - 1) * GAP * TOLERANCIA,
    `${HILOS} emisiones en ${transcurrido} ms: eso es una ráfaga, el limitador se rompe en paralelo`);

  // Y en ninguna ventana de un hueco puede haber más de dos emisiones.
  emisiones.sort((a, b) => a - b);
  for (let i = 0; i < emisiones.length; i++) {
    const enVentana = emisiones.filter(e => e >= emisiones[i] && e < emisiones[i] + GAP).length;
    assert.ok(enVentana <= 2, `${enVentana} emisiones dentro de una sola ventana de ${GAP} ms`);
  }
});

test('el ritmo emitido nunca supera el techo, aunque haya el triple de hilos que huecos', async () => {
  const GAP = 25, HILOS = 30, PETICIONES = 60;
  const lim = crearLimitador(GAP);
  const emisiones: number[] = [];
  let pendientes = PETICIONES;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: HILOS }, async () => {
    while (pendientes-- > 0) { await lim.turno(); emisiones.push(Date.now()); }
  }));
  const seg = (Date.now() - t0) / 1000;
  const ritmo = emisiones.length / seg;
  const techo = 1000 / GAP;
  assert.ok(ritmo <= techo * 1.2, `emitió ${ritmo.toFixed(1)}/s con un techo de ${techo}/s`);
});

test('un 429 frena a TODOS los hilos, no solo al que lo recibió', async () => {
  const lim = crearLimitador(10);
  await lim.turno();
  lim.frenar(2);                       // como un Retry-After: 2
  const hueco = lim.proximoHueco();
  assert.ok(hueco - Date.now() >= 1900, 'el freno tiene que empujar el próximo hueco ~2 s');

  // Un hilo distinto al que se llevó el 429 también tiene que esperar.
  const t0 = Date.now();
  const dormidas: number[] = [];
  const limFalso = crearLimitador(10, async (ms) => { dormidas.push(ms); });
  await limFalso.turno();
  limFalso.frenar(2);
  await limFalso.turno();
  assert.ok(dormidas[dormidas.length - 1] >= 1900,
    `el segundo hilo solo esperó ${dormidas[dormidas.length - 1]} ms tras el 429`);
  assert.ok(Date.now() - t0 < 500, 'la prueba usa un reloj falso: no debe dormir de verdad');
});
