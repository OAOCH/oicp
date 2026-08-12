/**
 * Lectura de la ficha pública de un proceso en el SOCE (portal del SERCOP).
 *
 *   https://www.compraspublicas.gob.ec/ProcesoContratacion/compras/PC/ImprimirIPC2.cpe?id=<idSoliCompra>
 *
 * POR QUÉ EXISTE. El Art. 96 del Reglamento fija el término mínimo para entregar ofertas
 * «contados a partir de fenecer la fecha límite para contestar respuestas y aclaraciones». Esa
 * fecha **no está en los datos abiertos**: la API publica `tender.enquiryPeriod.endDate`, que es la
 * fecha límite para PREGUNTAR, no para responder. Y el otro extremo del término,
 * `tender.tenderPeriod.endDate`, viene vacío en el 93% de los procesos. Sin las dos, el indicador
 * IT-01 no puede reproducir el término legal y solo alcanza a evaluar el 7,2% del corpus.
 *
 * Esta ficha sí trae las dos, en un solo GET, sin sesión y sin captcha.
 *
 * EL ENGANCHE ES EL PROBLEMA, no la lectura. El ocid NO contiene el id interno del proceso: el
 * número final del ocid es el de la ENTIDAD (en `ocds-5wno2w-SIE-IGM-2025-031-36136`, el 36136
 * aparece también en `buyer.id = "EC-RUC-1768007200001-36136"`). Por eso el índice se construye al
 * revés: se recorren los id del portal, se lee el CÓDIGO de cada ficha, y ese código es el que
 * casa con nuestro ocid.
 *
 * LA VALIDACIÓN DEL CRUCE NO ES OPCIONAL. Dos entidades podrían usar códigos parecidos, y un
 * cruce equivocado publicaría fechas de otro proceso en una ficha con nombre y apellido. Por eso
 * `fechaLimitePreguntas` se compara contra el `enquiry_deadline` que ya tenemos de los datos
 * abiertos: si no coinciden, el cruce se descarta. Es un dato que las dos fuentes publican por
 * separado, así que sirve de testigo.
 */

const ENTIDADES: Record<string, string> = {
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ',
  uuml: 'ü', Uuml: 'Ü', nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>',
  laquo: '«', raquo: '»', deg: '°', ordm: 'º', ordf: 'ª',
};

export function decodificar(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([A-Za-z]+);/g, (m, n) => ENTIDADES[n] ?? m);
}

/** Aplana el HTML a `texto|texto|texto`, que es como esta ficha expone sus pares etiqueta-valor. */
export function aplanar(html: string): string {
  return decodificar(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, '|'),
  ).replace(/\|(\s*\|)+/g, '|').replace(/[ \t\r\n]+/g, ' ').trim();
}

export type FichaSOCE = {
  idSoliCompra: number;
  codigo: string | null;
  entidad: string | null;
  tipoContratacion: string | null;
  presupuesto: number | null;
  fechaPublicacion: string | null;
  fechaLimitePreguntas: string | null;
  /** Hito del Art. 96: desde aquí corre el término para entregar ofertas. */
  fechaLimiteRespuestas: string | null;
  /** Fin del término del Art. 96. */
  fechaLimiteOfertas: string | null;
  /** De qué rótulo salió el hito, para poder declararlo en la metodología. */
  origenHito: 'respuestas' | 'audiencia' | null;
};

const FECHA = /^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}:\d{2})?$/;

/** Valor que sigue a una etiqueta en el texto aplanado. */
function valorTras(plano: string, etiquetas: string[]): string | null {
  for (const et of etiquetas) {
    const i = plano.indexOf(et);
    if (i < 0) continue;
    const resto = plano.slice(i + et.length);
    const partes = resto.split('|').map(s => s.trim()).filter(s => s.length > 0);
    if (partes.length) return partes[0];
  }
  return null;
}

function fechaTras(plano: string, etiquetas: string[]): string | null {
  const v = valorTras(plano, etiquetas);
  return v && FECHA.test(v) ? v : null;
}

