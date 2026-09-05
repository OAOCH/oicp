/**
 * Descarga MASIVA de datos abiertos del SERCOP.
 *
 * Existe un endpoint de volcado por año que la documentación de la API NO menciona y que cambia
 * por completo el coste de releer el corpus:
 *
 *   https://datosabiertos.compraspublicas.gob.ec/PLATAFORMA/download?type=json&year=YYYY&month=0&method=all
 *
 * Medido el 2026-08-12 contra la ruta que veníamos usando (`record?ocid=`, una petición por
 * proceso, p50 de 7 a 12 s):
 *
 *   releer 174.547 procesos uno por uno  ->  ~54 horas y 174.547 peticiones
 *   releer TODO el corpus por volcados   ->  ~20 minutos y 8 peticiones (989 MB para 2019-2026)
 *
 * `month=0` es el año entero; `1..12` un mes suelto. `get-totals` con los mismos parámetros
 * devuelve `{"count":N}` y sirve para comprobar que el volcado llegó completo antes de darlo por
 * bueno. Esta ruta NO devolvió 429 en ninguna prueba, a diferencia de `/PLATAFORMA/api/*`, que
 * tiene un cupo de 60 por minuto COMPARTIDO entre clientes: en esa otra ruta no se puede planificar
 * un ritmo desde nuestro lado por educados que seamos.
 *
 * FORMATO, comprobado abriendo el fichero: un ZIP con UNA entrada deflate
 * (`releases_2026_julio.json`) que contiene un ARRAY JSON con formato bonito, un paquete OCDS por
 * línea. No se puede hacer `JSON.parse` del contenido entero: el volcado de 2024 pesa 152,9 MB
 * comprimidos y 1,54 GB en claro, muy por encima del límite de una cadena de Node. Y tampoco basta
 * con partir por líneas: al menos un paquete por fichero no cabe en una sola. Por eso aquí se
 * recorre el flujo contando llaves, respetando comillas y escapes, y se emite cada objeto de
 * primer nivel en cuanto se cierra. Memoria acotada al objeto más grande, no al fichero.
 */
import zlib from 'zlib';
import { Readable, Transform, pipeline } from 'stream';

export const BULK_URL = 'https://datosabiertos.compraspublicas.gob.ec/PLATAFORMA/download';
export const TOTALS_URL = 'https://datosabiertos.compraspublicas.gob.ec/PLATAFORMA/get-totals';

export function urlVolcado(year: number, month = 0): string {
  return `${BULK_URL}?type=json&year=${year}&month=${month}&method=all`;
}

