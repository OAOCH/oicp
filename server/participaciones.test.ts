/**
 * Oferentes y pujas de un proceso (participacionesDeRelease).
 *
 * Por qué existe: hasta el 2-sep-2026 la base guardaba solo al ADJUDICATARIO y el número
 * de oferentes. La pregunta «¿qué empresas participan muchas veces y nunca ganan, y frente
 * a quién pierden?» (oferentes de acompañamiento que simulan competencia) no tenía ruta.
 * Los datos SÍ están en la fuente, en tres sitios distintos del release OCDS del SERCOP,
 * comprobado sobre registros reales que viven en server/fixtures/:
 *   - tender.tenderers[]            → todos los que ofertaron, con id (EC-RUC-…-unidad) y nombre
 *   - parties[].roles               → 'tenderer' a secas el que perdió; 'tenderer'+'supplier' el que ganó
 *   - auctions[].stages[].bids[]    → cada puja de la subasta inversa: oferente, monto y hora
 * y release.bids (el sitio estándar) viene SIEMPRE vacío, que es lo que engañaba.
 *
 * Reglas que fijan estas pruebas:
 *   - Una fila por (proceso, oferente). Un oferente que puja varias veces es UNA fila con
 *     n_pujas, su puja mínima y la hora de su última puja.
 *   - gano = 1 solo para quien está en awards[].suppliers (o tiene rol supplier).
 *   - Un proceso sin oferentes publicados (régimen especial, directa) no genera filas:
 *     la tabla mide COMPETENCIA, no adjudicaciones.
 *   - ruc10 = los diez primeros dígitos del id, igual que en los agregados de proveedores.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { participacionesDeRelease, releaseFrom, releaseToProc } from './ocds-proc.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
function fixture(ocid: string, year: number) {
  const rec = JSON.parse(fs.readFileSync(path.join(DIR, `${ocid}.json`), 'utf-8'));
  const release = releaseFrom(rec);
  assert.ok(release, `el fixture ${ocid} debe traer un release`);
  const proc = releaseToProc(release, null, year);
  return { release, proc };
}

test('subasta inversa real: dos oferentes, el ganador es el de la puja mínima y el perdedor queda con gano=0', () => {
  const { release, proc } = fixture('ocds-5wno2w-SIE-HOALO-2025-003-141697', 2025);
  const filas = participacionesDeRelease(release, proc);
  assert.equal(filas.length, 2, 'una fila por oferente');
  const gan = filas.find(f => f.gano === 1)!;
  const per = filas.find(f => f.gano === 0)!;
  assert.ok(gan && per, 'debe haber exactamente un ganador y un perdedor');
  assert.equal(gan.nombre, 'MAXINSUMO S.A.');
  assert.equal(gan.ruc10, '0993038210');
  assert.equal(per.nombre, 'FRANORIA S.A.');
  assert.equal(per.ruc10, '0993049522');
  // MAXINSUMO pujó 128.600 y luego 125.900: su puja mínima es la ganadora.
  assert.equal(gan.puja_min, 125900);
  assert.ok(gan.n_pujas >= 2, `MAXINSUMO pujó al menos dos veces; n_pujas=${gan.n_pujas}`);
  assert.equal(per.puja_min, 127000);
  assert.match(String(gan.puja_ultima), /^2025-03-13T10:1/);
  for (const f of filas) {
    assert.equal(f.ocid, 'ocds-5wno2w-SIE-HOALO-2025-003-141697');
    assert.equal(f.buyer_id, proc.buyer_id);
    assert.equal(f.source_year, 2025);
  }
});

test('licitación real sin subasta: un solo oferente, ganador, sin pujas', () => {
  const { release, proc } = fixture('ocds-5wno2w-LICSG-HGJD-2025-001-15643', 2025);
  const filas = participacionesDeRelease(release, proc);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].gano, 1);
  assert.equal(filas[0].ruc10, '0190123626');
  assert.equal(filas[0].n_pujas, 0);
  assert.equal(filas[0].puja_min, null);
});

test('régimen especial real sin oferentes publicados: no genera filas (mide competencia, no adjudicaciones)', () => {
  const { release, proc } = fixture('ocds-5wno2w-RE-CSCD-MDMQ-2026-3703-41357', 2026);
  assert.deepEqual(participacionesDeRelease(release, proc), []);
});

test('un oferente que solo aparece en parties con rol tenderer también cuenta, y no se duplica si está en ambos sitios', () => {
  const release = {
    ocid: 'ocds-x-1',
    tender: { tenderers: [{ id: 'EC-RUC-1790000000001-10', name: 'A S.A.' }] },
    parties: [
      { id: 'EC-RUC-1790000000001-10', name: 'A S.A.', roles: ['tenderer', 'supplier'] },
      { id: 'EC-RUC-0990000000001-11', name: 'B S.A.', roles: ['tenderer'] },
      { id: 'EC-RUC-1760000000001-99', name: 'ENTIDAD', roles: ['buyer', 'procuringEntity'] },
    ],
    awards: [{ suppliers: [{ id: 'EC-RUC-1790000000001-10', name: 'A S.A.' }] }],
  };
  const filas = participacionesDeRelease(release, { ocid: 'ocds-x-1', buyer_id: 'EC-RUC-1760000000001-99', source_year: 2024 });
  assert.equal(filas.length, 2, 'A una sola vez, B una vez, la entidad compradora nunca');
  const a = filas.find(f => f.nombre === 'A S.A.')!;
  const b = filas.find(f => f.nombre === 'B S.A.')!;
  assert.equal(a.gano, 1);
  assert.equal(a.ruc10, '1790000000');
  assert.equal(b.gano, 0);
  assert.equal(b.ruc10, '0990000000');
});

test('un id sin diez dígitos (pasaporte o extranjero) conserva el id y deja ruc10 en null', () => {
  const release = {
    ocid: 'ocds-x-2',
    tender: { tenderers: [{ id: 'EC-PAS-AB12345', name: 'EXTRANJERO' }] },
    parties: [{ id: 'EC-PAS-AB12345', name: 'EXTRANJERO', roles: ['tenderer'] }],
    awards: [],
  };
  const [f] = participacionesDeRelease(release, { ocid: 'ocds-x-2', buyer_id: 'EC-RUC-1760000000001-99', source_year: 2023 });
  assert.equal(f.oferente_id, 'EC-PAS-AB12345');
  assert.equal(f.ruc10, null);
  assert.equal(f.gano, 0);
});
