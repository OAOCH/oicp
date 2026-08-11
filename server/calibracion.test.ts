/**
 * Calibración de indicadores corregida el 2026-08-11, con su respaldo.
 *
 * Cada prueba fija una corrección que se hizo sobre EVIDENCIA MEDIDA en producción, no sobre
 * intuición. Si alguien revierte una de estas condiciones, el CI lo grita.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateIndividualFlags, getInfimaThreshold, FLAG_CATALOG, hidratarBanderas, calculateScore } from './flag-engine.js';

const codigos = (fs: any[]) => fs.map(f => f.code);

// ── IP-02: solo el EXCESO sobre el presupuesto es riesgo ──
// Medido en producción sobre 2024: de 1.704 procesos marcados con IP-02, CERO tenían el
// adjudicado por encima del presupuesto y los 1.704 estaban por debajo. El indicador usaba el
// valor absoluto de la diferencia y por tanto señalaba a entidades que adjudicaron por MENOS de
// lo presupuestado, que es el resultado esperable de la competencia.
test('IP-02 NO dispara cuando se adjudica POR DEBAJO del presupuesto (era el defecto)', () => {
  const proc = { id: 'x', procurement_method: 'open', procurement_method_details: 'Subasta Inversa Electronica',
    budget_amount: 100_000, award_amount: 70_000, published_date: '2024-06-15T12:00:00-05:00' };
  assert.ok(!codigos(evaluateIndividualFlags(proc as any)).includes('IP-02'),
    'adjudicar 30% por debajo del referencial es competencia sana, no riesgo');
});

test('IP-02 SÍ dispara cuando se adjudica por encima del presupuesto', () => {
  const proc = { id: 'x', procurement_method: 'open', procurement_method_details: 'Subasta Inversa Electronica',
    budget_amount: 100_000, award_amount: 130_000, published_date: '2024-06-15T12:00:00-05:00' };
  const f = evaluateIndividualFlags(proc as any);
  assert.ok(codigos(f).includes('IP-02'));
  assert.match(f.find(x => x.code === 'IP-02')!.detail!, /POR ENCIMA/);
});

test('IP-02 no dispara con un exceso menor al 15%', () => {
  const proc = { id: 'x', procurement_method: 'open', procurement_method_details: 'Subasta Inversa Electronica',
    budget_amount: 100_000, award_amount: 110_000, published_date: '2024-06-15T12:00:00-05:00' };
  assert.ok(!codigos(evaluateIndividualFlags(proc as any)).includes('IP-02'));
});

// ── IC-02: el catálogo electrónico se excluye ──
// El SERCOP publica las órdenes de catálogo con procurement_method "direct", y 65.497 de los
// 109.642 disparos de IC-02 (60%) eran compras de catálogo: compra centralizada en la que el
// propio SERCOP precalifica proveedores y fija precios. El motor ya excluía el catálogo de todas
// las banderas de concentración; mantenerlo en IC-02 era una incoherencia interna.
test('IC-02 NO dispara en catálogo electrónico aunque el monto supere el umbral', () => {
  const proc = { id: 'x', procurement_method: 'direct',
    procurement_method_details: 'Catálogo electrónico - Compra directa en el convenio marco',
    award_amount: 50_000, published_date: '2024-06-15T12:00:00-05:00' };
  assert.ok(!codigos(evaluateIndividualFlags(proc as any)).includes('IC-02'));
});

test('IC-02 SÍ dispara en contratación directa fuera de catálogo', () => {
  const proc = { id: 'x', procurement_method: 'direct', procurement_method_details: 'Régimen Especial',
    award_amount: 50_000, published_date: '2024-06-15T12:00:00-05:00' };
  assert.ok(codigos(evaluateIndividualFlags(proc as any)).includes('IC-02'));
});

test('IC-02 no dispara si el monto no supera el umbral de su fecha', () => {
  const proc = { id: 'x', procurement_method: 'direct', procurement_method_details: 'Régimen Especial',
    award_amount: 5_000, published_date: '2024-06-15T12:00:00-05:00' };
  assert.ok(!codigos(evaluateIndividualFlags(proc as any)).includes('IC-02'));
});

// ── IT-02: la exclusión de ínfima ahora funciona ──
// Antes se evaluaba buscando la palabra "ínfima" en el texto del procedimiento, que no aparece en
// ninguno de los 1.470.321 procesos: la exclusión no descartaba nada y 525 de los 2.237 disparos
// (23,5%) eran compras por debajo del umbral, marcadas por ser rápidas cuando su rapidez es lo
// esperable en una ínfima cuantía. Medido sobre producción: 522 estrictamente bajo el umbral de su
// fecha y 3 exactamente en el umbral, que cuentan porque el Art. 50 dice "igual o inferior".
test('IT-02 NO dispara en una compra bajo el umbral de ínfima (la exclusión ya funciona)', () => {
  const proc = { id: 'x', procurement_method: 'direct', procurement_method_details: 'Subasta Inversa Electronica',
    award_amount: 1_000,   // muy por debajo del umbral de 2024 (6.658,78)
    published_date: '2024-06-17T12:00:00-05:00', award_date: '2024-06-17T15:00:00-05:00' };
  assert.ok(!codigos(evaluateIndividualFlags(proc as any)).includes('IT-02'));
});

test('IT-02 SÍ dispara en una compra grande adjudicada de inmediato', () => {
  const proc = { id: 'x', procurement_method: 'open', procurement_method_details: 'Subasta Inversa Electronica',
    award_amount: 400_000,
    published_date: '2024-06-17T12:00:00-05:00', award_date: '2024-06-17T15:00:00-05:00' };
  assert.ok(codigos(evaluateIndividualFlags(proc as any)).includes('IT-02'));
});

test('IT-02 no excluye una compra de catálogo por monto bajo: el catálogo no es ínfima', () => {
  // isInfimaByAmount excluye el catálogo a propósito, así que una orden de catálogo pequeña
  // adjudicada rápido SÍ puede marcarse. Se fija para que el criterio quede explícito.
  const proc = { id: 'x', procurement_method: 'direct',
    procurement_method_details: 'Catálogo electrónico - Compra directa', award_amount: 1_000,
    published_date: '2024-06-17T12:00:00-05:00', award_date: '2024-06-17T15:00:00-05:00' };
  assert.ok(codigos(evaluateIndividualFlags(proc as any)).includes('IT-02'));
});

// ── Umbral de ínfima: 2025 tiene TRES tramos ──
test('el umbral salta a 10.000 el 7 de JULIO de 2025, no en octubre', () => {
  assert.equal(getInfimaThreshold('2025-07-06T23:59:00-05:00'), 7_212.60);
  assert.equal(getInfimaThreshold('2025-07-07T00:00:00-05:00'), 10_000);
  assert.equal(getInfimaThreshold('2025-08-20'), 10_000, 'agosto de 2025 ya está en 10.000');
});

test('el umbral no depende de la zona horaria con la que venga escrita la fecha', () => {
  // Con objetos Date, '2025-07-07' se interpreta en UTC y '2025-07-07T00:00:00-05:00' son cinco
  // horas distintas: el mismo día caía a un lado o al otro del corte.
  assert.equal(getInfimaThreshold('2025-07-07'), 10_000);
  assert.equal(getInfimaThreshold('2025-07-07T00:00:00-05:00'), 10_000);
  assert.equal(getInfimaThreshold('2025-07-07T23:59:59-05:00'), 10_000);
});

test('una fecha inválida no rompe el cálculo del umbral', () => {
  assert.equal(getInfimaThreshold('no-es-fecha'), 10_000);
  assert.equal(getInfimaThreshold(''), 10_000);
  assert.equal(getInfimaThreshold(null), 10_000);
});

// ── Citas a la guía de la OCP ──
// Revisadas el 2026-08-11 contra el PDF oficial de la edición 2024, código por código. Se fijan
// aquí para que nadie vuelva a poner una cita sin comprobarla: una cita falsa es peor que ninguna
// porque un auditor la verifica en treinta segundos. La política completa está en el comentario
// de FLAG_CATALOG, y el mismo mapa se publica en client/src/pages/Methodology.tsx (regla 10).
test('las citas OCP son exactamente las verificadas contra la guía de 2024', () => {
  const esperado: Record<string, string | undefined> = {
    'IC-01': 'R018',      // Single bid received
    'IC-02': undefined,   // retirada: R055 exige sumar varias adjudicaciones del mismo par
    'IT-01': 'R003',      // The submission period is too short
    'IT-02': 'R061',      // adaptada: la guía mide cierre de ofertas -> adjudicación
    'IP-01': 'R011',      // adaptada: la guía agrupa 2+ procesos; aquí se evalúa uno
    'IP-02': 'R031',      // Winning bid price very close or higher than estimated price
    'IP-03': 'R069',      // Contract amendments to increase price
    'CC-01': undefined,
    'CC-02': 'R050',      // High market share (R051 es concentración de mercado por HHI)
    'CC-03': undefined,
    'CC-04': undefined,   // retirada: R070 es subcontratación de oferentes perdedores
    'CC-05': 'R055',      // Multiple direct awards above or just below competitive threshold
    'TR-01': undefined,   // retirada: R001 es ausencia de documentos de planificación
    'TR-02': undefined,   // retirada: R013 es proporción de métodos no competitivos del comprador
    'TR-03': undefined,   // retirada: R039 son preguntas de oferentes sin responder
  };
  for (const [codigo, ocp] of Object.entries(esperado)) {
    assert.equal(FLAG_CATALOG[codigo]?.ocp_ref, ocp,
      `la cita OCP de ${codigo} cambió sin verificarla contra la guía`);
  }
  assert.equal(Object.keys(FLAG_CATALOG).length, 15, 'el catálogo dejó de tener 15 indicadores');
});

// ── budget_amount llega como el TEXTO "USD" en 174.547 procesos (11,9% del corpus) ──
// Es un defecto de la fuente del SERCOP, no de la plataforma, y no se puede reparar: el monto
// real no quedó en ninguna otra columna (budget_currency está en NULL en las 174.547 filas, así
// que la herramienta /api/admin/fix-budget no tiene de dónde recuperarlo).
//
// Lo que sí importa es el CONTRATO: quien llame al motor tiene que normalizar con
// Number(...) || 0 antes, como hace updater.ts:427. Sin esa normalización el valor del proceso
// queda como la cadena "USD", que en JavaScript es truthy, y TR-01 deja de marcar el campo
// "valor" como faltante. Esta prueba fija las dos puntas para que nadie escriba un camino
// nuevo hacia el motor y se salte la normalización sin que el CI lo grite.
test('con budget_amount como texto y sin adjudicado, el motor normalizado marca TR-01', () => {
  // Con comprador, proveedor y método presentes, el ÚNICO campo que puede faltar es el valor:
  // así la prueba aísla el efecto de la normalización en vez de dispararse por otra causa.
  const crudo = { id: 'x', procurement_method: 'open',
    procurement_method_details: 'Subasta Inversa Electronica',
    buyer_id: 'EC-RUC-0160006710001-125302',
    budget_amount: 'USD' as any, award_amount: null,
    published_date: '2024-03-21T17:00:00-05:00',
    title: 'SIE-DD01D04S-2024-00003', description: 'Adquisicion de equipos informaticos para la direccion distrital',
    suppliers: [{ id: 'EC-RUC-1', name: 'PROVEEDOR' }] };

  const normalizado = { ...crudo, budget_amount: Number(crudo.budget_amount) || 0 };
  const conNormalizar = evaluateIndividualFlags(normalizado as any).find(f => f.code === 'TR-01');
  assert.ok(conNormalizar, 'normalizado, el proceso no tiene valor y TR-01 debe marcarlo: es lo que hace producción');
  assert.match(conNormalizar!.detail!, /valor/, 'y el campo que debe nombrar como faltante es el valor');

  const sinNormalizar = codigos(evaluateIndividualFlags(crudo as any));
  assert.ok(!sinNormalizar.includes('TR-01'),
    'sin normalizar, la cadena "USD" es truthy y TR-01 se pierde: por eso la normalización es obligatoria');
});

// ── Días hábiles: el resultado no puede depender de la hora ──
// Antes businessDays iteraba sobre objetos Date con hora y usaba getDay()/setDate(), atados a la
// zona horaria del servidor. Medido en producción: de los procesos con exactamente UN día
// calendario entre publicación y adjudicación, 311 decían «1 día hábil» y 460 decían «2».
test('el mismo intervalo de calendario da el mismo número de días hábiles, sea cual sea la hora', () => {
  const casos: [string, string][] = [
    ['2024-06-17T09:00:00-05:00', '2024-06-18T17:00:00-05:00'],  // mañana -> tarde
    ['2024-06-17T17:00:00-05:00', '2024-06-18T09:00:00-05:00'],  // tarde -> mañana
    ['2024-06-17T23:59:00-05:00', '2024-06-18T00:01:00-05:00'],  // extremos del día
    ['2024-06-17', '2024-06-18'],                                 // sin hora
    ['2024-06-17T00:00:00Z', '2024-06-18T23:59:59Z'],             // en UTC
  ];
  const resultados = casos.map(([a, b]) => {
    const f = evaluateIndividualFlags({ id: 'x', procurement_method: 'open',
      procurement_method_details: 'Subasta Inversa Electronica', buyer_id: 'EC-RUC-1',
      award_amount: 400_000, published_date: a, award_date: b,
      description: 'Adquisicion de bienes para la entidad contratante del Estado',
      suppliers: [{ id: 'EC-RUC-9', name: 'P' }] } as any);
    const it02 = f.find(x => x.code === 'IT-02');
    return it02 ? it02.detail : '(sin IT-02)';
  });
  assert.equal(new Set(resultados).size, 1,
    `las cinco formas de escribir el mismo intervalo dieron respuestas distintas: ${JSON.stringify(resultados)}`);
  assert.match(String(resultados[0]), /2 días hábiles/,
    'lunes 17 a martes 18, con ambos extremos incluidos, son 2 días hábiles');
});

test('los días hábiles saltan el fin de semana y no cuentan de más', () => {
  const dias = (a: string, b: string) => {
    const f = evaluateIndividualFlags({ id: 'x', procurement_method: 'open',
      procurement_method_details: 'Subasta Inversa Electronica', buyer_id: 'EC-RUC-1',
      award_amount: 400_000, published_date: a, award_date: b,
      description: 'Adquisicion de bienes para la entidad contratante del Estado',
      suppliers: [{ id: 'EC-RUC-9', name: 'P' }] } as any);
    const it02 = f.find(x => x.code === 'IT-02');
    return it02 ? Number(String(it02.detail).match(/en (\d+) días/)![1]) : null;
  };
  // 2024-06-14 es viernes y 2024-06-17 es lunes: son 2 hábiles, no 4.
  assert.equal(dias('2024-06-14', '2024-06-17'), 2);
  // mismo día laborable: 1, como declara la metodología publicada
  assert.equal(dias('2024-06-17', '2024-06-17'), 1);
  // lunes a miércoles son 3 hábiles, así que IT-02 (< 3) ya NO dispara
  assert.equal(dias('2024-06-17', '2024-06-19'), null);
});

// ── Pares correlacionados, replanteados con datos el 11-ago-2026 ──
// Medido sobre los 1.470.321 procesos de producción: IC-01 + IC-02 co-ocurre CERO veces en los
// ocho años, y no puede co-ocurrir, porque IC-01 exige método competitivo e IC-02 exige
// procurement_method === 'direct'. Publicar ese descuento era prometer algo que nunca pasaba.
// IC-02 + TR-03, en cambio, co-ocurre en 42.321 de los 44.064 disparos de IC-02 (96,0%) y no
// tenía descuento: 30 + 18 = 48 de los 100 puntos posibles por una sola observación.
test('IC-01 e IC-02 ya NO se descuentan entre sí: no pueden co-ocurrir', () => {
  const ic01 = { ...FLAG_CATALOG['IC-01'], active: true };   // 18
  const ic02 = { ...FLAG_CATALOG['IC-02'], active: true };   // 30
  assert.equal(calculateScore([ic01, ic02] as any), 48,
    'si vuelve a dar 33, alguien reintrodujo un par que en estos datos no existe');
});

test('IC-02 y TR-03 SÍ se descuentan: es el par que de verdad se solapa', () => {
  const ic02 = { ...FLAG_CATALOG['IC-02'], active: true };   // 30
  const tr03 = { ...FLAG_CATALOG['TR-03'], active: true };   // 18 -> 9
  assert.equal(calculateScore([ic02, tr03] as any), 39,
    'sin el descuento darían 48: el 96% de los IC-02 cobraría dos veces el mismo hecho');
});

test('un proceso directo sobre el umbral no puede pasar de 39 puntos por ese solo hecho', () => {
  // El caso real más frecuente de la base: contratación directa de régimen especial por encima
  // del umbral de ínfima. Dispara IC-02 y TR-03 a la vez y no debe sumar 48.
  const proc = { id: 'x', procurement_method: 'direct',
    procurement_method_details: 'Régimen Especial', buyer_id: 'EC-RUC-1',
    award_amount: 50_000, published_date: '2024-06-15T12:00:00-05:00',
    description: 'Contratacion directa de servicios especializados de consultoria',
    suppliers: [{ id: 'EC-RUC-9', name: 'PROVEEDOR' }] };
  const banderas = evaluateIndividualFlags(proc as any);
  const cods = codigos(banderas);
  assert.ok(cods.includes('IC-02') && cods.includes('TR-03'), 'el caso debe disparar las dos');
  assert.equal(calculateScore(banderas), 39);
});

test('retirar una cita del catálogo la borra también de las banderas ya guardadas', () => {
  // Sin esto, quitar una cita no surtía efecto hasta el próximo recálculo: el spread conservaba
  // el ocp_ref viejo de la fila porque la clave no existía en el objeto del catálogo.
  const guardada = [{ code: 'TR-01', active: true, detail: 'Faltan: proveedor', ocp_ref: 'R001' }];
  const [h] = hidratarBanderas(guardada);
  assert.equal(h.ocp_ref, undefined, 'la ficha seguiría publicando una cita ya retirada');
  assert.equal(h.detail, 'Faltan: proveedor', 'el detalle del proceso tiene que sobrevivir');
});
