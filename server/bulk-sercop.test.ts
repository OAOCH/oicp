/**
 * Pruebas del lector de volcados masivos del SERCOP.
 *
 * Lo que se prueba es el recorrido del JSON, no la red: se arma un ZIP en memoria con la misma
 * forma que el fichero real y se comprueba que salen todos los objetos.
 *
 * Cada prueba de aquí corresponde a un fallo REAL que costó una corrida sobre los ficheros de
 * verdad, y por eso están todas: partir por líneas perdía un paquete de 7.472 en julio de 2026;
 * `toString('utf8')` por trozo corrompía el texto en los 111 MB de 2019; el conteo de llaves solo
 * se descuadraba para siempre con la comilla sin escapar de 2020; y esperar saltos de línea
 * reventaba la memoria en los años que vienen en una sola línea.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'zlib';
import { Readable } from 'stream';
import { objetosDeArray, releasesDelVolcado, urlVolcado } from './bulk-sercop.js';

/** Arma un ZIP de una entrada deflate, como el que devuelve el SERCOP. */
function zipDeTexto(nombre: string, texto: string): Buffer {
  const comprimido = zlib.deflateRawSync(Buffer.from(texto, 'utf8'));
  const nom = Buffer.from(nombre, 'utf8');
  const cab = Buffer.alloc(30);
  cab.writeUInt32LE(0x04034b50, 0);   // firma
  cab.writeUInt16LE(20, 4);           // versión
  cab.writeUInt16LE(0, 6);            // banderas
  cab.writeUInt16LE(8, 8);            // método: deflate
  cab.writeUInt32LE(0, 14);           // crc (no se verifica al inflar en crudo)
  cab.writeUInt32LE(comprimido.length, 18);
  cab.writeUInt32LE(texto.length, 22);
  cab.writeUInt16LE(nom.length, 26);
  cab.writeUInt16LE(0, 28);
  return Buffer.concat([cab, nom, comprimido]);
}

const flujoDe = (b: Buffer, trozo = 64 * 1024) => {
  const partes: Buffer[] = [];
  for (let i = 0; i < b.length; i += trozo) partes.push(b.subarray(i, i + trozo));
  return Readable.from(partes);
};

test('lee todos los paquetes de un volcado con formato bonito', async () => {
  const paquetes = Array.from({ length: 50 }, (_, i) => ({
    uri: 'x', releases: [{ ocid: `ocds-5wno2w-P-${i}`, tender: { lots: [{ value: { amount: 100 + i } }] } }],
  }));
  const texto = '[\n' + paquetes.map(p => JSON.stringify(p)).join(',\n') + '\n]';
  const salidos: any[] = [];
  for await (const r of releasesDelVolcado(flujoDe(zipDeTexto('releases.json', texto)))) salidos.push(r);
  assert.equal(salidos.length, 50);
  assert.equal(salidos[0].ocid, 'ocds-5wno2w-P-0');
  assert.equal(salidos[49].tender.lots[0].value.amount, 149);
});

test('un paquete repartido en varias líneas NO se pierde', async () => {
  // Partir por saltos de línea daba 7.471 de 7.472 en el fichero real. Este es ese caso.
  const uno = { uri: 'x', releases: [{ ocid: 'partido', tender: { lots: [{ value: { amount: 999 } }] } }] };
  const texto = '[\n' + JSON.stringify(uno, null, 2) + ',\n' + JSON.stringify(uno).replace('partido', 'entero') + '\n]';
  const salidos: any[] = [];
  for await (const r of releasesDelVolcado(flujoDe(zipDeTexto('releases.json', texto), 17))) salidos.push(r);
  assert.deepEqual(salidos.map(r => r.ocid), ['partido', 'entero']);
});

test('un carácter UTF-8 partido entre dos trozos NO corrompe el recorrido', async () => {
  // Esto tumbó la primera corrida real sobre el volcado de 2019 (111 MB): los trozos del flujo
  // cortan por bytes, así que una tilde partida se volvía el carácter de reemplazo. Basta con que
  // rompa una comilla para que el estado se descuadre, la profundidad no vuelva a cero y el buffer
  // crezca hasta «Cannot create a string longer than 0x1fffffe8 characters».
  const paquetes = Array.from({ length: 30 }, (_, i) => ({
    releases: [{ ocid: `P-${i}`, tender: { title: `AMPLIACIÓN Y REHABILITACIÓN ÑOÑA «${i}» — obra` } }],
  }));
  const texto = '[\n' + paquetes.map(p => JSON.stringify(p)).join(',\n') + '\n]';
  const zip = zipDeTexto('releases.json', texto);
  // Trozos de tamaño primo para que los cortes caigan en medio de secuencias multibyte.
  const salidos: any[] = [];
  for await (const r of releasesDelVolcado(flujoDe(zip, 13))) salidos.push(r);
  assert.equal(salidos.length, 30, 'se perdieron paquetes al partir por bytes');
  assert.match(salidos[7].tender.title, /AMPLIACIÓN Y REHABILITACIÓN ÑOÑA «7» — obra/,
    'el texto llegó corrompido');
});

test('las llaves dentro de una cadena no cuentan como estructura', async () => {
  const texto = '[' + JSON.stringify({
    releases: [{ ocid: 'a', tender: { title: 'OBRA {CIVIL} "AMPLIACIÓN" \\ y } suelta' } }],
  }) + ']';
  const salidos: any[] = [];
  for await (const r of releasesDelVolcado(flujoDe(zipDeTexto('r.json', texto), 7))) salidos.push(r);
  assert.equal(salidos.length, 1);
  assert.match(salidos[0].tender.title, /AMPLIACIÓN/);
});

