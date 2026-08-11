/**
 * Rehidratación de banderas desde el catálogo vigente (regla 10).
 *
 * El texto que ve el usuario tiene que salir SIEMPRE del catálogo actual, no de lo que se
 * escribió en la base el día que se evaluó el proceso. Antes venía de la fila, así que
 * corregir una descripción de metodología exigía reescribir 1,47 M de filas y hasta entonces
 * la ficha publicaba la versión vieja de la regla. Eso es exactamente cómo se rompe la
 * regla 10, y esta rehidratación lo cierra de forma estructural.
 *
 * Las pruebas cubren los fallos SILENCIOSOS que un inventario del código identificó como los
 * más peligrosos: el score NaN que marcaría 1,47 M procesos como críticos sin un error en el
 * log, y los códigos desconocidos que reventarían la ficha con un TypeError.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { hidratarBanderas, calculateScore, getRiskLevel, FLAG_CATALOG } from './flag-engine.js';

// Forma ADELGAZADA: solo lo propio del proceso. Es lo que quedaría guardado si algún día se
// normaliza la escritura, y también lo que puede llegar de una fila escrita por otra versión.
const flaca = [
  { code: 'IC-02', active: true, detail: 'Adjudicación directa $40.328.858,64 > umbral $7.105,88' },
  { code: 'CC-03', active: true, detail: 'contrató en 8 años distintos' },
];

// Forma GORDA: como está guardada hoy en producción, con los campos estáticos incluidos.
const gorda = [
  { ...FLAG_CATALOG['IC-02'], active: true, detail: 'Adjudicación directa' },
  { ...FLAG_CATALOG['CC-03'], active: true, detail: 'contrató en 8 años distintos' },
];

test('la forma adelgazada recupera nombre, severidad, categoría y regla del catálogo', () => {
  const h = hidratarBanderas(flaca);
  assert.equal(h[0].name_es, FLAG_CATALOG['IC-02'].name_es);
  assert.equal(h[0].severity, FLAG_CATALOG['IC-02'].severity);
  assert.equal(h[0].category, FLAG_CATALOG['IC-02'].category);
  assert.equal(h[0].description_es, FLAG_CATALOG['IC-02'].description_es);
  assert.equal(h[0].ocp_ref, FLAG_CATALOG['IC-02'].ocp_ref);
  // Lo propio del proceso se conserva intacto.
  assert.equal(h[0].detail, 'Adjudicación directa $40.328.858,64 > umbral $7.105,88');
  assert.equal(h[0].active, true);
});

test('la forma gorda sigue funcionando: la base puede tener filas de dos versiones', () => {
  const h = hidratarBanderas(gorda);
  assert.equal(h[0].name_es, FLAG_CATALOG['IC-02'].name_es);
  assert.equal(h[0].severity, FLAG_CATALOG['IC-02'].severity);
  assert.equal(h[0].detail, 'Adjudicación directa');
});

test('el catálogo MANDA sobre el texto guardado: así surte efecto una corrección', () => {
  // Simula una fila vieja con la descripción anterior de CC-03, la que decía el absurdo
  // "de los últimos 7 años". Aunque esté guardada, no debe publicarse.
  const vieja = [{ code: 'CC-03', name_es: 'Nombre viejo', severity: 0,
    description_es: 'Un proveedor gana contratos del mismo comprador en 5+ de los últimos 7 años.',
    active: true, detail: 'x' }];
  const h = hidratarBanderas(vieja);
  assert.equal(h[0].description_es, FLAG_CATALOG['CC-03'].description_es);
  assert.doesNotMatch(h[0].description_es, /de los últimos 7 años/,
    'el texto corregido del catálogo tiene que ganarle al guardado en la fila');
  assert.equal(h[0].name_es, FLAG_CATALOG['CC-03'].name_es);
  assert.equal(h[0].severity, FLAG_CATALOG['CC-03'].severity, 'la severidad también sale del catálogo');
});

// ── El fallo silencioso más grave ──
test('el score NO sale NaN con banderas sin severity guardada', () => {
  const score = calculateScore(flaca as any);
  assert.ok(Number.isFinite(score), `el score debe ser finito y salió ${score}`);
  // IC-02 pesa 30 y CC-03 pesa 18; no son un par correlacionado, así que suman 48.
  assert.equal(score, 48);
  assert.equal(getRiskLevel(score), 'high');
});

test('un score NaN habria marcado TODO como critico: se comprueba el corte', () => {
  // Documenta por qué el punto anterior importa tanto: getRiskLevel(NaN) falla los tres
  // cortes y cae en el último return.
  assert.equal(getRiskLevel(NaN), 'critical');
});

test('la forma adelgazada y la gorda dan el MISMO score', () => {
  assert.equal(calculateScore(flaca as any), calculateScore(gorda as any),
    'si difieren, migrar el formato cambiaría los scores publicados');
});

test('el descuento por correlación sigue aplicándose con la forma adelgazada', () => {
  // IC-02 + TR-03 es un par desde el 11-ago-2026: IC-02 pesa 30 y TR-03 pondera al 50% = 9,
  // así que suman 39 en vez de 48. Antes este caso usaba IC-01 + IC-02, un par que se retiró
  // porque tiene cero co-ocurrencias posibles: IC-01 exige método competitivo e IC-02 exige
  // contratación directa.
  const par = [
    { code: 'IC-02', active: true, detail: '' },
    { code: 'TR-03', active: true, detail: '' },
  ];
  assert.equal(calculateScore(par as any), 39);
});

// ── Códigos desconocidos: no pueden reventar la ficha ──
test('un código que no está en el catálogo se degrada, no lanza excepción', () => {
  const h = hidratarBanderas([{ code: 'XX-99', active: true, detail: 'algo' }]);
  assert.equal(h.length, 1);
  assert.equal(h[0].code, 'XX-99');
  assert.ok(h[0].name_es, 'debe tener algo que mostrar en vez de undefined');
  assert.equal(typeof h[0].severity, 'number', 'la severidad debe ser numérica para no romper el peso');
});

test('entradas corruptas no revientan la rehidratación', () => {
  assert.deepEqual(hidratarBanderas([]), []);
  assert.deepEqual(hidratarBanderas(null as any), []);
  assert.deepEqual(hidratarBanderas(undefined as any), []);
  const h = hidratarBanderas([{} as any]);
  assert.equal(h.length, 1);
  assert.equal(typeof h[0].severity, 'number');
});

test('todas las banderas del catálogo se rehidratan con nombre y severidad válidos', () => {
  for (const code of Object.keys(FLAG_CATALOG)) {
    const h = hidratarBanderas([{ code, active: true, detail: 'x' }]);
    assert.ok(h[0].name_es && h[0].name_es.length > 3, `${code} sin nombre publicable`);
    assert.ok([0, 1, 2, 3].includes(h[0].severity), `${code} con severidad inválida: ${h[0].severity}`);
    assert.ok(h[0].description_es && h[0].description_es.length > 10, `${code} sin regla publicada`);
  }
});
