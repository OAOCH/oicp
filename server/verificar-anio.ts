/**
 * BOLETA DE VERIFICACIÓN POR AÑO.
 *
 * Por qué existe: la plataforma se construyó bajando todo el corpus y aplicando la metodología
 * encima, y no había forma de decir «2022 está perfecto» con evidencia. Hoy quedó demostrado en
 * vivo por qué hace falta mirar año por año: el lector de volcados funcionó exacto con 2019
 * (275.055 = 275.055) y se rompió con 2020 por una comilla sin escapar, y otra vez distinto con
 * un año que venía en una sola línea. Esa comparación por año existía solo para la DESCARGA.
 * Para la METODOLOGÍA no existía, que es donde de verdad se juega la credibilidad.
 *
 * No hay muestreo. Se re-evalúan TODOS los procesos del año con el motor real y se comparan uno
 * por uno contra lo guardado. Es barato: es la misma maquinaria del recálculo (`reflagChanged`),
 * que recorre 1,47 M de procesos en menos de un minuto, pero sin escribir nada.
 *
 * Cada control devuelve APROBADO o FALLA con su detalle. Un control que no se puede evaluar
 * devuelve FALLA, no APROBADO: sin veredicto no hay verificación.
 */
import type Database from 'better-sqlite3';
import { getDb, MONTO_SQL, SQL_ES_INFIMA_POR_MONTO } from './db.js';
import { evaluateAllFlags, getRegime, getRiskLevel, isInfimaByAmount, getInfimaThreshold } from './flag-engine.js';
import { buildConcentrationContext } from './updater.js';
import { limpiarNombre } from './ocds-proc.js';

export type Control = { ok: boolean; detalle: string; ejemplos?: string[] };
export type Boleta = {
  anio: number;
  procesos: number;
  veredicto: 'APROBADO' | 'FALLA';
  controles: Record<string, Control>;
  segundos: number;
};

const ok = (detalle: string): Control => ({ ok: true, detalle });
const falla = (detalle: string, ejemplos?: string[]): Control => ({ ok: false, detalle, ejemplos });

/** Mismo cálculo del monto que MONTO_SQL y que el MCP (regla 11); se compara contra el SQL. */
function montoPlausibleJs(fa: any, ca: any, aa: any): number {
  const num = (x: any) => { const n = typeof x === 'number' ? x : parseFloat(x); return Number.isFinite(n) ? n : 0; };
  const f = num(fa), c = num(ca), a = num(aa);
  const m = f || c || a;
  if (a > 0 && m > a * 100) return a;
  if (m > 1e10) return a > 0 ? a : 0;
  return m;
}