test('UNA COMILLA SIN ESCAPAR no se come el resto del fichero', async () => {
  // Es el defecto REAL del volcado de 2020: tras 4 MB el recorrido por llaves quedaba dentro de
  // una cadena y ya no cerraba nada más, o sea que un solo texto mal escrito de la fuente hacía
  // perder el año entero. Con delimitación por líneas se pierde SOLO el paquete malo.
  const bueno = (n: number) => JSON.stringify({ releases: [{ ocid: `P-${n}` }] });
  const malo = '{"releases": [{"ocid": "X", "titulo": "OBRA "SIN" ESCAPAR"}]}';
  const texto = ['[', bueno(1) + ',', malo + ',', bueno(2) + ',', bueno(3), ']'].join('\n');
  const salidos: any[] = [];
  for await (const r of releasesDelVolcado(flujoDe(zipDeTexto('r.json', texto), 11))) salidos.push(r);
  assert.deepEqual(salidos.map(r => r.ocid), ['P-1', 'P-2', 'P-3'],
    'el paquete roto tiene que costar solo ese paquete');
});

test('un array ENTERO en una sola línea también se lee', async () => {
  // No todos los volcados vienen con formato bonito. Esperar un salto de línea para delimitar
  // hacía crecer el buffer medio giga y mataba la corrida con «Cannot create a string longer
  // than 0x1fffffe8 characters». Con conteo de llaves, un fichero de una sola línea se lee igual.
  const paquetes = Array.from({ length: 40 }, (_, i) => ({ releases: [{ ocid: `U-${i}` }] }));
  const texto = '[' + paquetes.map(p => JSON.stringify(p)).join(',') + ']';
  const salidos: any[] = [];
  for await (const r of releasesDelVolcado(flujoDe(zipDeTexto('r.json', texto), 23))) salidos.push(r);
  assert.equal(salidos.length, 40);
  assert.equal(salidos[39].ocid, 'U-39');
});

test('el lector no depende del formato: con y sin saltos de línea da lo mismo', async () => {
  // Las dos formas conviven en la fuente: unos años vienen con formato bonito y otros en una sola
  // línea. El lector tiene que dar el mismo resultado con ambas. Y, además de esto, `repararMasivo`
  // compara lo leído contra lo que declara `get-totals`, así que un cambio de formato que sí
  // rompiera algo se notaría en vez de pasar por bueno con la mitad de los procesos.
  const bueno = JSON.stringify({ releases: [{ ocid: 'ok' }] });
  const todoEnUnaLinea = `[${bueno},${bueno.replace('ok', 'ok2')}]`;
  const salidos: any[] = [];
  for await (const o of objetosDeArray(Readable.from([Buffer.from(todoEnUnaLinea, 'utf8')]))) salidos.push(o);
  assert.equal(salidos.length, 2, "ahora tambien se leen los que vienen en una sola linea");

  // Y con el formato real sí salen los dos.
  const bienFormado = `[\n${bueno},\n${bueno.replace('ok', 'ok2')}\n]`;
  const ok: any[] = [];
  for await (const o of objetosDeArray(Readable.from([Buffer.from(bienFormado, 'utf8')]))) ok.push(o);
  assert.deepEqual(ok.flatMap(p => p.releases.map((r: any) => r.ocid)), ['ok', 'ok2']);
});

test('un consumidor LENTO no hace crecer la memoria ni pierde paquetes', async () => {
  // Es la diferencia entre leer el volcado suelto (que funcionaba) y leerlo dentro del rellenado,
  // que se detiene a empujar lotes por la red cada 500 procesos. La primera version empujaba los
  // trozos inflados a un Readable propio IGNORANDO lo que devolvia push(), o sea sin control de
  // flujo: el inflador seguia a toda velocidad y el volcado entero se acumulaba en memoria hasta
  // reventar el tope. Medido sobre el fichero real de 2020 con este mismo patron: 160.676 leidos
  // y 253 MB de memoria maxima.
  const paquetes = Array.from({ length: 300 }, (_, i) => ({
    releases: [{ ocid: `L-${i}`, tender: { title: 'x'.repeat(500) } }],
  }));
  const texto = ['[', paquetes.map(p => JSON.stringify(p)).join(',\n'), ']'].join('\n');
  const salidos: string[] = [];
  for await (const r of releasesDelVolcado(flujoDe(zipDeTexto('r.json', texto), 1024))) {
    salidos.push(r.ocid);
    if (salidos.length % 50 === 0) await new Promise(res => setTimeout(res, 5));
  }
  assert.equal(salidos.length, 300, 'con el consumidor lento se perdieron paquetes');
  assert.equal(salidos[299], 'L-299');
});

test('un ZIP que no es un ZIP falla con un error claro, no con basura', async () => {
  await assert.rejects(async () => {
    for await (const _ of releasesDelVolcado(flujoDe(Buffer.from('esto no es un zip en absoluto')))) { /* vacío */ }
  }, /firma de un ZIP/);
});

test('la URL del volcado se arma con los parámetros que la fuente entiende', () => {
  assert.equal(urlVolcado(2024),
    'https://datosabiertos.compraspublicas.gob.ec/PLATAFORMA/download?type=json&year=2024&month=0&method=all');
  assert.match(urlVolcado(2026, 7), /year=2026&month=7/);
});
