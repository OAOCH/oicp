/**
 * Sincronización local OICP → producción.
 *
 * SERCOP bloquea IPs de datacenter, así que el barrido corre en ESTA máquina
 * (IP ecuatoriana) y empuja los procesos nuevos a producción, donde el servidor
 * evalúa banderas, parcha agregados y re-evalúa con contexto de concentración.
 *
 * Uso (programado mar/jue 08:00 por el Programador de tareas de Windows):
 *   npx tsx server/local-sync.ts [--year 2026] [--budget-min 300] [--term agua]
 *
 * Modo RELLENADO (repara datos ya ingeridos volviéndolos a pedir a la fuente):
 *   npx tsx server/local-sync.ts --reparar [--criterio presupuesto|enquiry] [--budget-min 600]
 * Es reanudable: guarda cursor en .sync-repair-cursor.json y sigue donde se quedó.
 *
 * Config: archivo .sync-token (token de /api/admin/mint-sync-token) junto a
 * package.json, o variable de entorno OICP_SYNC_TOKEN.
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
// El mapeo OCDS -> fila vive en UN solo módulo (regla 11). Este archivo tenía su propia copia
// y por eso la corrección del presupuesto del 11-ago no llegó al único camino que de verdad
// llega al SERCOP: seguía guardando el texto "USD" y `enquiry_deadline` en nulo.
// `ocds-proc.ts` no toca base de datos ni red, así que se puede importar desde este script.
import { releaseFrom, releaseToProc } from './ocds-proc.js';
import { crearLimitador } from './limitador.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PROD = process.env.OICP_URL || 'https://oicp-production.up.railway.app';
const TOKEN = process.env.OICP_SYNC_TOKEN ||
  (existsSync(resolve(ROOT, '.sync-token')) ? readFileSync(resolve(ROOT, '.sync-token'), 'utf-8').trim() : '');
const CURSOR_FILE = resolve(ROOT, '.sync-cursor.json');

const SEARCH_API = 'https://datosabiertos.compraspublicas.gob.ec/PLATAFORMA/api/search_ocds';
const RECORD_API = 'https://datosabiertos.compraspublicas.gob.ec/PLATAFORMA/api/record';
const MAX_PAGES = 5000;
// Tope de páginas por término POR CORRIDA: los términos genéricos ("del", "para")
// superan las 1.000 páginas y una sola corrida se ahogaba en ellos sin llegar a
// finalizar. Los específicos cubren casi todo; el barrido genérico avanza por tandas.
const MAX_PAGES_PER_RUN = 300;
const PENDING_FILE = resolve(ROOT, '.sync-pending-finalize');

// Mantener en sincronía con server/updater.ts (TERMS y el parser del release).
const TERMS = [
  'adquisición', 'servicio', 'construcción', 'consultoría',
  'contratación', 'provisión', 'suministro', 'mantenimiento',
  'compra', 'obra', 'transporte', 'limpieza',
  'alimentación', 'medicamentos', 'equipos', 'mobiliario',
  'capacitación', 'seguridad', 'sistema', 'proyecto',
  'mejoramiento', 'rehabilitación', 'ampliación', 'reparación',
  'estudio', 'diseño', 'fiscalización', 'auditoría',
  'alquiler', 'arrendamiento', 'seguros', 'combustible',
  'uniformes', 'material', 'insumos', 'herramientas',
  'vehículos', 'tecnología', 'software', 'internet',
  'agua', 'eléctrico', 'electrónico', 'médico',
  'laboratorio', 'impresión', 'publicidad', 'comunicación',
  'municipal', 'provincial', 'ministerio', 'hospital',
  'universidad', 'escuela', 'instituto', 'empresa',
  'infraestructura', 'instalación', 'implementación',
  'evaluación', 'supervisión', 'control', 'gestión',
  // Genéricos AL FINAL: son la red de seguridad (miles de páginas cada uno);
  // primero deben completarse los términos específicos en cada corrida.
  'para', 'del', 'los', 'con', 'por', 'las',
];

function log(msg: string) { console.log(`[sync ${new Date().toISOString()}] ${msg}`); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── Limitador de emisión: como mucho UNA petición cada 350 ms, HAYA LOS HILOS QUE HAYA ──
// Antes esto era `if (Date.now() - lastReq < 350) esperar`, que funciona en serie y se rompe en
// paralelo: los N hilos leen el mismo `lastReq`, duermen lo mismo y despiertan a la vez, así que
// se emiten N peticiones de golpe cada 350 ms. Con 12 hilos son ~34 por segundo, y ~8 por segundo
// es exactamente lo que ya provocó 21 respuestas 429 seguidas en las pruebas.
//
// La forma correcta es RESERVAR el turno: cada llamada se apunta el siguiente hueco libre y lo
// adelanta antes de dormir. Como JavaScript no interrumpe entre dos líneas sin `await`, la
// reserva es atómica y la emisión queda garantizada por debajo de ~2,9 por segundo.
// Vive en `limitador.ts` con sus pruebas: la versión en línea que había aquí se rompía en
// paralelo y no había forma de probarla sin arrancar el barrido entero.
const limitador = crearLimitador(350);

async function sercopFetch(url: string, retries = 6): Promise<any | null> {
  for (let a = 1; a <= retries; a++) {
    await limitador.turno();
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'OICP-sync' }, signal: AbortSignal.timeout(45000) });
      if (res.status === 429) {
        const ra = Number(res.headers.get('retry-after')) || Math.min(60, 4 * 2 ** (a - 1));
        limitador.frenar(ra);   // el límite es del servidor: frena a TODOS los hilos
        await sleep(ra * 1000 + Math.random() * 1500);
        continue;
      }
      if (!res.ok) { if (a === retries) return null; await sleep(2000 * a); continue; }
      const text = await res.text();
      if (text.startsWith('<')) { if (a === retries) return null; await sleep(30000); continue; }
      return JSON.parse(text);
    } catch {
      if (a === retries) return null;
      await sleep(2000 * a);
    }
  }
  return null;
}

async function prod(path: string, body: any, retries = 4): Promise<any> {
  for (let a = 1; a <= retries; a++) {
    try {
      const res = await fetch(`${PROD}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-sync-token': TOKEN },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(600000),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 409) { log(`prod ocupado (${path}); espero 60s…`); await sleep(60000); continue; }
      if (!res.ok) throw new Error(`${path} HTTP ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
      return j;
    } catch (e: any) {
      if (a === retries) throw e;
      log(`  reintento ${a} ${path}: ${e.message}`);
      await sleep(10000 * a);
    }
  }
}

// ── RELLENADO DESDE LA FUENTE (`--reparar`) ──────────────────────────────────
// 174.547 procesos guardan el TEXTO "USD" donde debería ir el presupuesto, porque la ingesta
// leía `tender.value` (que el SERCOP publica vacío) en vez de `tender.lots[].value.amount`.
// La lectura ya está corregida, pero los procesos viejos hay que volver a pedirlos a la fuente.
//
// Corre por aquí y no desde Railway porque el SERCOP bloquea las IP de datacenter.
// Es REANUDABLE: guarda cursor por criterio en `.sync-repair-cursor.json`, así que se puede
// cortar (apagón, batería, tope de tiempo) y sigue exactamente donde se quedó.
const REPAIR_CURSOR = resolve(ROOT, '.sync-repair-cursor.json');
const CRITERIOS = ['presupuesto', 'enquiry'] as const;
type Criterio = typeof CRITERIOS[number];

type EstadoReparacion = {
  criterio: Criterio; desde: string; pase: number;
  pedidos: number; reparados: number; sinCambio: number; errores: number;
  actualizado: string;
};

function leerEstado(): EstadoReparacion {
  try {
    const e = JSON.parse(readFileSync(REPAIR_CURSOR, 'utf-8'));
    if (e && CRITERIOS.includes(e.criterio)) return e;
  } catch { /* sin estado previo: empieza de cero */ }
  return { criterio: 'presupuesto', desde: '', pase: 1, pedidos: 0, reparados: 0, sinCambio: 0, errores: 0, actualizado: '' };
}
function guardarEstado(e: EstadoReparacion) {
  e.actualizado = new Date().toISOString();
  writeFileSync(REPAIR_CURSOR, JSON.stringify(e, null, 2));
}

