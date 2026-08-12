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
  let acumulado = '';
  // `pos` es hasta dónde se ha escaneado YA. Sin él, al llegar un trozo nuevo se volvía a
  // recorrer el texto desde el principio y las llaves ya contadas se contaban otra vez, así que
  // la profundidad nunca volvía a cero y no salía ni un objeto. Era el defecto de fondo.
  let pos = 0;
  let profundidad = 0, inicio = -1, enCadena = false, escapado = false;

  for await (const trozo of flujo) {
    acumulado += trozo.toString('utf8');
    while (pos < acumulado.length) {
      const c = acumulado[pos];
      if (enCadena) {
        if (escapado) escapado = false;
        else if (c === '\\') escapado = true;
        else if (c === '"') enCadena = false;
        pos++; continue;
      }
      if (c === '"') { enCadena = true; pos++; continue; }
      if (c === '{') { if (profundidad === 0) inicio = pos; profundidad++; pos++; continue; }
      if (c === '}') {
        profundidad--;
        if (profundidad === 0 && inicio >= 0) {
          const crudo = acumulado.slice(inicio, pos + 1);
          try { yield JSON.parse(crudo); } catch { /* objeto ilegible: se salta, no tumba el barrido */ }
          // Se descarta lo ya consumido para que la memoria no crezca con el fichero.
          acumulado = acumulado.slice(pos + 1);
          pos = 0; inicio = -1;
          continue;
        }
        pos++; continue;
      }
      pos++;
    }
    // Entre objetos solo quedan separadores: soltarlos mantiene la memoria acotada al objeto
    // más grande, no al fichero (el volcado de 2024 son 1,54 GB en claro).
    if (profundidad === 0 && !enCadena) { acumulado = ''; pos = 0; }
  }
}

/** Todos los releases de un volcado, uno a uno. `origen` es una URL o un fichero local. */
export async function* releasesDelVolcado(origen: Readable): AsyncGenerator<any> {
  for await (const paquete of objetosDeArray(desempaquetar(origen))) {
    for (const rel of (paquete?.releases || [])) yield rel;
  }
}

/** Abre el volcado de un año como flujo. */
export async function abrirVolcado(year: number, month = 0): Promise<Readable> {
  const res = await fetch(urlVolcado(year, month),
    { headers: { 'User-Agent': 'OICP-sync' }, signal: AbortSignal.timeout(1800000) });
  if (!res.ok) throw new Error(`volcado ${year}/${month}: HTTP ${res.status}`);
  if (!res.body) throw new Error(`volcado ${year}/${month}: sin cuerpo`);
  return Readable.fromWeb(res.body as any);
}
