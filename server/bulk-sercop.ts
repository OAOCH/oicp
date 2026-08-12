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
import { Readable } from 'stream';

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
  const salida = new Readable({ read() { /* empujado desde abajo */ } });
  const inflate = zlib.createInflateRaw();
  inflate.on('data', (c: Buffer) => salida.push(c));
  inflate.on('end', () => salida.push(null));
  inflate.on('error', (e) => salida.destroy(e));

  let cabecera: Buffer = Buffer.alloc(0);
  let listo = false;
  entrada.on('data', (trozo: Buffer) => {
    if (listo) { inflate.write(trozo); return; }
    cabecera = Buffer.concat([cabecera, trozo]);
    // La firma se comprueba en cuanto hay 4 bytes. Si se esperara a tener los 30 de la cabecera,
    // una respuesta corta que no es un ZIP (una página de error, por ejemplo) nunca llegaría a
    // validarse y el fallo saldría como un críptico "unexpected end of file" del inflador.
    if (cabecera.length >= 4 && cabecera.readUInt32LE(0) !== 0x04034b50) {
      salida.destroy(new Error('el volcado no empieza por la firma de un ZIP'));
      entrada.destroy(); return;
    }
    if (cabecera.length < 30) return;
    const metodo = cabecera.readUInt16LE(8);
    const nlen = cabecera.readUInt16LE(26), elen = cabecera.readUInt16LE(28);
    const inicio = 30 + nlen + elen;
    if (cabecera.length < inicio) return;
    if (metodo !== 8) {
      salida.destroy(new Error(`método de compresión ${metodo} no contemplado (se espera 8, deflate)`));
      entrada.destroy(); return;
    }
    listo = true;
    inflate.write(cabecera.subarray(inicio));
    cabecera = Buffer.alloc(0);
  });
  entrada.on('end', () => inflate.end());
  entrada.on('error', (e) => salida.destroy(e));
  return salida;
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
  const BLOQUE = /^\{/;
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
  let resto = '';           // último trozo de línea, aún incompleto
  let pendiente: string[] = [];   // líneas del paquete que se está armando

  const emitir = function* (): Generator<any> {
    if (!pendiente.length) return;
    const crudoBruto = pendiente.join('\n');
    pendiente = [];
    // Se recorta al objeto: desde la primera `{` hasta la ÚLTIMA `}`. Así se quitan de un golpe
    // el `[` de apertura, la coma separadora y el `]` de cierre, que se pegaba al último paquete
    // del fichero y hacía que se perdiera justo ese (49 de 50 en la prueba).
    const ini = crudoBruto.indexOf('{');
    const fin = crudoBruto.lastIndexOf('}');
    if (ini < 0 || fin < ini) return;
    const crudo = crudoBruto.slice(ini, fin + 1);
    try { yield JSON.parse(crudo); } catch { /* paquete ilegible: se pierde SOLO este */ }
  };

  for await (const trozo of flujo) {
    resto += decodificador.write(Buffer.isBuffer(trozo) ? trozo : Buffer.from(trozo));
    const lineas = resto.split('\n');
    resto = lineas.pop() ?? '';       // la última puede estar cortada
    for (const linea of lineas) {
      if (BLOQUE.test(linea) && pendiente.length) yield* emitir();
      // El `[` de apertura del array no pertenece a ningún paquete.
      if (linea.trim() === '[') continue;
      pendiente.push(linea);
      if (pendiente.reduce((n, l) => n + l.length, 0) > TOPE_OBJETO) {
        throw new Error(`paquete JSON de más de ${TOPE_OBJETO} bytes: el volcado no tiene la forma esperada`);
      }
    }
  }
  resto += decodificador.end();
  if (resto) {
    if (BLOQUE.test(resto) && pendiente.length) yield* emitir();
    pendiente.push(resto);
  }
  yield* emitir();
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
 * Descarga el volcado A DISCO y devuelve la ruta.
 *
 * Leer directamente de la red hacia el parseador parece más elegante y en la práctica es frágil:
 * la primera corrida real murió con `TypeError: terminated` a mitad del volcado de 2019, o sea que
 * el servidor cortó la conexión después de haber transferido decenas de megas, y con el flujo
 * encadenado eso se pierde entero. Con el fichero en disco, un corte cuesta un reintento de la
 * descarga y nada más; además el fichero queda para reprocesar sin volver a pedirlo.
 *
 * Se descarta lo descargado a medias: un ZIP truncado inflaría basura silenciosamente.
 */
export async function descargarVolcado(
  year: number, destino: string, month = 0, intentos = 4,
  registrar: (m: string) => void = () => {},
): Promise<{ ruta: string; bytes: number }> {
  const { createWriteStream, statSync, unlinkSync, existsSync } = await import('fs');
  const { pipeline } = await import('stream/promises');
  for (let intento = 1; intento <= intentos; intento++) {
    try {
      const t0 = Date.now();
      const res = await fetch(urlVolcado(year, month),
        { headers: { 'User-Agent': 'OICP-sync' }, signal: AbortSignal.timeout(1800000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!res.body) throw new Error('sin cuerpo');
      const declarado = Number(res.headers.get('content-length')) || 0;
      await pipeline(Readable.fromWeb(res.body as any), createWriteStream(destino));
      const bytes = statSync(destino).size;
      // Un ZIP cortado sigue empezando por la firma correcta: sin esta comprobación, un volcado
      // a medias se procesaría como si estuviera completo y dejaría procesos sin reparar.
      if (declarado && bytes !== declarado) {
        throw new Error(`incompleto: ${bytes} de ${declarado} bytes`);
      }
      if (bytes < 1024) throw new Error(`demasiado pequeño (${bytes} bytes)`);
      const seg = (Date.now() - t0) / 1000;
      registrar(`  ${year}: ${(bytes / 1048576).toFixed(1)} MB en ${seg.toFixed(1)}s = ${(bytes / 1048576 / seg).toFixed(2)} MB/s`);
      return { ruta: destino, bytes };
    } catch (e: any) {
      try { if (existsSync(destino)) unlinkSync(destino); } catch { /* mejor esfuerzo */ }
      if (intento === intentos) throw new Error(`volcado ${year}: ${e.message}`);
      const espera = 15 * intento;
      registrar(`  ${year}: intento ${intento} falló (${e.message}); reintento en ${espera}s`);
      await new Promise(r => setTimeout(r, espera * 1000));
    }
  }
  throw new Error(`volcado ${year}: agotados los intentos`);
}