export async function verificarAnio(year: number, dbIn?: Database.Database): Promise<Boleta> {
  const t0 = Date.now();
  const db = dbIn || getDb();
  const ctx = buildConcentrationContext(db);

  const LOTE = 5000;
  const leer = db.prepare(`
    SELECT id, ocid, procurement_method, procurement_method_details, buyer_id, buyer_name,
           budget_amount, typeof(budget_amount) AS tipo_budget, award_amount, contract_amount, final_amount,
           published_date, submission_deadline, answer_deadline, award_date, number_of_tenderers,
           title, description, items_classification, has_amendments, amendment_count,
           suppliers, source_year, regime, flags, score, risk_level,
           ${MONTO_SQL} AS monto_sql,
           ${SQL_ES_INFIMA_POR_MONTO} AS infima_sql
    FROM procedures p WHERE source_year = ? AND id > ? ORDER BY id LIMIT ?`);

  let cursor = '', procesos = 0;
  let discrepancias = 0; const ejDiscrepancia: string[] = [];
  let budgetTexto = 0; const ejBudget: string[] = [];
  let regimenMal = 0; const ejRegimen: string[] = [];
  let montoMal = 0; const ejMonto: string[] = [];
  let infimaMal = 0; const ejInfima: string[] = [];
  let sinFecha = 0, fechaFuera = 0; const ejFecha: string[] = [];
  let riesgoInconsistente = 0; const ejRiesgo: string[] = [];
  let nombreMal = 0; const ejNombre: string[] = [];
  let flagsIlegibles = 0;
  const conteoBanderas = new Map<string, number>();
  const conteoRiesgo = new Map<string, number>();

  for (;;) {
    const filas = leer.all(year, cursor, LOTE) as any[];
    if (!filas.length) break;
    cursor = filas[filas.length - 1].id;

    for (const row of filas) {
      procesos++;

      // 1. El presupuesto nunca puede ser texto: una cadena es truthy en JavaScript y hace que
      //    TR-01 deje de marcar el valor como faltante.
      if (row.tipo_budget === 'text') { budgetTexto++; if (ejBudget.length < 5) ejBudget.push(row.id); }

      // 2. El régimen es una FUNCIÓN de la fecha; no puede haber otro valor.
      const regimenEsperado = getRegime(row.published_date || `${row.source_year || year}-06-15`);
      if (row.regime !== regimenEsperado) {
        regimenMal++;
        if (ejRegimen.length < 5) ejRegimen.push(`${row.id}: dice ${row.regime}, toca ${regimenEsperado}`);
      }

      // 3. MONTO_SQL (lo que ve la web y el MCP) contra el mismo cálculo en JavaScript.
      const montoJs = montoPlausibleJs(row.final_amount, row.contract_amount, row.award_amount);
      if (Math.abs(Number(row.monto_sql || 0) - montoJs) > 0.01) {
        montoMal++;
        if (ejMonto.length < 5) ejMonto.push(`${row.id}: SQL ${row.monto_sql} vs JS ${montoJs}`);
      }

      // 4. La ínfima por monto en SQL contra la del motor. Si divergen, el índice de
      //    concentración cuenta una cosa y las banderas marcan otra.
      const fechaInfima = row.published_date || row.award_date || null;
      const infimaJs = isInfimaByAmount({ ...row, award_amount: Number(row.award_amount) || 0 }) ? 1 : 0;
      if (Number(row.infima_sql || 0) !== infimaJs) {
        infimaMal++;
        if (ejInfima.length < 5) {
          ejInfima.push(`${row.id}: SQL ${row.infima_sql} vs motor ${infimaJs} ` +
            `(adjudicado ${row.award_amount}, umbral ${getInfimaThreshold(fechaInfima)})`);
        }
      }

      // 5. Fechas: la ficha las publica, así que tienen que existir y caer donde deben.
      if (!row.published_date) { sinFecha++; if (ejFecha.length < 5) ejFecha.push(`${row.id}: sin fecha`); }
      else if (String(row.published_date).slice(0, 4) !== String(year)) {
        fechaFuera++;
        if (ejFecha.length < 5) ejFecha.push(`${row.id}: source_year ${year} pero publicado ${String(row.published_date).slice(0, 10)}`);
      }

      // 6. Nombres de proveedor utilizables. La fuente publica la cadena "null" como nombre, y así
      //    llegaba a la ficha y a los rankings. Se mira el nombre GUARDADO, no el que se muestra:
      //    `nombreVisible()` por diseño nunca devuelve basura, así que comprobar su salida no
      //    detectaría nada. Lo que delata el problema es que haya un nombre guardado no vacío que
      //    la limpieza reduce a nada, es decir, basura que la ingesta no normalizó.
      try {
        for (const s of JSON.parse(row.suppliers || '[]')) {
          const guardado = String(s?.name ?? '').trim();
          if (guardado !== '' && limpiarNombre(guardado) === '') {
            nombreMal++; if (ejNombre.length < 5) ejNombre.push(`${row.id}: nombre guardado "${guardado}"`);
          }
        }
      } catch { /* proveedores ilegibles: lo cubre el control del motor */ }

      // 7. EL CONTROL CARO: re-ejecutar el motor real y comparar bandera por bandera.
      //    `Number(...) || 0` igual que updater.ts: sin eso, un presupuesto de texto sería
      //    truthy y produciría discrepancias FALSAS en TR-01.
      let suppliersArr: any[] = [];
      try { suppliersArr = JSON.parse(row.suppliers || '[]'); } catch { flagsIlegibles++; }
      const proc = { ...row, budget_amount: Number(row.budget_amount) || 0,
        suppliers: suppliersArr, has_amendments: !!row.has_amendments };
      const { flags, score, riskLevel } = evaluateAllFlags(proc, ctx);
      const flagsJson = JSON.stringify(flags);
      if (flagsJson !== row.flags || score !== row.score || riskLevel !== row.risk_level) {
        discrepancias++;
        if (ejDiscrepancia.length < 10) {
          const activasGuardadas = (() => { try { return JSON.parse(row.flags || '[]').filter((f: any) => f.active).map((f: any) => f.code).join(',');} catch { return '(ilegible)'; } })();
          const activasMotor = flags.filter(f => f.active).map(f => f.code).join(',');
          ejDiscrepancia.push(`${row.id}: guardado [${activasGuardadas}] score ${row.score}/${row.risk_level} · ` +
            `motor [${activasMotor}] score ${score}/${riskLevel}`);
        }
      }

      // 8. El nivel de riesgo tiene que corresponder al score.
      if (getRiskLevel(row.score || 0) !== row.risk_level) {
        riesgoInconsistente++;
        if (ejRiesgo.length < 5) ejRiesgo.push(`${row.id}: score ${row.score} pero nivel ${row.risk_level}`);
      }

      // Conteos para cuadrar contra los agregados.
      conteoRiesgo.set(row.risk_level || 'low', (conteoRiesgo.get(row.risk_level || 'low') || 0) + 1);
      try {
        for (const f of JSON.parse(row.flags || '[]')) {
          if (f?.active) conteoBanderas.set(f.code, (conteoBanderas.get(f.code) || 0) + 1);
        }
      } catch { /* ya contado en flagsIlegibles */ }
    }
    await new Promise(r => setImmediate(r));   // cede el hilo: no bloquear las peticiones del usuario
  }

  // 9 y 10. Los agregados a_* tienen que decir lo mismo que `procedures`. Si divergen, la web y
  //         el MCP publican una cifra y la base tiene otra.
  const aFlag = new Map<string, number>();
  for (const r of db.prepare(`SELECT code, n FROM a_flag_year WHERE year = ?`).all(year) as any[]) aFlag.set(r.code, r.n);
  const aRisk = new Map<string, number>();
  for (const r of db.prepare(`SELECT risk, n FROM a_risk_year WHERE year = ?`).all(year) as any[]) aRisk.set(r.risk, r.n);

  const difBanderas: string[] = [];
  for (const [code, n] of conteoBanderas) if ((aFlag.get(code) || 0) !== n) difBanderas.push(`${code}: a_flag_year ${aFlag.get(code) || 0} vs real ${n}`);
  for (const [code, n] of aFlag) if (n !== 0 && !conteoBanderas.has(code)) difBanderas.push(`${code}: a_flag_year ${n} vs real 0`);

  const difRiesgo: string[] = [];
  for (const [nivel, n] of conteoRiesgo) if ((aRisk.get(nivel) || 0) !== n) difRiesgo.push(`${nivel}: a_risk_year ${aRisk.get(nivel) || 0} vs real ${n}`);
  const sumaRiesgo = [...conteoRiesgo.values()].reduce((a, b) => a + b, 0);

  const controles: Record<string, Control> = {
    motor: discrepancias === 0
      ? ok(`${procesos} procesos re-evaluados con el motor real, 0 discrepancias`)
      : falla(`${discrepancias} de ${procesos} procesos no coinciden con el motor`, ejDiscrepancia),
    presupuesto: budgetTexto === 0
      ? ok('ningún presupuesto guardado como texto')
      : falla(`${budgetTexto} presupuestos guardados como TEXTO`, ejBudget),
    regimen: regimenMal === 0
      ? ok('el régimen corresponde a la fecha en todos')
      : falla(`${regimenMal} procesos con un régimen que no corresponde a su fecha`, ejRegimen),
    monto_unico: montoMal === 0
      ? ok('MONTO_SQL y el cálculo en JavaScript coinciden al centavo')
      : falla(`${montoMal} procesos donde la web y el motor calculan distinto el monto`, ejMonto),
    infima_unica: infimaMal === 0
      ? ok('la ínfima por monto en SQL y en el motor clasifican igual')
      : falla(`${infimaMal} procesos clasificados distinto como ínfima`, ejInfima),
    fechas: (sinFecha === 0 && fechaFuera === 0)
      ? ok('todos con fecha de publicación y dentro de su año')
      : falla(`${sinFecha} sin fecha de publicación, ${fechaFuera} publicados fuera de su source_year`, ejFecha),
    proveedores: nombreMal === 0
      ? ok('ningún proveedor se publica con un nombre inservible')
      : falla(`${nombreMal} proveedores con nombre inservible`, ejNombre),
    riesgo_vs_score: riesgoInconsistente === 0
      ? ok('el nivel de riesgo corresponde al score en todos')
      : falla(`${riesgoInconsistente} procesos con un nivel que no corresponde a su score`, ejRiesgo),
    agregado_banderas: difBanderas.length === 0
      ? ok(`a_flag_year cuadra con los ${procesos} procesos`)
      : falla(`${difBanderas.length} indicadores donde el agregado y la base no cuadran`, difBanderas),
    agregado_riesgo: (difRiesgo.length === 0 && sumaRiesgo === procesos)
      ? ok(`a_risk_year cuadra y los niveles suman ${procesos} exacto`)
      : falla(`el agregado de riesgo no cuadra (suma ${sumaRiesgo} de ${procesos})`, difRiesgo),
    datos_legibles: flagsIlegibles === 0
      ? ok('todos los JSON de proveedores y banderas se pudieron leer')
      : falla(`${flagsIlegibles} procesos con JSON ilegible`),
  };

  const veredicto = Object.values(controles).every(c => c.ok) ? 'APROBADO' : 'FALLA';
  return { anio: year, procesos, veredicto, controles, segundos: Math.round((Date.now() - t0) / 100) / 10 };
}
