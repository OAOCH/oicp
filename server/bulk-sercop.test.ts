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
import http from 'http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { descargarPorRangos, objetosDeArray, releasesDelVolcado, urlVolcado } from './bulk-sercop.js';

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

// ── Descarga por RANGOS ──────────────────────────────────────────────────────────────────────
// Desde el 3-sep-2026 la fuente entrega cada conexión a 1-20 KB/s (el 12-ago iba a ~600 KB/s),
// pero el freno es POR CONEXIÓN y el servidor acepta `Range`: medido el 5-sep, 1 conexión da
// 2-20 KB/s, 4 dan 41, 8 dan 78 y 16 dan 150 KB/s. Estas pruebas levantan un servidor local que
// sirve rangos y comprueban que el fichero ensamblado es idéntico byte a byte, que un trozo que
// falla o llega corto se vuelve a pedir, y que si el servidor ignora el rango NO se ensambla basura.
type ModoServidor = {
  ignorarRange?: boolean;
  fallar?: Map<string, number>;   // rango → veces que responde 500
  cortar?: Map<string, number>;   // rango → veces que entrega la MITAD del trozo con cierre limpio
  con429?: Map<string, number>;   // rango → veces que responde 429
  con403?: Map<string, number>;   // rango → veces que responde 403 (bloqueo)
  corrido?: Set<string>;          // rangos que se sirven con 206 pero con OTRO Content-Range
  retryAfter?: string;            // cabecera Retry-After de los 429 (por defecto '0')
  lastModified?: string;          // versión del fichero remoto que anuncia el servidor
};

function servidorDeRangos(contenido: Buffer, modo: ModoServidor = {}) {
  const peticiones: string[] = [];
  const tiempos: number[] = [];   // Date.now() de cada petición, en el mismo orden que `peticiones`
  const srv = http.createServer((req, res) => {
    const r = String(req.headers.range || '');
    peticiones.push(r); tiempos.push(Date.now());
    if (modo.ignorarRange || !r) { res.writeHead(200, { 'Content-Length': contenido.length }); res.end(contenido); return; }
    const m = /bytes=(\d+)-(\d+)/.exec(r);
    if (!m) { res.writeHead(400); res.end(); return; }
    const a = Number(m[1]), b = Math.min(Number(m[2]), contenido.length - 1);
    const f = modo.fallar?.get(r) ?? 0;
    if (f > 0) { modo.fallar!.set(r, f - 1); res.writeHead(500); res.end('se cayó'); return; }
    const q = modo.con429?.get(r) ?? 0;
    if (q > 0) { modo.con429!.set(r, q - 1); res.writeHead(429, { 'Retry-After': modo.retryAfter ?? '0' }); res.end('despacio'); return; }
    const p = modo.con403?.get(r) ?? 0;
    if (p > 0) { modo.con403!.set(r, p - 1); res.writeHead(403); res.end('bloqueado'); return; }
    if (modo.corrido?.has(r)) {
      // 206 «válido» pero de OTRO tramo: un proxy o CDN que atiende el Range a su manera.
      res.writeHead(206, { 'Content-Range': `bytes ${a + 100}-${b + 100}/${contenido.length}`, 'Content-Length': b - a + 1 });
      res.end(contenido.subarray(a, b + 1)); return;
    }
    const c = modo.cortar?.get(r) ?? 0;
    if (c > 0) {
      // Respuesta HTTP impecable (Content-Length coherente, cierre limpio) pero con la MITAD de los
      // bytes pedidos: el transporte no protesta, así que solo la cuenta de bytes de la app lo ve.
      modo.cortar!.set(r, c - 1);
      const mitad = Math.floor((b - a + 1) / 2);
      res.writeHead(206, { 'Content-Range': `bytes ${a}-${b}/${contenido.length}`, 'Content-Length': mitad });
      res.end(contenido.subarray(a, a + mitad)); return;
    }
    res.writeHead(206, { 'Content-Range': `bytes ${a}-${b}/${contenido.length}`, 'Content-Length': b - a + 1, 'Last-Modified': modo.lastModified ?? 'Sat, 05 Sep 2026 00:00:00 GMT' });
    res.end(contenido.subarray(a, b + 1));
  });
  return new Promise<{ url: string; peticiones: string[]; tiempos: number[]; cerrar: () => Promise<void> }>(listo => {
    srv.listen(0, '127.0.0.1', () => {
      const puerto = (srv.address() as any).port;
      listo({ url: `http://127.0.0.1:${puerto}/volcado.zip`, peticiones, tiempos, cerrar: () => new Promise(r => srv.close(() => r())) });
    });
  });
}