async function reparar(budgetMin: number, soloCriterio?: string, concurrencia = 12) {
  const t0 = Date.now();
  const budgetMs = budgetMin * 60_000;
  let ritmo = 0;
  const estado = leerEstado();
  if (soloCriterio) {
    if (!CRITERIOS.includes(soloCriterio as Criterio)) {
      console.error(`--criterio tiene que ser uno de: ${CRITERIOS.join(', ')}`); process.exit(1);
    }
    if (estado.criterio !== soloCriterio) Object.assign(estado, { criterio: soloCriterio as Criterio, desde: '', pase: 1 });
  }

  log(`RELLENADO: criterio "${estado.criterio}", cursor "${estado.desde || '(inicio)'}", pase ${estado.pase}, presupuesto ${budgetMin} min`);
  const avance = await prod('/api/admin/avance-reparacion', {}, 2).catch(() => null);
  if (avance) log(`  estado inicial en producción: ${JSON.stringify(avance)}`);

  let buffer: any[] = [];
  let sinTiempo = false;

  const empujar = async () => {
    if (!buffer.length) return;
    const r = await prod('/api/admin/reparar', { procs: buffer });
    estado.reparados += r.reparados || 0;
    estado.sinCambio += r.sin_cambio || 0;
    if (r.ausentes) log(`  aviso: ${r.ausentes} ocid del lote ya no están en la base`);
    buffer = [];
  };

  for (;;) {
    if (Date.now() - t0 > budgetMs) { sinTiempo = true; break; }

    const { ids } = await prod('/api/admin/ocids-a-reparar',
      { criterio: estado.criterio, limite: 500, desde: estado.desde });

    if (!ids.length) {
      // Fin de una pasada. Si hubo fallos de red, los que no se pudieron traer siguen
      // cumpliendo el criterio, así que una segunda pasada los recoge. Dos pasadas extra
      // como máximo: más allá de eso el problema no es transitorio y hay que mirarlo.
      if (estado.errores > 0 && estado.pase < 3) {
        log(`  fin de la pasada ${estado.pase} con ${estado.errores} fallos de red; repito desde el inicio`);
        Object.assign(estado, { desde: '', pase: estado.pase + 1, errores: 0 });
        guardarEstado(estado);
        continue;
      }
      const i = CRITERIOS.indexOf(estado.criterio);
      if (soloCriterio || i === CRITERIOS.length - 1) { log(`  criterio "${estado.criterio}" COMPLETO`); break; }
      log(`  criterio "${estado.criterio}" COMPLETO; sigo con "${CRITERIOS[i + 1]}"`);
      Object.assign(estado, { criterio: CRITERIOS[i + 1], desde: '', pase: 1, errores: 0 });
      guardarEstado(estado);
      continue;
    }

    // El cursor NO puede saltar al final de la página si la página no se terminó de procesar.
    // Si se acaba el tiempo a mitad y aun así se avanza, esos procesos no se vuelven a pedir
    // nunca y el rellenado se da por completo faltando datos: un HUECO SILENCIOSO, que es
    // exactamente el defecto que ya dejó huecos en el barrido por términos. Por eso el cursor
    // sigue al último ocid REALMENTE consumido; los ids vienen ordenados, así que avanza de
    // forma monótona y nunca retrocede.
    // ── Por qué esto va en paralelo ─────────────────────────────────────────────
    // Medido contra la fuente: `record?ocid=` tarda de 7 a 18 s por petición (p50 12 s), y esa
    // lentitud NO es límite de tasa (con 12 minutos de reposo previo sigue igual, y no devuelve
    // ni un 429). Es latencia por petición. En serie eso da 0,08 req/s, o sea ~25 días para los
    // 174 547. Con 3 en vuelo sube a 0,25 req/s, también con CERO 429: el paralelismo multiplica.
    //
    // El guardián sigue siendo `sercopFetch`, que impone 350 ms entre INICIOS de petición: por
    // muchos hilos que haya, nunca se emiten más de ~2,9 por segundo. Lo que provocó los 429 en
    // las pruebas fue emitir a ~8 por segundo, muy por encima de ese techo. Así que la
    // concurrencia sube el rendimiento sin acercarse al límite que ya conocemos.
    let ultimoProcesado = '';
    let corte = false;
    const cola = [...ids];
    const traer = async () => {
      for (;;) {
        if (corte || Date.now() - t0 > budgetMs) { corte = true; sinTiempo = true; return; }
        const ocid = cola.shift();
        if (!ocid) return;
        const recData = await sercopFetch(`${RECORD_API}?ocid=${encodeURIComponent(ocid)}`);
        const release = recData ? releaseFrom(recData) : null;
        estado.pedidos++;
        // Los ids vienen ordenados y la cola se consume en orden, pero con varios hilos pueden
        // terminar desordenados: el cursor se queda en el MAYOR ya consumido, nunca retrocede.
        if (ocid > ultimoProcesado) ultimoProcesado = ocid;
        // Un fallo de red deja la fila cumpliendo el criterio: la recoge la segunda pasada.
        if (!release) { estado.errores++; continue; }
        try {
          // MISMO mapeo que la ingesta (regla 11): así el presupuesto se lee de los lotes y la
          // fecha de preguntas se toma de enquiryPeriod, sin una segunda interpretación.
          // El año solo alimenta `source_year` y `regime`, y ninguno de los dos se envía en la
          // reparación (que escribe exclusivamente presupuesto y fecha de preguntas).
          const proc = releaseToProc(release, null, new Date().getFullYear());
          buffer.push({ id: ocid, budget_amount: proc.budget_amount, enquiry_deadline: proc.enquiry_deadline });
        } catch (e: any) { estado.errores++; log(`  mapeo ${ocid}: ${e.message}`); }
      }
    };
    const tPagina = Date.now();
    const antes = estado.pedidos;
    await Promise.all(Array.from({ length: concurrencia }, traer));
    const seg = (Date.now() - tPagina) / 1000;
    const hechos = estado.pedidos - antes;
    if (seg > 0 && hechos > 0) ritmo = hechos / seg;

    // Empujar ANTES de mover el cursor: si el proceso muere entre medias, la próxima corrida
    // repite ese tramo, que es idempotente, en vez de saltárselo.
    await empujar();
    if (!ultimoProcesado) break;     // no cupo ni uno en el tiempo que quedaba
    estado.desde = ultimoProcesado;
    guardarEstado(estado);
    const mins = ((Date.now() - t0) / 60000).toFixed(1);
    log(`  [${estado.criterio}] pedidos ${estado.pedidos} · reparados ${estado.reparados} · sin cambio ${estado.sinCambio} · fallos ${estado.errores} · ${mins} min · ${ritmo.toFixed(2)} proc/s`);
  }

  await empujar();
  guardarEstado(estado);
  log(`RELLENADO ${sinTiempo ? 'PARCIAL (se acabó el tiempo; el cursor quedó guardado)' : 'TERMINADO'}: ` +
      `pedidos ${estado.pedidos}, reparados ${estado.reparados}, sin cambio ${estado.sinCambio}, fallos ${estado.errores}`);

  if (estado.reparados > 0) {
    // Re-evaluación de banderas. Tarda entre 5 y 11 minutos y el proxy de Railway corta a los
    // 300 s con un `upstream error` AUNQUE EL TRABAJO SIGA BIEN: por eso no se concluye por la
    // respuesta HTTP, sino comprobando después el avance por los datos.
    log('re-evaluando banderas en producción (esto tarda de 5 a 11 min; un corte del proxy NO significa que falló)…');
    try {
      const fin = await prod('/api/admin/reparar-finalize', {}, 1);
      log(`re-evaluación: ${JSON.stringify(fin)}`);
    } catch (e: any) {
      log(`la respuesta HTTP se cortó (${e.message}). Es lo esperado si pasó de 300 s; el servidor sigue trabajando.`);
    }
  }
  const fin = await prod('/api/admin/avance-reparacion', {}, 2).catch(() => null);
  if (fin) log(`estado final en producción: ${JSON.stringify(fin)}`);
  log('OK');
  process.exit(0);
}

