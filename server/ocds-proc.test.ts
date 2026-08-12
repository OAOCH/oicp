/**
 * Pruebas del mapeo OCDS -> fila de `procedures`.
 *
 * Existen por un defecto concreto: el mapeo estaba duplicado en `updater.ts` y en
 * `local-sync.ts`, se corrigió solo en el primero, y el segundo (el ÚNICO que llega al
 * SERCOP, porque Railway tiene la IP bloqueada) siguió guardando el texto "USD" como
 * presupuesto durante toda una sesión sin que nada lo gritara.
 *
 * Las formas de release que se usan aquí NO son inventadas: se copiaron de la respuesta real
 * de https://datosabiertos.compraspublicas.gob.ec/PLATAFORMA/api/record consultada el
 * 2026-08-11 para esos ocid. En los tres, `tender.value` viene ausente.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { releaseToProc, releaseFrom } from './ocds-proc.js';

const AQUI = dirname(fileURLToPath(import.meta.url));

// Respuestas reales del SERCOP (2026-08-11), recortadas a los campos que el mapeo lee.
const REALES = [
  {
    ocid: 'ocds-5wno2w-SIE-CELECEP-2024-04422-238940',
    presupuesto: 536037.63,
    enquiry: '2024-12-31T20:00:00-05:00',
    tender: {
      lots: [{ value: { amount: 536037.63, currency: 'USD' } }],
      enquiryPeriod: { endDate: '2024-12-31T20:00:00-05:00', startDate: '2024-12-30T20:00:00-05:00', durationInDays: 1 },
      tenderPeriod: { startDate: '2024-12-30T20:00:00-05:00' },
    },
  },
  {
    ocid: 'ocds-5wno2w-SIE-GADMCG-2024-071-79685',
    presupuesto: 26057.94,
    enquiry: '2025-01-07T15:00:00-05:00',
    tender: {
      lots: [{ value: { amount: 26057.94, currency: 'USD' } }],
      enquiryPeriod: { endDate: '2025-01-07T15:00:00-05:00', startDate: '2024-12-31T15:00:00-05:00', durationInDays: 7 },
      tenderPeriod: { startDate: '2024-12-31T15:00:00-05:00' },
    },
  },
  {
    ocid: 'ocds-5wno2w-SIE-EMAPAACEP-2024-015-91326',
    presupuesto: 18033.59,
    enquiry: '2024-12-31T20:00:00-05:00',
    tender: {
      lots: [{ value: { amount: 18033.59, currency: 'USD' } }],
      enquiryPeriod: { endDate: '2024-12-31T20:00:00-05:00', startDate: '2024-12-30T20:00:00-05:00', durationInDays: 1 },
      tenderPeriod: { startDate: '2024-12-30T20:00:00-05:00' },
    },
  },
];

test('el presupuesto sale de los lotes cuando tender.value viene vacío, y NUNCA queda el texto "USD"', () => {
  for (const caso of REALES) {
    // `sr.budget = 'USD'` es exactamente lo que devuelve la búsqueda del SERCOP en estos
    // procesos, y es la cadena que acabó guardada como monto en 174.547 filas.
    const proc = releaseToProc({ ocid: caso.ocid, tender: caso.tender }, { budget: 'USD' }, 2024);
    assert.equal(proc.budget_amount, caso.presupuesto, `presupuesto de ${caso.ocid}`);
    assert.equal(typeof proc.budget_amount, 'number', `${caso.ocid}: el presupuesto tiene que ser un número`);
    assert.notEqual(proc.budget_amount as any, 'USD');
  }
});

test('enquiry_deadline se mapea desde tender.enquiryPeriod.endDate (Art. 96 del Reglamento)', () => {
  for (const caso of REALES) {
    const proc = releaseToProc({ ocid: caso.ocid, tender: caso.tender }, { budget: 'USD' }, 2024);
    assert.equal(proc.enquiry_deadline, caso.enquiry, `enquiry_deadline de ${caso.ocid}`);
  }
});

test('sin enquiryPeriod en la fuente, enquiry_deadline es null y no una cadena vacía', () => {
  const proc = releaseToProc({ ocid: 'x', tender: { lots: [{ value: { amount: 10 } }] } }, null, 2024);
  assert.equal(proc.enquiry_deadline, null);
  assert.equal(proc.budget_amount, 10);
});

test('un presupuesto que la fuente no publica queda en null, no en 0 ni en texto', () => {
  // Importa porque TR-01 marca "presupuesto faltante" y una cadena es truthy en JavaScript:
  // mientras estuvo el texto "USD", TR-01 dejó de marcar 174.547 procesos como faltantes.
  const proc = releaseToProc({ ocid: 'x', tender: {} }, { budget: 'USD' }, 2024);
  assert.equal(proc.budget_amount, null);
});

test('releaseFrom acepta los dos formatos de la API y devuelve el último release', () => {
  assert.equal(releaseFrom({ releases: [{ ocid: 'a' }, { ocid: 'b' }] })?.ocid, 'b');
  assert.equal(releaseFrom({ records: [{ releases: [{ ocid: 'c' }] }] })?.ocid, 'c');
  assert.equal(releaseFrom({}), null);
  assert.equal(releaseFrom(null), null);
});

test('regla 11: ningún otro archivo del servidor define su propio releaseToProc', () => {
  // Este es el guardián. El defecto no fue leer mal el presupuesto una vez: fue tener DOS
  // copias del mapeo y corregir solo una. Si alguien vuelve a copiarlo, esta prueba falla.
  const sospechosos = ['updater.ts', 'local-sync.ts', 'load-data.ts'];
  for (const archivo of sospechosos) {
    const src = readFileSync(resolve(AQUI, archivo), 'utf-8');
    assert.ok(
      !/function\s+releaseToProc\s*\(/.test(src),
      `${archivo} define su propio releaseToProc: tiene que importarlo de ocds-proc.ts (regla 11)`,
    );
  }
});

test('regla 11: local-sync usa el mapeo compartido y no lee tender.value a pelo', () => {
  const src = readFileSync(resolve(AQUI, 'local-sync.ts'), 'utf-8');
  assert.ok(/from '\.\/ocds-proc\.js'/.test(src), 'local-sync.ts tiene que importar de ocds-proc.js');
  assert.ok(
    !/budget_amount:\s*t\.value\?\.amount/.test(src),
    'local-sync.ts vuelve a leer el presupuesto de tender.value: ese es exactamente el defecto',
  );
});