export function parsearFicha(html: string, idSoliCompra: number): FichaSOCE | null {
  const plano = aplanar(html);
  // Una ficha inexistente responde 200 con la plantilla vacía: sin código no hay proceso.
  const codigoCrudo = valorTras(plano, ['Código:', 'Codigo:']);
  if (!codigoCrudo) return null;
  // El SOCE añade a veces un desambiguador interno `-Z<idSoliCompra>` que nuestro ocid no lleva.
  const codigo = codigoCrudo.replace(/-Z\d+$/i, '').trim() || null;

  const presuText = valorTras(plano, ['Presupuesto Referencial Total (Sin Iva):', 'Presupuesto Referencial:']);
  const presu = presuText ? Number(String(presuText).replace(/[^\d.,]/g, '').replace(/,/g, '')) : NaN;

  const respuestas = fechaTras(plano, ['Fecha Límite de Respuestas']);
  // Régimen Especial no rotula «respuestas»: usa la audiencia de preguntas y aclaraciones.
  // Decisión de Oscar (12-ago-2026): esa audiencia SÍ cuenta como el hito del Art. 96, y así
  // se declara en la metodología publicada.
  const audiencia = fechaTras(plano, [
    'Fecha límite de Audiencia de Preguntas y Aclaraciones',
    'Fecha Límite de Audiencia de Preguntas y Aclaraciones',
  ]);

  return {
    idSoliCompra,
    codigo,
    entidad: valorTras(plano, ['Entidad:']),
    tipoContratacion: valorTras(plano, ['Tipo de Contratación:', 'Tipo de Contratacion:']),
    presupuesto: Number.isFinite(presu) && presu > 0 ? presu : null,
    fechaPublicacion: fechaTras(plano, ['Fecha de Publicación']),
    fechaLimitePreguntas: fechaTras(plano, ['Fecha Límite de Preguntas']),
    fechaLimiteRespuestas: respuestas ?? audiencia,
    // Cada tipo de procedimiento rotula distinto el cierre de ofertas.
    fechaLimiteOfertas: fechaTras(plano, [
      'Fecha Límite entrega Ofertas',
      'Fecha Límite de Propuestas',
      'Fecha Límite de Entrega de Propuestas',
      'Fecha Límite de Ofertas',
    ]),
    origenHito: respuestas ? 'respuestas' : (audiencia ? 'audiencia' : null),
  };
}

/**
 * El código que le corresponde a un ocid nuestro.
 * `ocds-5wno2w-SIE-IGM-2025-031-36136` -> `SIE-IGM-2025-031` (el sufijo es el id de la ENTIDAD).
 */
export function codigoDeOcid(ocid: string): string | null {
  const s = String(ocid || '');
  const sinPrefijo = s.replace(/^ocds-5wno2w-/i, '');
  if (sinPrefijo === s && !s.startsWith('ocds-')) return null;
  const codigo = sinPrefijo.replace(/-\d+$/, '').trim();
  return codigo || null;
}

/**
 * ¿Se puede confiar en el cruce? Solo si la fecha límite de preguntas que publica el portal
 * coincide con la que publican los datos abiertos. Se comparan a nivel de MINUTO: las dos fuentes
 * escriben la misma hora local de Ecuador, una con offset explícito y la otra sin él.
 */
export function cruceConfiable(fichaPreguntas: string | null, enquiryDeadlineOcds: string | null): boolean {
  if (!fichaPreguntas || !enquiryDeadlineOcds) return false;
  const a = fichaPreguntas.replace(' ', 'T').slice(0, 16);
  const b = String(enquiryDeadlineOcds).slice(0, 16);
  return a === b;
}

export function urlFicha(idSoliCompra: number): string {
  return `https://www.compraspublicas.gob.ec/ProcesoContratacion/compras/PC/ImprimirIPC2.cpe?id=${idSoliCompra}`;
}