/** Contenido determinista que no se repite por trozos: un trozo mal colocado se nota al comparar. */
function contenidoDe(n: number): Buffer {
  const b = Buffer.alloc(n);
  for (let i = 0; i < n; i++) b[i] = (i * 7 + (i >> 8) * 13 + (i >> 16) * 17) & 0xff;
  return b;
}

const TROZO = 64 * 1024;
const RAPIDO = { trozoBytes: TROZO, esperaBaseMs: 5, conexiones: 4 };
const rango = (i: number, total: number) => `bytes=${i * TROZO}-${Math.min((i + 1) * TROZO, total) - 1}`;

async function conFicheroTemporal(fn: (ruta: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'oicp-rangos-'));
  try { await fn(join(dir, 'volcado.zip')); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('la descarga por rangos con varias conexiones reproduce el fichero byte a byte', async () => {
  const contenido = contenidoDe(TROZO * 10 + 1234);   // el último trozo es más corto a propósito
  const srv = await servidorDeRangos(contenido);
  try {
    await conFicheroTemporal(async ruta => {
      const r = await descargarPorRangos(srv.url, ruta, RAPIDO);
      assert.equal(r.bytes, contenido.length);
      assert.equal(r.trozos, 11);
      assert.ok(readFileSync(ruta).equals(contenido), 'el fichero ensamblado difiere del original');
    });
    // el sondeo del tamaño más UN pedido por trozo, ninguno repetido
    assert.equal(srv.peticiones.filter(p => p !== 'bytes=0-0').length, 11);
  } finally { await srv.cerrar(); }
});

test('un trozo que FALLA se vuelve a pedir y el fichero sale entero', async () => {
  const contenido = contenidoDe(TROZO * 6);
  const roto = rango(3, contenido.length);
  const srv = await servidorDeRangos(contenido, { fallar: new Map([[roto, 2]]) });
  try {
    await conFicheroTemporal(async ruta => {
      await descargarPorRangos(srv.url, ruta, RAPIDO);
      assert.ok(readFileSync(ruta).equals(contenido));
    });
    assert.equal(srv.peticiones.filter(p => p === roto).length, 3, 'debió pedir el trozo roto tres veces');
  } finally { await srv.cerrar(); }
});

test('un trozo que llega CORTO no se da por bueno: se vuelve a pedir', async () => {
  // El servidor de pruebas responde un 206 impecable con la MITAD de los bytes y Content-Length
  // coherente: el transporte no ve nada raro y solo la cuenta de bytes de la app lo detecta (un corte
  // sucio con `terminated` lo atajaría undici solo, y esta prueba no probaría nada nuestro). Sin esa
  // cuenta el hueco quedaría relleno de ceros y el ZIP, corrupto.
  const contenido = contenidoDe(TROZO * 5);
  const corto = rango(1, contenido.length);
  const srv = await servidorDeRangos(contenido, { cortar: new Map([[corto, 1]]) });
  try {
    await conFicheroTemporal(async ruta => {
      await descargarPorRangos(srv.url, ruta, RAPIDO);
      assert.ok(readFileSync(ruta).equals(contenido), 'el trozo cortado quedó a medias en el fichero');
    });
    assert.equal(srv.peticiones.filter(p => p === corto).length, 2);
  } finally { await srv.cerrar(); }
});

test('si el servidor IGNORA el rango se rechaza en vez de ensamblar basura', async () => {
  const contenido = contenidoDe(TROZO * 3);
  const srv = await servidorDeRangos(contenido, { ignorarRange: true });
  try {
    await conFicheroTemporal(async ruta => {
      await assert.rejects(descargarPorRangos(srv.url, ruta, RAPIDO), /rangos/);
    });
  } finally { await srv.cerrar(); }
});

test('un 429 frena a TODAS las conexiones y luego se reintenta; el fichero sale entero', async () => {
  // Retry-After de 1 s en UN trozo: ninguna otra conexión debe abrir una petición nueva durante ese
  // segundo (el freno es compartido, como en limitador.ts), y el trozo frenado se vuelve a pedir.
  const contenido = contenidoDe(TROZO * 8);
  const frenado = rango(2, contenido.length);
  const srv = await servidorDeRangos(contenido, { con429: new Map([[frenado, 1]]), retryAfter: '1' });
  try {
    await conFicheroTemporal(async ruta => {
      await descargarPorRangos(srv.url, ruta, { ...RAPIDO, conexiones: 2 });
      assert.ok(readFileSync(ruta).equals(contenido));
    });
    assert.equal(srv.peticiones.filter(p => p === frenado).length, 2);
    const t429 = srv.tiempos[srv.peticiones.indexOf(frenado)];
    // Las peticiones posteriores al 429 (100 ms de margen para la que ya estaba en vuelo) tuvieron
    // que esperar el segundo entero, vinieran de la conexión frenada o de la otra.
    const despues = srv.tiempos.filter(t => t > t429 + 100);
    assert.ok(despues.length >= 2, 'la prueba necesita peticiones posteriores al 429 para medir el freno');
    for (const t of despues) assert.ok(t >= t429 + 950, `una conexión pidió a los ${t - t429} ms del 429: el freno no es compartido`);
  } finally { await srv.cerrar(); }
});

test('un 429 en el SONDEO se reintenta en vez de declarar que el servidor no acepta rangos', async () => {
  const contenido = contenidoDe(TROZO * 3);
  const srv = await servidorDeRangos(contenido, { con429: new Map([['bytes=0-0', 1]]) });
  try {
    await conFicheroTemporal(async ruta => {
      await descargarPorRangos(srv.url, ruta, RAPIDO);
      assert.ok(readFileSync(ruta).equals(contenido));
    });
    assert.equal(srv.peticiones.filter(p => p === 'bytes=0-0').length, 2, 'el sondeo debió repetirse tras el 429');
  } finally { await srv.cerrar(); }
});

test('un 403 en el SONDEO aborta sin reintentar', async () => {
  const contenido = contenidoDe(TROZO * 3);
  const srv = await servidorDeRangos(contenido, { con403: new Map([['bytes=0-0', 1]]) });
  try {
    await conFicheroTemporal(async ruta => {
      await assert.rejects(descargarPorRangos(srv.url, ruta, RAPIDO), /HTTP 403/);
    });
    assert.equal(srv.peticiones.length, 1, 'tras el 403 del sondeo no debe haber ni una petición más');
  } finally { await srv.cerrar(); }
});

test('un 206 con OTRO Content-Range se rechaza: nunca se escribe un trozo en el sitio equivocado', async () => {
  const contenido = contenidoDe(TROZO * 3);
  const corrido = rango(1, contenido.length);
  const srv = await servidorDeRangos(contenido, { corrido: new Set([corrido]) });
  try {
    await conFicheroTemporal(async ruta => {
      await assert.rejects(descargarPorRangos(srv.url, ruta, { ...RAPIDO, intentosPorTrozo: 2 }), /Content-Range inesperado/);
    });
  } finally { await srv.cerrar(); }
});

test('un 403 (bloqueo) NO se reintenta: se aborta de inmediato para no insistirle a la fuente', async () => {
  // La IP de la PC es la única desde la que este proyecto puede leer al SERCOP. Si la fuente
  // bloquea, insistir seis veces por trozo y luego con el año siguiente es lo peor que se puede
  // hacer: el primer 403 corta la descarga entera.
  const contenido = contenidoDe(TROZO * 4);
  const bloqueado = rango(1, contenido.length);
  const srv = await servidorDeRangos(contenido, { con403: new Map([[bloqueado, 1]]) });
  try {
    await conFicheroTemporal(async ruta => {
      await assert.rejects(descargarPorRangos(srv.url, ruta, RAPIDO), /HTTP 403/);
    });
    assert.equal(srv.peticiones.filter(p => p === bloqueado).length, 1, 'un 403 no debe reintentarse');
  } finally { await srv.cerrar(); }
});

test('una descarga interrumpida se REANUDA: solo se vuelven a pedir los trozos que faltaban', async () => {
  // Pasó de verdad el 5-sep-2026: un trozo de 2019 falló seis veces seguidas con `terminated` al
  // 93% y el año entero (111 MB, 45 minutos) se tiró y empezó de cero. Los trozos verificados se
  // apuntan en un fichero de partes y la siguiente llamada solo pide lo que falta.
  const contenido = contenidoDe(TROZO * 8);
  const roto = rango(3, contenido.length);
  const modo: ModoServidor = { fallar: new Map([[roto, 99]]) };
  const srv = await servidorDeRangos(contenido, modo);
  try {
    await conFicheroTemporal(async ruta => {
      await assert.rejects(descargarPorRangos(srv.url, ruta, { ...RAPIDO, intentosPorTrozo: 2 }), /trozo 196608-262143/);
      const partes = JSON.parse(readFileSync(`${ruta}.partes.json`, 'utf8'));
      assert.ok(partes.hechos.length >= 1 && partes.hechos.length < 8, `partes guardadas: ${partes.hechos.length}`);
      assert.ok(!partes.hechos.includes(3), 'el trozo que falló no puede figurar como hecho');
      const antes = srv.peticiones.length;
      modo.fallar!.clear();
      const r = await descargarPorRangos(srv.url, ruta, RAPIDO);
      assert.equal(r.bytes, contenido.length);
      assert.ok(readFileSync(ruta).equals(contenido), 'el fichero reanudado difiere del original');
      const segunda = srv.peticiones.slice(antes).filter(p => p !== 'bytes=0-0');
      assert.equal(segunda.length, 8 - partes.hechos.length, 'la reanudación pidió trozos que ya estaban en disco');
      assert.ok(!existsSync(`${ruta}.partes.json`), 'al terminar bien no debe quedar el fichero de partes');
    });
  } finally { await srv.cerrar(); }
});

test('si el fichero remoto CAMBIÓ (otro Last-Modified) no se reanuda: se baja entero otra vez', async () => {
  // El SERCOP regenera los volcados (2025 y 2026 cambiaron el 4-sep). Mezclar trozos de dos
  // versiones daría un ZIP corrupto sin ningún aviso.
  const contenido = contenidoDe(TROZO * 6);
  const roto = rango(2, contenido.length);
  const modo: ModoServidor = { fallar: new Map([[roto, 99]]), lastModified: 'Fri, 04 Sep 2026 20:12:12 GMT' };
  const srv = await servidorDeRangos(contenido, modo);
  try {
    await conFicheroTemporal(async ruta => {
      await assert.rejects(descargarPorRangos(srv.url, ruta, { ...RAPIDO, intentosPorTrozo: 2 }));
      modo.fallar!.clear();
      modo.lastModified = 'Sat, 05 Sep 2026 09:00:00 GMT';
      const antes = srv.peticiones.length;
      await descargarPorRangos(srv.url, ruta, RAPIDO);
      assert.ok(readFileSync(ruta).equals(contenido));
      assert.equal(srv.peticiones.slice(antes).filter(p => p !== 'bytes=0-0').length, 6, 'con otra versión del fichero hay que pedir TODOS los trozos');
    });
  } finally { await srv.cerrar(); }
});

test('un trozo que falla TODAS las veces tumba la descarga con un error claro', async () => {
  const contenido = contenidoDe(TROZO * 3);
  const roto = rango(1, contenido.length);
  const srv = await servidorDeRangos(contenido, { fallar: new Map([[roto, 99]]) });
  try {
    await conFicheroTemporal(async ruta => {
      await assert.rejects(descargarPorRangos(srv.url, ruta, { ...RAPIDO, intentosPorTrozo: 3 }), /trozo 65536-131071/);
    });
  } finally { await srv.cerrar(); }
});