function readCursor(year: number): { termIdx: number; page: number } {
  try {
    const c = JSON.parse(readFileSync(CURSOR_FILE, 'utf-8'));
    if (c.year === year && c.termIdx < TERMS.length) return { termIdx: c.termIdx, page: c.page || 1 };
  } catch { /* sin cursor */ }
  return { termIdx: 0, page: 1 };
}
function saveCursor(year: number, termIdx: number, page: number) {
  writeFileSync(CURSOR_FILE, JSON.stringify({ year, termIdx, page, savedAt: new Date().toISOString() }));
}
function clearCursor() { try { writeFileSync(CURSOR_FILE, 'null'); } catch { /* sin permisos: ignorar */ } }

async function main() {
  const args = process.argv.slice(2);
  const argOf = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const year = Number(argOf('--year')) || new Date().getFullYear();
  const budgetMin = Number(argOf('--budget-min')) || 240;
  const oneTerm = argOf('--term');
  const terms = oneTerm ? [oneTerm] : TERMS;

  if (!TOKEN) { console.error('Falta el token: crea el archivo .sync-token o exporta OICP_SYNC_TOKEN'); process.exit(1); }

  // Modo rellenado: no barre novedades, repara lo ya ingerido pidiéndolo otra vez a la fuente.
  // Es un trabajo de fondo de varias horas, así que trae su propio presupuesto de tiempo.
  if (args.includes('--reparar')) {
    // La concurrencia sube el rendimiento sin tocar el techo de emisión de sercopFetch
    // (350 ms entre inicios). Ajustable por si la fuente cambia de comportamiento.
    const conc = Math.min(Math.max(Number(argOf('--conc')) || 12, 1), 32);
    await reparar(Number(argOf('--budget-min')) || 600, argOf('--criterio'), conc);
    return;
  }

  // Recuperación: si una corrida anterior murió (apagado/batería) después de
  // ingerir pero antes de finalizar, la finalización quedó pendiente en el
  // servidor (corte de datos y banderas de concentración desactualizados).
  if (existsSync(PENDING_FILE)) {
    const pendYear = Number(readFileSync(PENDING_FILE, 'utf-8').trim()) || year;
    log(`finalización pendiente de una corrida interrumpida (año ${pendYear}); ejecutando primero…`);
    try {
      const fin = await prod('/api/admin/ingest-finalize', { year: pendYear });
      log(`finalización recuperada: ${JSON.stringify(fin)}`);
      try { unlinkSync(PENDING_FILE); } catch { /* mejor esfuerzo */ }
    } catch (e: any) {
      log(`no se pudo recuperar la finalización (seguirá pendiente): ${e.message}`);
    }
  }
  // Marca que esta corrida deberá finalizar (se borra al finalizar con éxito).
  writeFileSync(PENDING_FILE, String(year));

  const t0 = Date.now();
  const budgetMs = budgetMin * 60_000;
  let inserted = 0, skipped = 0, searched = 0, errors = 0;
  let buffer: any[] = [];
  let outOfBudget = false;

  const flush = async () => {
    if (!buffer.length) return;
    const r = await prod('/api/admin/ingest', { procs: buffer });
    inserted += r.inserted || 0;
    skipped += r.skipped || 0;
    buffer = [];
  };

  const start = oneTerm ? { termIdx: 0, page: 1 } : readCursor(year);
  log(`inicio: año ${year}, presupuesto ${budgetMin} min, reanudando en término ${start.termIdx + 1}/${terms.length} pág ${start.page}`);

  for (let t = start.termIdx; t < terms.length; t++) {
    if (outOfBudget) break;
    const term = terms[t];
    let page = (t === start.termIdx ? start.page : 1), totalPages = 1;
    const pageCap = page + MAX_PAGES_PER_RUN - 1;
    while (page <= totalPages && page <= MAX_PAGES && page <= pageCap && !outOfBudget) {
      if (Date.now() - t0 > budgetMs) { outOfBudget = true; if (!oneTerm) saveCursor(year, t, page); break; }
      const sd = await sercopFetch(`${SEARCH_API}?year=${year}&search=${encodeURIComponent(term)}&page=${page}`);
      searched++;
      if (!sd) { log(`  búsqueda "${term}" pág ${page}: sin respuesta`); errors++; break; }
      if (!sd.data?.length) break;
      totalPages = sd.pages || 1;
      const ocids = sd.data.map((r: any) => r.ocid).filter(Boolean);
      const srByOcid = new Map(sd.data.map((r: any) => [r.ocid, r]));
      const { missing } = await prod('/api/admin/missing-ocids', { ocids });
      for (const ocid of missing) {
        if (Date.now() - t0 > budgetMs) { outOfBudget = true; if (!oneTerm) saveCursor(year, t, page); break; }
        const recData = await sercopFetch(`${RECORD_API}?ocid=${encodeURIComponent(ocid)}`);
        const release = recData ? releaseFrom(recData) : null;
        if (!release) { errors++; continue; }
        try {
          buffer.push(releaseToProc(release, srByOcid.get(ocid), year));
          if (buffer.length >= 100) await flush();
        } catch (e: any) { errors++; log(`  parse ${ocid}: ${e.message}`); }
      }
      if (page % 25 === 0 || missing.length) {
        log(`  [${t + 1}/${terms.length}] "${term}" pág ${page}/${Math.min(totalPages, MAX_PAGES)} — nuevos ${inserted} · vistos ${skipped}`);
      }
      page++;
    }
    if (page > pageCap && page <= totalPages) {
      log(`  término "${term}": tope de ${MAX_PAGES_PER_RUN} págs/corrida alcanzado (${page - 1}/${totalPages}); continúa en tandas`);
    }
  }
  await flush();
  if (!outOfBudget && !oneTerm) clearCursor();

  log(`barrido ${outOfBudget ? 'PARCIAL (presupuesto agotado, cursor guardado)' : 'COMPLETO'}: nuevos ${inserted}, vistos ${skipped}, búsquedas ${searched}, errores ${errors}`);
  if (inserted > 0 || outOfBudget === false) {
    log('finalizando en producción (concentración + banderas + agregados)…');
    const fin = await prod('/api/admin/ingest-finalize', { year });
    log(`finalizado: ${JSON.stringify(fin)}`);
    try { unlinkSync(PENDING_FILE); } catch { /* mejor esfuerzo */ }
  }
  log('OK');
  process.exit(0);
}

main().catch(e => { console.error(`[sync] ERROR: ${e.stack || e.message}`); process.exit(1); });
