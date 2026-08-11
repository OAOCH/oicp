/**
 * Arnés de verificación: re-ejecuta el motor REAL contra procesos REALES de producción y
 * compara bandera por bandera contra lo que la plataforma tiene guardado.
 *
 * No es una opinión de un modelo: importa flag-engine.ts y ejecuta la misma función que corre
 * en producción. Si el motor y los datos no coinciden, sale con código 1 y nombra el proceso.
 *
 * Uso:  npx tsx server/verificar-lote.mjs <archivo.json>
 *
 * El archivo es un array de objetos con los campos crudos del proceso, más:
 *   - `esperadas`: cadena con los códigos de las banderas ACTIVAS guardadas, separados por coma
 *   - `concentracion`: (opcional) filas de concentration_index de los pares del proceso, para
 *     poder evaluar también las CC-*. Si no viene, las CC-* se omiten de la comparación.
 */
import fs from 'node:fs';
import { evaluateIndividualFlags, evaluateConcentrationFlags } from './flag-engine.ts';

const procesos = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

// Reconstruye el contexto de concentración con la MISMA semántica que
// buildConcentrationContext() en updater.ts: byPairYear para CC-01/02/05 (hechos del año del
// proceso) y byPair para CC-03/04 (histórico del par).
function construirContexto(filas) {
  const byPairYear = new Map();
  const byPair = new Map();
  const anios = new Map();
  const procsCompradorAnio = new Map();
  for (const r of filas || []) {
    const par = `${r.buyer_id}|${r.supplier_id}`;
    byPairYear.set(`${par}|${r.year}`, {
      supplier_name: r.supplier_name,
      infima_count: r.infima_count || 0,
      infima_total_value: r.infima_total_value || 0,
      share_of_buyer: r.share_of_buyer || 0,
      buyer_total_procs: 0,
    });
    let hist = byPair.get(par);
    if (!hist) {
      hist = { supplier_name: r.supplier_name, years_active: 0, total_value: 0, consortium_count: r.consortium_count || 0 };
      byPair.set(par, hist);
      anios.set(par, new Set());
    }
    hist.total_value += r.total_value || 0;
    anios.get(par).add(r.year);
    const clave = `${r.buyer_id}|${r.year}`;
    procsCompradorAnio.set(clave, (procsCompradorAnio.get(clave) || 0) + (r.contract_count || 0));
  }
  for (const [par, s] of anios) byPair.get(par).years_active = s.size;
  for (const [clave, v] of byPairYear) {
    const i = clave.lastIndexOf('|');
    const anio = clave.slice(i + 1);
    const buyer = clave.slice(0, clave.indexOf('|'));
    v.buyer_total_procs = procsCompradorAnio.get(`${buyer}|${anio}`) || 0;
  }
  return { byPairYear, byPair };
}

const CC = new Set(['CC-01', 'CC-02', 'CC-03', 'CC-04', 'CC-05']);
const discrepancias = [];
let conCC = 0;

for (const p of procesos) {
  const proc = {
    ...p,
    suppliers: typeof p.suppliers === 'string' ? JSON.parse(p.suppliers || '[]') : (p.suppliers || []),
    has_amendments: !!p.has_amendments,
  };

  const evaluaCC = Array.isArray(p.concentracion);
  if (evaluaCC) conCC++;

  const calculadas = new Set(evaluateIndividualFlags(proc).filter(f => f.active).map(f => f.code));
  if (evaluaCC) {
    for (const f of evaluateConcentrationFlags(proc, construirContexto(p.concentracion))) {
      if (f.active) calculadas.add(f.code);
    }
  }

  const guardadas = new Set(String(p.esperadas || '').split(',').map(s => s.trim()).filter(Boolean));

  // Sin contexto de concentración no se puede juzgar las CC-*: se excluyen de las dos puntas.
  const filtro = (s) => new Set([...s].filter(c => evaluaCC || !CC.has(c)));
  const A = filtro(calculadas), B = filtro(guardadas);

  const sobran = [...A].filter(c => !B.has(c));   // el motor las produce y no están guardadas
  const faltan = [...B].filter(c => !A.has(c));   // están guardadas y el motor no las produce
  if (sobran.length || faltan.length) {
    discrepancias.push({ id: p.id, sobran, faltan, motor: [...A].sort(), guardadas: [...B].sort() });
  }
}

console.log(`procesos comparados: ${procesos.length} (con contexto de concentración: ${conCC})`);
console.log(`discrepancias: ${discrepancias.length}`);
for (const d of discrepancias) {
  console.log(`\n  ${d.id}`);
  if (d.sobran.length) console.log(`    el motor produce y NO está guardada: ${d.sobran.join(', ')}`);
  if (d.faltan.length) console.log(`    guardada y el motor NO la produce:   ${d.faltan.join(', ')}`);
  console.log(`    motor:     ${d.motor.join(', ') || '(ninguna)'}`);
  console.log(`    guardadas: ${d.guardadas.join(', ') || '(ninguna)'}`);
}
process.exit(discrepancias.length ? 1 : 0);
