/**
 * Pruebas del lector de volcados masivos del SERCOP.
 *
 * Lo que se prueba es el recorrido del JSON, no la red: se arma un ZIP en memoria con la misma
 * forma que el fichero real (una entrada deflate con un array JSON con formato bonito) y se
 * comprueba que salen todos los objetos.
 *
 * La prueba del objeto partido en varias líneas existe porque el primer intento de leer estos
 * volcados partía el texto por saltos de línea, y en el fichero real de julio de 2026 eso dejó
 * UN paquete sin parsear de 7.472. Un fallo del 0,01% que habría pasado inadvertido y habría
 * dejado procesos sin reparar sin que nada lo dijera.
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

test('las llaves dentro de una cadena no cuentan como estructura', async () => {
  const texto = '[' + JSON.stringify({
    releases: [{ ocid: 'a', tender: { title: 'OBRA {CIVIL} "AMPLIACIÓN" \\ y } suelta' } }],
  }) + ']';
  const salidos: any[] = [];
  for await (const r of releasesDelVolcado(flujoDe(zipDeTexto('r.json', texto), 7))) salidos.push(r);
  assert.equal(salidos.length, 1);
  assert.match(salidos[0].tender.title, /AMPLIACIÓN/);
});

test('un objeto con llaves balanceadas pero JSON inválido se salta y NO tumba el barrido', async () => {
  // Alcance real de la recuperación: el recorrido delimita objetos CONTANDO LLAVES, así que se
  // recupera de un objeto que no es JSON válido pero está bien cerrado. De un fichero con llaves
  // descuadradas no puede recuperarse nadie que no reparse el documento entero, y no hace falta:
  // estos volcados los genera una máquina y el error real que se vio (un paquete perdido de
  // 7.472) venía de partir por líneas, no de llaves rotas.
  const bueno = JSON.stringify({ releases: [{ ocid: 'ok' }] });
  const texto = `[${bueno},{"releases": , "roto": },${bueno.replace('ok', 'ok2')}]`;
  const salidos: any[] = [];
  // Aquí se prueba el recorrido del JSON directamente, así que el flujo va SIN comprimir.
  for await (const o of objetosDeArray(Readable.from([Buffer.from(texto, 'utf8')]))) salidos.push(o);
  const ocids = salidos.flatMap(p => (p.releases || []).map((r: any) => r.ocid));
  assert.deepEqual(ocids, ['ok', 'ok2'], `salieron: ${ocids.join(',')}`);
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
