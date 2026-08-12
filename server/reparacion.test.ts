/**
 * Pruebas del RELLENADO DESDE LA FUENTE (el trabajo pendiente número 1).
 *
 * Contexto, porque explica por qué estas pruebas existen y por qué son las que son:
 *
 * 174.547 procesos (11,9% del corpus) tienen el TEXTO "USD" guardado en `budget_amount`, y
 * `enquiry_deadline` está vacío en los 1.470.321. El plan heredado decía «reutiliza
 * /api/admin/ingest, que ya hace upsert por ocid». **Eso es falso**: `ingestProcs()` SALTA los
 * ocid que ya existen (`updater.ts`, `if (exists.get(raw.id)) { skipped++; continue; }`).
 * El rellenado habría corrido 16 horas contra la API del SERCOP, habría devuelto
 * `skipped: 174547`, y no habría reparado ni una fila. Sin error y sin aviso.
 *
 * La primera prueba de este archivo fija ese comportamiento por escrito para que nadie vuelva
 * a suponer lo contrario. El resto verifica el reparador de verdad.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'oicp-reparacion-'));
process.env.DB_PATH = path.join(TMP, 'reparacion.db');
process.env.JWT_SECRET = '';

const { migrate, getDb, upsertProcedure } = await import('./db.js');
const { ingestProcs, repararProcs, ocidsAReparar, reflagChanged } = await import('./updater.js');

// Una fila igual a las que hay en producción: el texto "USD" donde debería ir el monto.
function filaRota(id: string, anio = 2024, extra: Record<string, any> = {}) {
  return {
    id, ocid: id, title: `Proceso ${id}`, description: `Objeto del proceso ${id}`,
    status: 'award', procurement_method: 'open', procurement_method_details: 'Subasta Inversa Electronica',
    buyer_id: 'EC-RUC-9999999990', buyer_name: 'ENTIDAD DE PRUEBA',
    budget_amount: 'USD',                       // <- exactamente lo que hay en producción
    budget_currency: 'USD', award_amount: 16990, contract_amount: null, final_amount: null,
    published_date: `${anio}-12-30T20:00:00-05:00`,
    submission_deadline: null, enquiry_deadline: null,
    award_date: `${anio}-12-31T12:00:00-05:00`, contract_date: null,
    suppliers: [{ id: 'EC-RUC-1111111111', name: 'PROVEEDOR UNO' }],
    number_of_tenderers: 3, items_classification: null,
    has_amendments: false, amendment_count: 0,
    flags: [], score: 0, risk_level: 'low',
    source_year: anio, regime: 'LOSNCP_COEFICIENTES',
    ...extra,
  };
}

test('preparación: base con filas rotas como las de producción', () => {
  migrate();
  for (let i = 0; i < 20; i++) upsertProcedure(filaRota(`p${String(i).padStart(3, '0')}`));
  // Una fila SANA, para comprobar que el reparador no la degrada.
  upsertProcedure(filaRota('p900', 2024, { budget_amount: 12345.67, enquiry_deadline: '2024-12-31T20:00:00-05:00' }));
  // Una fila de la ventana del Art. 96 (desde el 28-oct-2025), con presupuesto bueno pero
  // sin fecha de cierre de preguntas: solo le falta enquiry_deadline.
  upsertProcedure(filaRota('p901', 2025, { budget_amount: 8000, published_date: '2025-11-15T10:00:00-05:00' }));
  // Fila SIN adjudicado y con el texto "USD" de presupuesto. Es el caso donde el defecto se ve
  // en las banderas: TR-01 mira `award_amount || budget_amount`, así que sin adjudicado el
  // presupuesto es lo único que decide si el proceso tiene valor conocido.
  upsertProcedure(filaRota('p910', 2024, { award_amount: null }));
  const db = getDb();
  // 20 del bucle + p910; p900 y p901 nacen con presupuesto bueno.
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM procedures WHERE typeof(budget_amount)='text'`).get() as any).n, 21);
});

test('EL DEFECTO DEL PLAN HEREDADO: /api/admin/ingest NO repara, salta los ocid existentes', () => {
  // Esta es la prueba que faltaba. Si algún día `ingestProcs` empieza a reparar, esta prueba
  // falla y hay que decidirlo a propósito, no descubrirlo después de 16 horas de barrido.
  const r = ingestProcs([{ ...filaRota('p000'), budget_amount: 40105.69, enquiry_deadline: '2024-12-31T20:00:00-05:00' }]);
  assert.equal(r.inserted, 0, 'no debería insertar nada: el ocid ya existe');
  assert.equal(r.skipped, 1, 'lo salta');
  const fila = getDb().prepare(`SELECT budget_amount FROM procedures WHERE id='p000'`).get() as any;
  assert.equal(fila.budget_amount, 'USD', 'y la fila sigue rota: ingest no repara');
});

test('repararProcs pone el número de la fuente donde estaba el texto "USD"', () => {
  const r = repararProcs([
    { id: 'p000', budget_amount: 40105.69, enquiry_deadline: '2024-12-31T20:00:00-05:00' },
    { id: 'p001', budget_amount: 536037.63, enquiry_deadline: '2025-01-07T15:00:00-05:00' },
  ]);
  assert.equal(r.reparados, 2);
  const db = getDb();
  const a = db.prepare(`SELECT budget_amount, typeof(budget_amount) AS t, enquiry_deadline FROM procedures WHERE id='p000'`).get() as any;
  assert.equal(a.budget_amount, 40105.69);
  assert.equal(a.t, 'real', 'tiene que quedar guardado como NÚMERO, no como texto');
  assert.equal(a.enquiry_deadline, '2024-12-31T20:00:00-05:00');
});

test('si la fuente no publica presupuesto, el texto "USD" pasa a NULL y no se queda', () => {
  // Importa para TR-01: una cadena es truthy en JavaScript, así que mientras estuvo el texto
  // "USD" el indicador de presupuesto faltante NO marcaba esos procesos. NULL sí es la verdad.
  const r = repararProcs([{ id: 'p002', budget_amount: null, enquiry_deadline: null }]);
  assert.equal(r.reparados, 1);
  const f = getDb().prepare(`SELECT budget_amount, typeof(budget_amount) AS t FROM procedures WHERE id='p002'`).get() as any;
  assert.equal(f.budget_amount, null);
  assert.equal(f.t, 'null');
});

test('no degrada un dato que ya está bien: la fuente sin monto no borra un presupuesto válido', () => {
  const r = repararProcs([{ id: 'p900', budget_amount: null, enquiry_deadline: null }]);
  assert.equal(r.reparados, 0);
  assert.equal(r.sin_cambio, 1);
  const f = getDb().prepare(`SELECT budget_amount, enquiry_deadline FROM procedures WHERE id='p900'`).get() as any;
  assert.equal(f.budget_amount, 12345.67);
  assert.equal(f.enquiry_deadline, '2024-12-31T20:00:00-05:00');
});

test('un ocid que no existe NO se inserta por esta vía: el reparador solo repara', () => {
  const r = repararProcs([{ id: 'no-existe-jamas', budget_amount: 999, enquiry_deadline: null }]);
  assert.equal(r.reparados, 0);
  assert.equal(r.ausentes, 1);
  assert.equal((getDb().prepare(`SELECT COUNT(*) AS n FROM procedures WHERE id='no-existe-jamas'`).get() as any).n, 0);
});

test('el reparador NO toca ninguna otra columna (los agregados a_* no se desincronizan)', () => {
  const db = getDb();
  const antes = db.prepare(`SELECT * FROM procedures WHERE id='p003'`).get() as any;
  repararProcs([{ id: 'p003', budget_amount: 26057.94, enquiry_deadline: '2025-01-07T15:00:00-05:00' }]);
  const despues = db.prepare(`SELECT * FROM procedures WHERE id='p003'`).get() as any;
  const permitidas = new Set(['budget_amount', 'enquiry_deadline', 'updated_at']);
  for (const col of Object.keys(antes)) {
    if (permitidas.has(col)) continue;
    assert.deepEqual(despues[col], antes[col], `el reparador cambió la columna ${col}, y no debe`);
  }
});

test('ocidsAReparar pagina con cursor estable por id y no repite ni salta filas', () => {
  const vistos: string[] = [];
  let desde = '';
  for (let vuelta = 0; vuelta < 50; vuelta++) {
    const ids = ocidsAReparar('presupuesto', 3, desde);
    if (!ids.length) break;
    vistos.push(...ids);
    desde = ids[ids.length - 1];
  }
  assert.equal(new Set(vistos).size, vistos.length, 'no puede devolver el mismo id dos veces');
  const pendientes = (getDb().prepare(
    `SELECT COUNT(*) AS n FROM procedures WHERE typeof(budget_amount)='text'`).get() as any).n;
  assert.equal(vistos.length, pendientes, 'tiene que devolver exactamente los que faltan');
  assert.deepEqual([...vistos].sort(), vistos, 'y en orden de id, para que el cursor sea estable');
});

test('reanudar a mitad de página no deja huecos: el cursor va al último procesado, no al último de la página', () => {
  // El barrido puede quedarse sin tiempo a mitad de una página. Si el cursor saltara al último
  // id de la página, los que no se alcanzaron a procesar NUNCA se volverían a pedir y el
  // rellenado se daría por completo faltando datos. Este es el contrato que lo impide.
  const pagina = ocidsAReparar('presupuesto', 10, '');
  assert.ok(pagina.length >= 6, 'hacen falta al menos 6 pendientes para esta prueba');

  const procesados = pagina.slice(0, 4);          // solo se alcanzaron los cuatro primeros
  const noProcesados = pagina.slice(4);
  const siguiente = ocidsAReparar('presupuesto', 500, procesados[procesados.length - 1]);

  for (const id of noProcesados) {
    assert.ok(siguiente.includes(id), `${id} se perdió: el cursor lo saltó sin procesarlo`);
  }
  for (const id of procesados) {
    assert.ok(!siguiente.includes(id), `${id} se repetiría: el cursor no avanzó`);
  }
});

test('el criterio "enquiry" solo trae los de la ventana del Art. 96 (desde el 28-oct-2025)', () => {
  const ids = ocidsAReparar('enquiry', 500, '');
  assert.ok(ids.includes('p901'), 'p901 es de nov-2025 y le falta enquiry_deadline');
  assert.ok(!ids.includes('p900'), 'p900 ya tiene enquiry_deadline');
  for (const id of ids) {
    const f = getDb().prepare(`SELECT published_date, enquiry_deadline FROM procedures WHERE id=?`).get(id) as any;
    assert.ok(f.published_date >= '2025-10-28', `${id} está fuera de la ventana del Art. 96`);
    assert.equal(f.enquiry_deadline, null);
  }
});

test('un criterio desconocido se rechaza, no se interpola en el SQL', () => {
  assert.throws(() => ocidsAReparar("presupuesto' OR 1=1 --" as any, 10, ''), /criterio/i);
});

const activas = (id: string) => {
  const f = getDb().prepare(`SELECT flags FROM procedures WHERE id=?`).get(id) as any;
  return JSON.parse(f.flags || '[]').filter((x: any) => x.active).map((x: any) => x.code) as string[];
};

test('el rellenado cambia las banderas: TR-01 deja de marcar el proceso cuyo valor ya se conoce', async () => {
  const db = getDb();

  // Estado de partida: p910 no tiene adjudicado y su presupuesto es el texto "USD". El motor
  // normaliza ese texto a 0 (`Number(...) || 0`), así que el proceso figura SIN valor conocido.
  await reflagChanged(db);
  assert.ok(activas('p910').includes('TR-01'),
    'antes de reparar, p910 no tiene valor conocido y TR-01 tiene que marcarlo');

  repararProcs([{ id: 'p910', budget_amount: 20000, enquiry_deadline: '2024-12-31T20:00:00-05:00' }]);
  await reflagChanged(db);

  assert.ok(!activas('p910').includes('TR-01'),
    'tras el rellenado el presupuesto se conoce, así que TR-01 ya no debe marcarlo');

  // Y el que de verdad no tiene presupuesto en la fuente lo sigue marcando: el rellenado no
  // "limpia" banderas, publica la verdad.
  assert.equal((db.prepare(`SELECT budget_amount FROM procedures WHERE id='p002'`).get() as any).budget_amount, null);
});

test('cuando ya no queda nada por reparar, el cursor devuelve vacío y el barrido termina', () => {
  let desde = ''; let vueltas = 0;
  for (;;) {
    const ids = ocidsAReparar('presupuesto', 100, desde);
    if (!ids.length) break;
    repararProcs(ids.map(id => ({ id, budget_amount: 20000, enquiry_deadline: '2024-12-31T20:00:00-05:00' })));
    desde = ids[ids.length - 1];
    if (++vueltas > 50) throw new Error('el barrido no converge: el cursor no avanza');
  }
  assert.equal(ocidsAReparar('presupuesto', 500, '').length, 0);
  assert.equal((getDb().prepare(
    `SELECT COUNT(*) AS n FROM procedures WHERE typeof(budget_amount)='text'`).get() as any).n, 0);
});
