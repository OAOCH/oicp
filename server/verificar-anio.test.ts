/**
 * Pruebas de la BOLETA DE VERIFICACIÓN POR AÑO.
 *
 * Lo que se prueba aquí no es que apruebe: es que **sepa fallar**. Un verificador que devuelve
 * APROBADO pase lo que pase no verifica nada, y es peor que no tener ninguno, porque da confianza
 * falsa. Así que por cada control se estropea el dato a propósito y se exige que lo cace.
 *
 * Es la misma lección de la sesión anterior: la prueba del aviso de truncamiento se llamaba
 * «avisa cuando trunca» y solo comprobaba el largo de la respuesta, así que el defecto sobrevivió.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'oicp-boleta-'));
process.env.DB_PATH = path.join(TMP, 'boleta.db');
process.env.JWT_SECRET = '';

const { migrate, getDb, upsertProcedure, rebuildConcentrationIndex } = await import('./db.js');
const { buildAnalytics } = await import('./mcp-server.js');
const { reflagChanged } = await import('./updater.js');
const { verificarAnio } = await import('./verificar-anio.js');

const ANIO = 2024;
const N = 120;

function fila(i: number, extra: Record<string, any> = {}) {
  const award = i % 17 === 0 ? 0 : 900 + i * 211;
  return {
    id: `p${String(i).padStart(4, '0')}`, ocid: `ocds-5wno2w-SIE-X-${ANIO}-${i}-1`,
    title: `Proceso ${i}`, description: `Objeto del proceso ${i} con texto suficiente para no ser genérico`,
    status: 'award', procurement_method: i % 3 === 0 ? 'direct' : 'open',
    procurement_method_details: ['Menor Cuantía', 'Subasta Inversa Electrónica', 'Régimen Especial'][i % 3],
    buyer_id: `EC-RUC-176000112000${i % 7}-24${i % 7}`, buyer_name: `ENTIDAD ${i % 7}`,
    budget_amount: award ? Math.round(award * 1.03 * 100) / 100 : 5000,
    budget_currency: 'USD', award_amount: award, contract_amount: award, final_amount: null,
    published_date: `${ANIO}-0${(i % 9) + 1}-15T12:00:00-05:00`,
    submission_deadline: `${ANIO}-0${(i % 9) + 1}-20T12:00:00-05:00`,
    enquiry_deadline: null, answer_deadline: null,
    award_date: `${ANIO}-0${(i % 9) + 1}-25T12:00:00-05:00`, contract_date: null,
    suppliers: [{ id: `EC-RUC-111111111${i % 5}001-9`, name: `PROVEEDOR ${i % 5}` }],
    number_of_tenderers: i % 6 === 0 ? 1 : 3, items_classification: null,
    has_amendments: false, amendment_count: 0,
    flags: [], score: 0, risk_level: 'low',
    source_year: ANIO, regime: 'LOSNCP_COEFICIENTES',
    ...extra,
  };
}

test('preparación: un año sano y consistente', async () => {
  migrate();
  for (let i = 0; i < N; i++) upsertProcedure(fila(i));
  rebuildConcentrationIndex();
  await reflagChanged(getDb());
  buildAnalytics(getDb());
});

test('un año sano sale APROBADO en todos los controles', async () => {
  const b = await verificarAnio(ANIO);
  const fallidos = Object.entries(b.controles).filter(([, c]) => !c.ok)
    .map(([k, c]) => `${k}: ${c.detalle} ${JSON.stringify(c.ejemplos || [])}`);
  assert.deepEqual(fallidos, [], 'un año sano no debería fallar ningún control');
  assert.equal(b.veredicto, 'APROBADO');
  assert.equal(b.procesos, N, 'tiene que recorrer TODOS los procesos del año, sin muestrear');
});

// ── A partir de aquí se estropea el dato a propósito, control por control ────────────────────

test('caza una bandera guardada que el motor NO produce', async () => {
  const db = getDb();
  const antes = db.prepare(`SELECT flags FROM procedures WHERE id='p0005'`).get() as any;
  const conBasura = JSON.parse(antes.flags);
  conBasura.push({ code: 'CC-02', category: 'concentracion', name: 'x', name_es: 'x',
    description_es: 'x', severity: 3, active: true, detail: 'inventada' });
  db.prepare(`UPDATE procedures SET flags=? WHERE id='p0005'`).run(JSON.stringify(conBasura));
  try {
    const b = await verificarAnio(ANIO);
    assert.equal(b.controles.motor.ok, false, 'una bandera inventada tiene que salir como discrepancia');
    assert.match(b.controles.motor.ejemplos!.join(' '), /p0005/);
    assert.equal(b.veredicto, 'FALLA');
  } finally {
    db.prepare(`UPDATE procedures SET flags=? WHERE id='p0005'`).run(antes.flags);
  }
});

test('caza un presupuesto guardado como TEXTO', async () => {
  const db = getDb();
  // El valor ORIGINAL, no uno inventado: al restaurarlo a 1000 las banderas guardadas dejaban de
  // corresponder al presupuesto y el control del motor seguía fallando después. Que lo detectara
  // es justo lo que se le pide a la boleta, pero el error era de esta prueba.
  const antes = (db.prepare(`SELECT budget_amount FROM procedures WHERE id='p0006'`).get() as any).budget_amount;
  db.prepare(`UPDATE procedures SET budget_amount='USD' WHERE id='p0006'`).run();
  try {
    const b = await verificarAnio(ANIO);
    assert.equal(b.controles.presupuesto.ok, false);
    assert.match(b.controles.presupuesto.detalle, /1 presupuesto/);
  } finally {
    db.prepare(`UPDATE procedures SET budget_amount=? WHERE id='p0006'`).run(antes);
  }
});

test('caza un régimen que no corresponde a la fecha', async () => {
  const db = getDb();
  db.prepare(`UPDATE procedures SET regime='LOSNCP_REFORMADA' WHERE id='p0007'`).run();
  try {
    const b = await verificarAnio(ANIO);
    assert.equal(b.controles.regimen.ok, false, 'un proceso de 2024 no puede declarar la reforma de oct-2025');
    assert.match(b.controles.regimen.ejemplos!.join(' '), /p0007/);
  } finally {
    db.prepare(`UPDATE procedures SET regime='LOSNCP_COEFICIENTES' WHERE id='p0007'`).run();
  }
});

test('caza un proveedor con nombre inservible', async () => {
  const db = getDb();
  const antes = (db.prepare(`SELECT suppliers FROM procedures WHERE id='p0008'`).get() as any).suppliers;
  db.prepare(`UPDATE procedures SET suppliers=? WHERE id='p0008'`)
    .run(JSON.stringify([{ id: 'EC-RUC-1111111110001-9', name: 'null' }]));
  try {
    const b = await verificarAnio(ANIO);
    assert.equal(b.controles.proveedores.ok, false, 'un nombre guardado como "null" tiene que salir');
    assert.match(b.controles.proveedores.ejemplos!.join(' '), /p0008/);
  } finally {
    db.prepare(`UPDATE procedures SET suppliers=? WHERE id='p0008'`).run(antes);
  }
});

test('caza un nivel de riesgo que no corresponde a su score', async () => {
  const db = getDb();
  const antes = (db.prepare(`SELECT risk_level FROM procedures WHERE id='p0009'`).get() as any).risk_level;
  db.prepare(`UPDATE procedures SET risk_level='critical' WHERE id='p0009'`).run();
  try {
    const b = await verificarAnio(ANIO);
    assert.equal(b.controles.riesgo_vs_score.ok, false);
  } finally {
    db.prepare(`UPDATE procedures SET risk_level=? WHERE id='p0009'`).run(antes);
  }
});

test('caza que el agregado publicado no cuadre con la base', async () => {
  const db = getDb();
  const antes = db.prepare(`SELECT code, n FROM a_flag_year WHERE year=? ORDER BY n DESC LIMIT 1`).get(ANIO) as any;
  assert.ok(antes, 'la preparación tiene que haber dejado banderas en el agregado');
  db.prepare(`UPDATE a_flag_year SET n = n + 7 WHERE code=? AND year=?`).run(antes.code, ANIO);
  try {
    const b = await verificarAnio(ANIO);
    assert.equal(b.controles.agregado_banderas.ok, false,
      'si a_flag_year dice una cosa y la base otra, la web publica una cifra que no existe');
  } finally {
    db.prepare(`UPDATE a_flag_year SET n = ? WHERE code=? AND year=?`).run(antes.n, antes.code, ANIO);
  }
});

test('caza una fecha de publicación fuera del año', async () => {
  const db = getDb();
  const antes = (db.prepare(`SELECT published_date FROM procedures WHERE id='p0010'`).get() as any).published_date;
  db.prepare(`UPDATE procedures SET published_date='2019-03-03T10:00:00-05:00' WHERE id='p0010'`).run();
  try {
    const b = await verificarAnio(ANIO);
    assert.equal(b.controles.fechas.ok, false);
  } finally {
    db.prepare(`UPDATE procedures SET published_date=? WHERE id='p0010'`).run(antes);
  }
});

test('el texto de CATÁLOGO viejo NO es falla, pero se cuenta', async () => {
  // La plataforma re-renderiza name_es/description_es desde el catálogo vigente al mostrar
  // (`hidratarBanderas`), decisión tomada a propósito para que corregir la metodología no exija
  // reescribir 1,47 M de filas. Así que un nombre de indicador viejo guardado NO afecta a lo que
  // ve el usuario. La primera versión de esta boleta comparaba el JSON entero y gritaba FALLA en
  // los ocho años por un cambio de nombre: una alarma que no correspondía a ningún daño.
  const db = getDb();
  // Se BUSCA un proceso que tenga banderas en vez de dar por hecho cuál las tiene: dando por
  // hecho, la prueba fallaba por su propia suposición y no por el comportamiento que mide.
  const fila = db.prepare(
    `SELECT id, flags FROM procedures WHERE source_year=? AND flags != '[]' LIMIT 1`).get(ANIO) as any;
  assert.ok(fila, 'la preparación tiene que haber dejado algún proceso con banderas');
  const conTextoViejo = JSON.parse(fila.flags).map((f: any) => ({ ...f, name_es: 'NOMBRE ANTIGUO DEL INDICADOR' }));
  db.prepare(`UPDATE procedures SET flags=? WHERE id=?`).run(JSON.stringify(conTextoViejo), fila.id);
  try {
    const b = await verificarAnio(ANIO);
    assert.equal(b.controles.motor.ok, true, 'un nombre de catálogo viejo no puede ser FALLA');
    assert.ok(b.texto_catalogo_viejo >= 1, 'pero tiene que contarse para saber que conviene un reflag');
  } finally {
    db.prepare(`UPDATE procedures SET flags=? WHERE id=?`).run(fila.flags, fila.id);
  }
});

test('un DETALLE distinto SÍ es falla: es lo que lee el usuario en la ficha', async () => {
  const db = getDb();
  const fila = db.prepare(
    `SELECT id, flags FROM procedures WHERE source_year=? AND flags != '[]' LIMIT 1`).get(ANIO) as any;
  assert.ok(fila, 'la preparación tiene que haber dejado algún proceso con banderas');
  const guardadas = JSON.parse(fila.flags);
  guardadas[0].detail = 'un detalle que el motor no produce';
  db.prepare(`UPDATE procedures SET flags=? WHERE id=?`).run(JSON.stringify(guardadas), fila.id);
  try {
    const b = await verificarAnio(ANIO);
    assert.equal(b.controles.motor.ok, false, 'el detalle es lo que se publica en la ficha');
    assert.ok(b.controles.motor.ejemplos!.join(' ').includes(fila.id), 'tiene que decir cuál');
  } finally {
    db.prepare(`UPDATE procedures SET flags=? WHERE id=?`).run(fila.flags, fila.id);
  }
});

test('caza un score VIEJO en la muestra de ejemplos críticos', async () => {
  // Es el hallazgo real del 13-ago-2026: los recálculos cambiaron scores en `procedures` sin
  // cambiar el nivel, y `a_supplier_critical` (lo que sirve oicp_supplier_profile) se quedó con
  // los puntajes de antes. Esta boleta no lo cazó porque no cubría la tabla.
  const db = getDb();
  const fila = db.prepare(`SELECT ocid, score FROM a_supplier_critical WHERE year=? LIMIT 1`).get(ANIO) as any;
  assert.ok(fila, 'la preparación tiene que haber dejado ejemplos críticos para este año');
  db.prepare(`UPDATE a_supplier_critical SET score = score + 9 WHERE ocid=?`).run(fila.ocid);
  try {
    const b = await verificarAnio(ANIO);
    assert.equal(b.controles.muestra_criticos.ok, false, 'un score viejo en la muestra tiene que salir');
    assert.ok(b.controles.muestra_criticos.ejemplos!.join(' ').includes(fila.ocid));
  } finally {
    db.prepare(`UPDATE a_supplier_critical SET score = ? WHERE ocid=?`).run(fila.score, fila.ocid);
  }
});

test('el reflag actualiza la muestra aunque el nivel NO cambie (la causa raíz del hallazgo)', async () => {
  // Reproduce el escenario real: la base y la muestra comparten un score VIEJO, el motor produce
  // otro, y el nivel no cambia. Con el código anterior el reflag corregía `procedures` y dejaba
  // `a_supplier_critical` con el puntaje de antes, porque su mantenimiento estaba anidado bajo
  // «solo si cambió el nivel».
  const db = getDb();
  const fila = db.prepare(`
      SELECT m.ocid, p.score AS real FROM a_supplier_critical m JOIN procedures p ON p.id=m.ocid
      WHERE m.year=? AND p.score BETWEEN 34 AND 59 LIMIT 1`).get(ANIO) as any;
  assert.ok(fila, 'hace falta un ejemplo en la banda alta con margen para no cambiar de nivel');
  const falso = fila.real + 1;   // sigue dentro de 31-60: mismo nivel, distinto score

  db.prepare(`UPDATE procedures SET score=? WHERE id=?`).run(falso, fila.ocid);
  db.prepare(`UPDATE a_supplier_critical SET score=? WHERE ocid=?`).run(falso, fila.ocid);

  await reflagChanged(db);   // el motor recalcula el score real; el nivel no cambia

  const p = db.prepare(`SELECT score FROM procedures WHERE id=?`).get(fila.ocid) as any;
  const m = db.prepare(`SELECT score FROM a_supplier_critical WHERE ocid=?`).get(fila.ocid) as any;
  assert.equal(p.score, fila.real, 'el reflag tiene que devolver el score verdadero a la base');
  assert.equal(m.score, fila.real,
    'y la muestra tiene que seguirlo AUNQUE el nivel no cambie: aquí vivía el bug');
});

test('caza un desfase en a_supplier_risk, el agregado de monto por proveedor y nivel', async () => {
  const db = getDb();
  const fila = db.prepare(`SELECT ruc10, risk_level, n_procs FROM a_supplier_risk WHERE year=? LIMIT 1`).get(ANIO) as any;
  assert.ok(fila, 'buildAnalytics tiene que haber generado a_supplier_risk');
  db.prepare(`UPDATE a_supplier_risk SET n_procs = n_procs + 3 WHERE ruc10=? AND risk_level=? AND year=?`)
    .run(fila.ruc10, fila.risk_level, ANIO);
  try {
    const b = await verificarAnio(ANIO);
    assert.equal(b.controles.riesgo_proveedor.ok, false, 'un agregado inflado tiene que salir');
  } finally {
    db.prepare(`UPDATE a_supplier_risk SET n_procs = ? WHERE ruc10=? AND risk_level=? AND year=?`)
      .run(fila.n_procs, fila.ruc10, fila.risk_level, ANIO);
  }
});

test('cuando el reflag CAMBIA el nivel, a_supplier_risk mueve el proceso de fila (incremental)', async () => {
  // El flujo real de la ingesta: el proceso entra con banderas sin evaluar (low, score 0) y el
  // reflag lo sube a su nivel verdadero. Ese salto de nivel tiene que MOVER el conteo y el monto
  // de la fila `low` a la fila del nivel real, para el ruc de cada proveedor.
  const db = getDb();
  const RUC = '3333333333';
  upsertProcedure(fila(500, {
    id: 'p0500', ocid: `ocds-5wno2w-RE-NUEVO-${ANIO}-500-1`,
    procurement_method: 'direct', procurement_method_details: 'Régimen Especial',
    award_amount: 50000, contract_amount: 50000, budget_amount: 51000,
    suppliers: [{ id: `EC-RUC-${RUC}001-9`, name: 'PROVEEDOR NUEVO AISLADO' }],
    flags: [], score: 0, risk_level: 'low',
  }));
  // Simula el patch de la ingesta para el estado inicial (low).
  const { patchAggregatesForNew } = await import('./updater.js');
  patchAggregatesForNew(db, [{ ...fila(500), id: 'p0500', risk_level: 'low', score: 0, flags: [],
    suppliers: [{ id: `EC-RUC-${RUC}001-9`, name: 'PROVEEDOR NUEVO AISLADO' }],
    award_amount: 50000, contract_amount: 50000 }]);
  const antes = db.prepare(`SELECT risk_level, n_procs FROM a_supplier_risk WHERE ruc10=?`).all(RUC) as any[];
  assert.deepEqual(antes, [{ risk_level: 'low', n_procs: 1 }], 'el estado inicial es una fila low');

  await reflagChanged(db);   // el motor lo sube a su nivel real (direct + 50k => IC-02 y compañía)

  const despues = db.prepare(`SELECT risk_level, n_procs, total_usd FROM a_supplier_risk
      WHERE ruc10=? AND n_procs != 0 ORDER BY risk_level`).all(RUC) as any[];
  const nivelReal = (db.prepare(`SELECT risk_level FROM procedures WHERE id='p0500'`).get() as any).risk_level;
  assert.notEqual(nivelReal, 'low', 'la preparación exige que el motor lo suba de nivel');
  assert.deepEqual(despues.map(r => ({ rl: r.risk_level, n: r.n_procs })),
    [{ rl: nivelReal, n: 1 }],
    'el proceso tiene que haberse MOVIDO de la fila low a la fila de su nivel real');
});

test('tras deshacer todos los sabotajes, el año vuelve a APROBADO', async () => {
  const b = await verificarAnio(ANIO);
  const fallidos = Object.entries(b.controles).filter(([, c]) => !c.ok).map(([k]) => k);
  assert.deepEqual(fallidos, [], 'quedó un sabotaje sin deshacer o un control es inestable');
});
