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

test('tras deshacer todos los sabotajes, el año vuelve a APROBADO', async () => {
  const b = await verificarAnio(ANIO);
  const fallidos = Object.entries(b.controles).filter(([, c]) => !c.ok).map(([k]) => k);
  assert.deepEqual(fallidos, [], 'quedó un sabotaje sin deshacer o un control es inestable');
});