/** Cuántos releases dice la fuente que tiene ese año. Sirve para verificar completitud. */
export async function totalDeclarado(year: number, month = 0): Promise<number | null> {
  try {
    const res = await fetch(`${TOTALS_URL}?year=${year}&month=${month}&method=all`,
      { headers: { 'User-Agent': 'OICP-sync' }, signal: AbortSignal.timeout(120000) });
    if (!res.ok) return null;
    const j = await res.json() as any;
    const n = Number(j?.count);
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

/**
 * Quita la cabecera local del ZIP y devuelve el flujo ya inflado.
 *
 * La cabecera son 30 bytes fijos más el nombre y el campo extra, cuyas longitudes están en los
 * offsets 26 y 28. Se acumulan bytes hasta tenerla entera y a partir de ahí todo pasa por
 * inflateRaw. Solo se contempla el método 8 (deflate), que es el que usa esta fuente; cualquier
 * otro se rechaza en vez de devolver basura silenciosamente.
 */
function desempaquetar(entrada: Readable): Readable {
  // Se compone con `pipe`, no con `push` a mano. La primera versión empujaba los trozos inflados a
  // un Readable propio ignorando lo que devolvía `push()`, o sea SIN control de flujo: cuando el
  // consumidor se detenía a empujar lotes por la red (lo que hace el rellenado cada 500 procesos)
  // el inflador seguía a toda velocidad y el volcado entero se acumulaba en memoria. Al intentar
  // añadirle el control de flujo a mano, el resultado fue un bloqueo mutuo: nadie reanudaba el
  // inflador. Encadenando con `pipe`, Node ya resuelve las dos cosas y no hay nada que inventar.
  let cabecera: Buffer = Buffer.alloc(0);
  let listo = false;
  const quitarCabecera = new Transform({
    transform(trozo: Buffer, _enc, cb) {
      if (listo) { cb(null, trozo); return; }
      cabecera = Buffer.concat([cabecera, trozo]);
      // La firma se comprueba en cuanto hay 4 bytes. Si se esperara a tener los 30 de la cabecera,
      // una respuesta corta que no es un ZIP (una página de error) nunca llegaría a validarse y el
      // fallo saldría como un críptico "unexpected end of file" del inflador.
      if (cabecera.length >= 4 && cabecera.readUInt32LE(0) !== 0x04034b50) {
        cb(new Error('el volcado no empieza por la firma de un ZIP')); return;
      }
      if (cabecera.length < 30) { cb(); return; }
      const metodo = cabecera.readUInt16LE(8);
      const nlen = cabecera.readUInt16LE(26), elen = cabecera.readUInt16LE(28);
      const inicio = 30 + nlen + elen;
      if (cabecera.length < inicio) { cb(); return; }
      if (metodo !== 8) {
        cb(new Error(`método de compresión ${metodo} no contemplado (se espera 8, deflate)`)); return;
      }
      listo = true;
      const datos = cabecera.subarray(inicio);
      cabecera = Buffer.alloc(0);
      cb(null, datos);
    },
  });

  const inflate = zlib.createInflateRaw();
  // pipeline() y no pipe() + reenvio manual de errores: destruir inflate "a mano" emite
  // 'error' en un tick donde el for await consumidor puede no estar enganchado todavia, y un
  // 'error' sin listener tumba el proceso entero (uncaughtException; en Node 22 mataba el
  // runner de tests del CI). pipeline consume ese evento y deja el stream marcado como
  // errado, asi que el iterador recibe el mismo error sin depender del orden de los ticks.
  pipeline(entrada, quitarCabecera, inflate, () => { /* el error ya viaja en inflate */ });
  return inflate;
}

/**
 * Recorre un array JSON emitiendo cada objeto de primer nivel, sin cargarlo entero en memoria.
 * Cuenta llaves ignorando las que van dentro de una cadena y respetando los escapes.
 */
export async function* objetosDeArray(flujo: Readable): AsyncGenerator<any> {
  // ── Por qué NO se cuentan llaves ──────────────────────────────────────────────────────────
  // El primer intento delimitaba los objetos contando `{` y `}` fuera de cadena. Funcionó con el
  // volcado de 2019 (275.055 releases, exactamente los que declara la fuente) y se descuadró en el
  // de 2020: medido, tras 4 MB el recorrido quedaba DENTRO de una cadena, o sea que el fichero
  // trae una comilla sin escapar dentro de un texto. Es JSON inválido de origen, y contra eso el
  // conteo de llaves no tiene defensa: una vez desincronizado, ya no vuelve a cerrar nada y se
  // come el fichero entero.
  //
  // La delimitación robusta para ESTE formato es por líneas, y descansa en una garantía del
  // propio JSON: un salto de línea CRUDO no puede aparecer dentro de una cadena (tiene que ir
  // escapado como \n). Así que un `{` a principio de línea, sin sangría, siempre es el comienzo
  // de un paquete de primer nivel; los objetos anidados van sangrados. Si un paquete resulta
  // ilegible se pierde SOLO ese, porque la siguiente línea que empiece por `{` resincroniza.
  // ── Y por qué tampoco basta con partir por líneas ────────────────────────────────────────
  // La segunda corrida murió con «Cannot create a string longer than 0x1fffffe8 characters»
  // procesando otro año: no todos los volcados vienen con formato bonito. Algunos traen el array
  // ENTERO en una sola línea, así que esperar un salto de línea hace crecer el buffer medio giga.
  //
  // La forma que sobrevive a las dos es contar llaves CON RESINCRONIZACIÓN por salto de línea, y
  // se apoya en una garantía del propio JSON: un salto de línea CRUDO no puede aparecer dentro de
  // una cadena, tiene que ir escapado. Entonces:
  //   - si aparece un `\n` mientras creemos estar dentro de una cadena, sabemos con certeza que
  //     perdimos la sincronía (una comilla sin escapar, como la del volcado de 2020);
  //   - y un `\n` seguido de `{` es, sin lugar a dudas, el comienzo de un paquete nuevo, así que
  //     se descarta lo que hubiera a medias y se retoma limpio.
  // En un fichero de una sola línea nunca se usa la resincronización y funciona el conteo puro.
  // `StringDecoder` y no `trozo.toString('utf8')`: los trozos del flujo cortan por bytes, no por
  // caracteres, así que una tilde o una eñe partida entre dos trozos se convertía en el carácter
  // de reemplazo y CORROMPÍA el texto. Con 111 MB de castellano eso pasa muchas veces, y basta
  // con que rompa una comilla para que el estado de "dentro de una cadena" se descuadre: entonces
  // la profundidad no vuelve a cero, el buffer crece sin freno y la corrida muere con
  // «Cannot create a string longer than 0x1fffffe8 characters». Pasó en el volcado de 2019.
  const { StringDecoder } = await import('string_decoder');
  const decodificador = new StringDecoder('utf8');
  // Si la profundidad no vuelve a cero, algo está mal en el fichero o en este recorrido: mejor
  // fallar con un mensaje claro que consumir memoria hasta reventar.
  const TOPE_OBJETO = 128 * 1024 * 1024;
  let buf = '';          // texto pendiente de recorrer
  let pos = 0;           // hasta dónde se recorrió YA (sin él se recontarían las llaves)
  let prof = 0, inicio = -1, enCadena = false, escapado = false;

  const objetos: any[] = [];
  const cerrar = (hasta: number) => {
    if (inicio < 0) return;
    const crudo = buf.slice(inicio, hasta);
    try { objetos.push(JSON.parse(crudo)); } catch { /* paquete ilegible: se pierde SOLO este */ }
  };

  const procesar = function* (): Generator<any> {
    while (pos < buf.length) {
      const c = buf[pos];

      // Resincronización: un salto de línea CRUDO es imposible dentro de una cadena JSON.
      if (c === '\n') {
        if (enCadena) { enCadena = false; escapado = false; }
        // `\n{` es el comienzo indudable de un paquete nuevo: lo que hubiera a medias se descarta.
        if (buf[pos + 1] === '{') {
          if (prof === 0 && inicio >= 0) cerrar(pos);
          buf = buf.slice(pos + 1); pos = 0;
          prof = 0; inicio = 0; enCadena = false; escapado = false;
          prof = 1; pos = 1;   // ya consumimos la `{` de apertura
          for (const o of objetos.splice(0)) yield o;
          continue;
        }
        pos++; continue;
      }

      if (enCadena) {
        if (escapado) escapado = false;
        else if (c === '\\') escapado = true;
        else if (c === '"') enCadena = false;
        pos++; continue;
      }
      if (c === '"') { enCadena = true; pos++; continue; }
      if (c === '{') { if (prof === 0) inicio = pos; prof++; pos++; continue; }
      if (c === '}') {
        prof--;
        if (prof === 0 && inicio >= 0) {
          cerrar(pos + 1);
          buf = buf.slice(pos + 1); pos = 0; inicio = -1;
          for (const o of objetos.splice(0)) yield o;
          continue;
        }
        pos++; continue;
      }
      pos++;
    }
    // Se suelta todo lo ya consumido. Si hay un objeto a medias se conserva DESDE su primera
    // llave, no desde el principio del buffer: sin este recorte, el texto entre objetos
    // (separadores, sangrías) se acumulaba corrida tras corrida y el tope de 128 MB saltaba
    // aunque ningún objeto fuera grande. Es lo que mató la corrida de 2020 dentro del rellenado,
    // donde el consumidor se detiene a empujar por red y el buffer tiene tiempo de crecer.
    if (prof === 0 && !enCadena && inicio < 0) { buf = ''; pos = 0; }
    else if (inicio > 0) { buf = buf.slice(inicio); pos -= inicio; inicio = 0; }
  };

  for await (const trozo of flujo) {
    buf += decodificador.write(Buffer.isBuffer(trozo) ? trozo : Buffer.from(trozo));
    if (buf.length > TOPE_OBJETO) {
      throw new Error(`paquete JSON de más de ${TOPE_OBJETO} bytes sin cerrar: el volcado no tiene la forma esperada`);
    }
    yield* procesar();
  }
  buf += decodificador.end();
  yield* procesar();
}

/** Todos los releases de un volcado, uno a uno. `origen` es una URL o un fichero local. */
export async function* releasesDelVolcado(origen: Readable): AsyncGenerator<any> {
  for await (const paquete of objetosDeArray(desempaquetar(origen))) {
    for (const rel of (paquete?.releases || [])) yield rel;
  }
}

/** Abre el volcado de un año como flujo directamente desde la red. */
export async function abrirVolcado(year: number, month = 0): Promise<Readable> {
  const res = await fetch(urlVolcado(year, month),
    { headers: { 'User-Agent': 'OICP-sync' }, signal: AbortSignal.timeout(1800000) });
  if (!res.ok) throw new Error(`volcado ${year}/${month}: HTTP ${res.status}`);
  if (!res.body) throw new Error(`volcado ${year}/${month}: sin cuerpo`);
  return Readable.fromWeb(res.body as any);
}

/**
 * Descarga por RANGOS con varias conexiones a la vez.
 *
 * Desde el 3-sep-2026 la fuente entrega cada conexión a 1-20 KB/s (el 12-ago iba a ~600 KB/s):
 * un volcado anual de 160 MB tardaría horas y la conexión se corta antes (`terminated`). Medido
 * el 5-sep contra el volcado mensual de agosto de 2026: el freno es POR CONEXIÓN y el servidor
 * acepta `Range` (206) en los ocho volcados anuales. 1 conexión: 2-20 KB/s · 4: 41 · 8: 78 ·
 * 16: 150 KB/s. Con 16 conexiones el corpus entero (1,05 GB) baja en ~2 horas en vez de días.
 *
 * Cómo: un sondeo `Range: bytes=0-0` da el tamaño total y demuestra que el servidor respeta el
 * rango; si contesta 200 se aborta, porque ensamblar respuestas enteras como si fueran trozos
 * produciría un fichero corrupto sin ningún aviso. El fichero se crea del tamaño final y cada
 * trozo se escribe en su offset. Cada trozo exige 206, un `Content-Range` exactamente igual al
 * pedido y la cuenta exacta de bytes: un trozo corto (la fuente corta conexiones a mitad) se
 * vuelve a pedir, nunca se da por bueno. Un 429 frena a TODAS las conexiones (la misma lección
 * que `limitador.ts`) y un 403 aborta sin reintentar: la IP de la PC es la única desde la que se
 * puede leer la fuente. Al final se comprueba el tamaño del fichero contra el total declarado.
 */
export interface OpcionesRangos {
  conexiones?: number;        // conexiones simultáneas (por defecto 8)
  trozoBytes?: number;        // tamaño de cada trozo (por defecto 1 MB: a 6 KB/s por conexión son ~3 min)
  intentosPorTrozo?: number;  // intentos por trozo (por defecto 6)
  esperaBaseMs?: number;      // espera entre intentos, multiplicada por el número de intento
  timeoutTrozoMs?: number;    // tope por trozo (por defecto 10 min): una conexión estancada se corta y se vuelve a pedir
  cabeceras?: Record<string, string>;
  registrar?: (m: string) => void;
}

export async function descargarPorRangos(
  url: string, destino: string, o: OpcionesRangos = {},
): Promise<{ bytes: number; trozos: number }> {
  const conexiones = Math.max(1, Math.floor(o.conexiones ?? 8));
  const trozoBytes = Math.max(1024, Math.floor(o.trozoBytes ?? 1024 * 1024));
  const intentos = Math.max(1, o.intentosPorTrozo ?? 6);
  const esperaBaseMs = o.esperaBaseMs ?? 5000;
  const timeoutMs = o.timeoutTrozoMs ?? 600000;
  const cabeceras = { 'User-Agent': 'OICP-sync', ...(o.cabeceras || {}) };
  const registrar = o.registrar || (() => {});
  const fsp = await import('fs/promises');
  const { createWriteStream } = await import('fs');
  const { pipeline: pipelineAsync } = await import('stream/promises');
  const dormir = (ms: number) => new Promise(r => setTimeout(r, Math.max(0, ms)));
  const descartar = async (res: Response) => { try { await res.body?.cancel(); } catch { /* ya cerrado */ } };

  // Política común de CADA petición, sondeo incluido: un 429 frena a TODAS las conexiones (misma
  // lección que limitador.ts) y un 403 es definitivo, porque la IP de la PC es la única que puede
  // leer al SERCOP y no se le insiste ni una vez.
  let frenoHasta = 0;
  let fallo: Error | null = null;
  const definitivo = (m: string) => Object.assign(new Error(m), { definitivo: true });
  const pedir = async (rango: string, que: string): Promise<Response> => {
    await dormir(frenoHasta - Date.now());
    const res = await fetch(url, { headers: { ...cabeceras, Range: rango }, signal: AbortSignal.timeout(timeoutMs) });
    if (res.status === 429) {
      const ra = Number(res.headers.get('retry-after'));
      const seg = Number.isFinite(ra) && ra >= 0 ? ra : 30;
      frenoHasta = Math.max(frenoHasta, Date.now() + seg * 1000);
      registrar(`  429 de la fuente: todas las conexiones esperan ${seg} s`);
      await descartar(res);
      throw new Error('HTTP 429');
    }
    if (res.status === 403) {
      await descartar(res);
      throw definitivo(`${que}: HTTP 403 (la fuente bloqueó la descarga; no se reintenta)`);
    }
    return res;
  };
  const conReintentos = async <T>(que: string, fn: () => Promise<T>): Promise<T> => {
    for (let intento = 1; ; intento++) {
      try { return await fn(); }
      catch (e: any) {
        if (e?.definitivo) { fallo = fallo || e; throw e; }
        if (fallo) throw fallo;
        if (intento >= intentos) throw new Error(`${que}: ${e.message}`);
        await dormir(esperaBaseMs * intento);
      }
    }
  };

  // 1. Sondeo: tamaño total y prueba de que el servidor respeta el rango. Va con la MISMA política de
  //    reintentos que los trozos: un 429 o un corte transitorio aquí no puede tumbar el volcado entero
  //    ni disfrazarse de «no acepta rangos». Lo definitivo es un 200: el servidor ignoró el Range.
  const total = await conReintentos('sondeo', async () => {
    const res = await pedir('bytes=0-0', 'sondeo');
    const cr = res.headers.get('content-range') || '';
    await descartar(res);
    if (res.status === 200) throw definitivo('el servidor no acepta rangos (contestó 200 al pedir bytes=0-0)');
    const n = Number(/\/(\d+)\s*$/.exec(cr)?.[1]);
    if (res.status !== 206 || !Number.isFinite(n) || n <= 0) throw new Error(`HTTP ${res.status}, Content-Range «${cr || 'ausente'}»`);
    return n;
  });

  // 2. Fichero del tamaño final; cada trozo escribe en su sitio.
  await fsp.writeFile(destino, '');
  await fsp.truncate(destino, total);

  // 3. Cola de trozos servida por N obreros.
  const trozos: Array<[number, number]> = [];
  for (let a = 0; a < total; a += trozoBytes) trozos.push([a, Math.min(a + trozoBytes, total) - 1]);
  let siguiente = 0, hechos = 0, bytesHechos = 0, ultimoAviso = 0;
  const t0 = Date.now();

  const bajarTrozo = (a: number, b: number) => conReintentos(`trozo ${a}-${b}`, async () => {
    const esperado = b - a + 1;
    const res = await pedir(`bytes=${a}-${b}`, `trozo ${a}-${b}`);
    if (res.status !== 206) { await descartar(res); throw new Error(`HTTP ${res.status} en vez de 206`); }
    const cr = res.headers.get('content-range') || '';
    if (!cr.startsWith(`bytes ${a}-${b}/`)) { await descartar(res); throw new Error(`Content-Range inesperado «${cr}»`); }
    if (!res.body) throw new Error('sin cuerpo');
    let n = 0;
    const contador = new Transform({ transform(c: Buffer, _enc, cb) { n += c.length; cb(null, c); } });
    await pipelineAsync(Readable.fromWeb(res.body as any), contador, createWriteStream(destino, { flags: 'r+', start: a }));
    if (n !== esperado) throw new Error(`trozo incompleto: ${n} de ${esperado} bytes`);
  });

  const obrero = async () => {
    while (!fallo) {
      const i = siguiente++;
      if (i >= trozos.length) return;
      const [a, b] = trozos[i];
      try { await bajarTrozo(a, b); }
      catch (e: any) { fallo = fallo || e; return; }
      hechos++; bytesHechos += b - a + 1;
      const ahora = Date.now();
      if (ahora - ultimoAviso >= 30000 || hechos === trozos.length) {
        ultimoAviso = ahora;
        const seg = Math.max(1, (ahora - t0) / 1000);
        registrar(`    ${(bytesHechos / 1048576).toFixed(1)} de ${(total / 1048576).toFixed(1)} MB (${Math.round(100 * bytesHechos / total)}%) · ${(bytesHechos / 1024 / seg).toFixed(0)} KB/s con ${conexiones} conexiones`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(conexiones, trozos.length) }, obrero));
  if (fallo) throw fallo;

  const tam = (await fsp.stat(destino)).size;
  if (tam !== total) throw new Error(`ensamblado incompleto: ${tam} de ${total} bytes`);
  return { bytes: total, trozos: trozos.length };
}

/**
 * Descarga el volcado A DISCO y devuelve la ruta.
 *
 * Leer directamente de la red hacia el parseador parece más elegante y en la práctica es frágil:
 * la primera corrida real murió con `TypeError: terminated` a mitad del volcado de 2019, o sea que
 * el servidor cortó la conexión después de haber transferido decenas de megas, y con el flujo
 * encadenado eso se pierde entero. Con el fichero en disco, un corte cuesta un reintento de la
 * descarga y nada más; además el fichero queda para reprocesar sin volver a pedirlo.
 *
 * Se descarta lo descargado a medias: un ZIP truncado inflaría basura silenciosamente.
 *
 * Con `conexiones` > 1 la descarga va por rangos en paralelo (ver `descargarPorRangos`); con 1,
 * por el camino de siempre de un solo flujo.
 */
export async function descargarVolcado(
  year: number, destino: string, month = 0, intentos = 4,
  registrar: (m: string) => void = () => {}, conexiones = 1,
): Promise<{ ruta: string; bytes: number }> {
  const { createWriteStream, statSync, unlinkSync, existsSync } = await import('fs');
  const { pipeline } = await import('stream/promises');
  for (let intento = 1; intento <= intentos; intento++) {
    try {
      const t0 = Date.now();
      let bytes: number;
      if (conexiones > 1) {
        // Por rangos (descargarPorRangos): comprueba por sí misma el 206, el Content-Range y la
        // cuenta de bytes de cada trozo, y el tamaño final del fichero.
        bytes = (await descargarPorRangos(urlVolcado(year, month), destino, { conexiones, registrar })).bytes;
      } else {
        const res = await fetch(urlVolcado(year, month),
          { headers: { 'User-Agent': 'OICP-sync' }, signal: AbortSignal.timeout(1800000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (!res.body) throw new Error('sin cuerpo');
        const declarado = Number(res.headers.get('content-length')) || 0;
        await pipeline(Readable.fromWeb(res.body as any), createWriteStream(destino));
        bytes = statSync(destino).size;
        // Un ZIP cortado sigue empezando por la firma correcta: sin esta comprobación, un volcado
        // a medias se procesaría como si estuviera completo y dejaría procesos sin reparar.
        if (declarado && bytes !== declarado) {
          throw new Error(`incompleto: ${bytes} de ${declarado} bytes`);
        }
      }
      if (bytes < 1024) throw new Error(`demasiado pequeño (${bytes} bytes)`);
      const seg = (Date.now() - t0) / 1000;
      registrar(`  ${year}: ${(bytes / 1048576).toFixed(1)} MB en ${seg.toFixed(1)}s = ${(bytes / 1048576 / seg).toFixed(2)} MB/s${conexiones > 1 ? ` (${conexiones} conexiones)` : ''}`);
      return { ruta: destino, bytes };
    } catch (e: any) {
      try { if (existsSync(destino)) unlinkSync(destino); } catch { /* mejor esfuerzo */ }
      // Un 403 es un bloqueo: reintentar el año entero sería insistirle a la fuente.
      if (/HTTP 403/.test(String(e.message))) throw new Error(`volcado ${year}: ${e.message}`);
      if (intento === intentos) throw new Error(`volcado ${year}: ${e.message}`);
      const espera = 15 * intento;
      registrar(`  ${year}: intento ${intento} falló (${e.message}); reintento en ${espera}s`);
      await new Promise(r => setTimeout(r, espera * 1000));
    }
  }
  throw new Error(`volcado ${year}: agotados los intentos`);
}
