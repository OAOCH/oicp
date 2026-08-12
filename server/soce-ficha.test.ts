/**
 * Pruebas del lector de la ficha pública del SOCE.
 *
 * El HTML de abajo NO es inventado: es la estructura literal de
 * `ImprimirIPC2.cpe?id=1976670` leída el 2026-08-12, recortada a los bloques que se parsean, con
 * sus entidades HTML tal cual las manda el portal (`C&oacute;digo:`) y con el sufijo `-Z<id>` que
 * el SOCE añade al código y que nuestro ocid no lleva.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parsearFicha, codigoDeOcid, cruceConfiable, decodificar, urlFicha } from './soce-ficha.js';

const FICHA_SIE = `
<table><tr><th>Entidad:</th><td>COMANDO CONJUNTO</td></tr>
<tr><th>Objeto de Proceso :</th><td>CONTRATACI&Oacute;N DEL SERVICIO DE TRANSPORTE</td></tr>
<tr><th>C&oacute;digo:</th><td>SIE-CCFFAA-2025-027-Z1976670</td></tr>
<tr><th>Tipo Compra:</th><td>Servicio</td></tr>
<tr><th>Presupuesto Referencial Total (Sin Iva):</th><td>USD 77,800.35</td></tr>
<tr><th>Tipo de Contrataci&oacute;n:</th><td>Subasta Inversa Electr&oacute;nica</td></tr></table>
<table><caption>Fechas de Control del Proceso</caption>
<tr><th>Fecha de Publicaci&oacute;n</th><td>2025-11-05 11:00:00</td><td>Indicar la fecha real.</td></tr>
<tr><th>Fecha L&iacute;mite de Preguntas</th><td>2025-11-10 11:00:00</td><td>Fecha m&aacute;xima para solicitar aclaraciones.</td></tr>
<tr><th>Fecha L&iacute;mite de Respuestas</th><td>2025-11-12 16:00:00</td><td>Fecha m&aacute;xima para solventar inquietudes.</td></tr>
<tr><th>Fecha L&iacute;mite entrega Ofertas</th><td>2025-11-17 16:00:00</td><td>Fecha m&aacute;xima de entrega.</td></tr>
<tr><th>Fecha L&iacute;mite de Calificaci&oacute;n</th><td>2025-11-24 17:00:00</td><td>Calificar proveedores.</td></tr></table>`;

test('lee las dos fechas del Art. 96 y el resto de la ficha', () => {
  const f = parsearFicha(FICHA_SIE, 1976670)!;
  assert.ok(f, 'la ficha tiene que parsearse');
  assert.equal(f.codigo, 'SIE-CCFFAA-2025-027', 'el sufijo -Z<id> del SOCE no va en el código');
  assert.equal(f.entidad, 'COMANDO CONJUNTO');
  assert.equal(f.tipoContratacion, 'Subasta Inversa Electrónica');
  assert.equal(f.presupuesto, 77800.35, 'el presupuesto tiene separador de miles y va como número');
  assert.equal(f.fechaPublicacion, '2025-11-05 11:00:00');
  assert.equal(f.fechaLimitePreguntas, '2025-11-10 11:00:00');
  assert.equal(f.fechaLimiteRespuestas, '2025-11-12 16:00:00', 'este es el hito del Art. 96');
  assert.equal(f.fechaLimiteOfertas, '2025-11-17 16:00:00', 'y este el fin del término');
  assert.equal(f.origenHito, 'respuestas');
});

test('la fecha límite de PREGUNTAS no se confunde con la de RESPUESTAS', () => {
  // Es el error que arruinaría el indicador entero: los datos abiertos publican la de preguntas,
  // y el Art. 96 arranca en la de respuestas, dos días después en este proceso.
  const f = parsearFicha(FICHA_SIE, 1976670)!;
  assert.notEqual(f.fechaLimitePreguntas, f.fechaLimiteRespuestas);
});

test('en Régimen Especial el hito sale de la audiencia de preguntas y aclaraciones', () => {
  // Decisión de Oscar del 12-ago-2026: esa audiencia cuenta como el hito del Art. 96.
  const re = `<tr><th>C&oacute;digo:</th><td>RE-XYZ-2025-001</td></tr>
    <tr><th>Fecha l&iacute;mite de Audiencia de Preguntas y Aclaraciones</th><td>2025-11-12 16:00:00</td></tr>
    <tr><th>Fecha L&iacute;mite de Propuestas</th><td>2025-11-18 16:00:00</td></tr>`;
  const f = parsearFicha(re, 1)!;
  assert.equal(f.fechaLimiteRespuestas, '2025-11-12 16:00:00');
  assert.equal(f.fechaLimiteOfertas, '2025-11-18 16:00:00', 'Licitación y RE rotulan «Propuestas»');
  assert.equal(f.origenHito, 'audiencia', 'el origen se declara para poder publicarlo');
});

test('una ficha inexistente devuelve null en vez de un objeto vacío', () => {
  // El portal responde 200 con la plantilla vacía para un id que no existe.
  assert.equal(parsearFicha('<html><body>Sistema Oficial de Contratación</body></html>', 999), null);
});

test('un valor que no es una fecha no se acepta como fecha', () => {
  const raro = `<tr><th>C&oacute;digo:</th><td>SIE-X-1</td></tr>
    <tr><th>Fecha L&iacute;mite de Respuestas</th><td>No aplica</td></tr>`;
  assert.equal(parsearFicha(raro, 1)!.fechaLimiteRespuestas, null);
});

test('el código de un ocid quita el prefijo y el id de la ENTIDAD del final', () => {
  assert.equal(codigoDeOcid('ocds-5wno2w-SIE-IGM-2025-031-36136'), 'SIE-IGM-2025-031');
  assert.equal(codigoDeOcid('ocds-5wno2w-SIE-CCFFAA-2025-027-2539'), 'SIE-CCFFAA-2025-027');
  assert.equal(codigoDeOcid('ocds-5wno2w-RE-PU-HAGP-2024-006-17993'), 'RE-PU-HAGP-2024-006');
  assert.equal(codigoDeOcid(''), null);
});

test('el cruce solo se acepta si la fecha de preguntas coincide con la de los datos abiertos', () => {
  // Sin este testigo, un código repetido entre entidades publicaría fechas de OTRO proceso en una
  // ficha con nombre y apellido.
  assert.equal(cruceConfiable('2025-11-10 11:00:00', '2025-11-10T11:00:00-05:00'), true);
  assert.equal(cruceConfiable('2025-11-10 11:00:00', '2025-11-10T12:00:00-05:00'), false,
    'una hora distinta es otro proceso');
  assert.equal(cruceConfiable('2025-11-10 11:00:00', null), false, 'sin testigo no hay cruce');
  assert.equal(cruceConfiable(null, '2025-11-10T11:00:00-05:00'), false);
});

test('las entidades HTML del portal se decodifican', () => {
  assert.equal(decodificar('C&oacute;digo &amp; Contrataci&oacute;n'), 'Código & Contratación');
  assert.equal(decodificar('&#209;&#243;'), 'Ñó');
});

test('la URL de la ficha se arma con el id interno, nunca con el código', () => {
  // `ImprimirIPC2.cpe?id=SIE-DPNG-011-2019` responde 200 pero devuelve OTRO proceso: el portal
  // castea la cadena a entero. Siempre el número.
  assert.equal(urlFicha(1976670).endsWith('?id=1976670'), true);
});
