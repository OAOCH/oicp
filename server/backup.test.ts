/**
 * El respaldo tiene que producir una copia COMPLETA y legible, no una que lo parezca.
 *
 * Por qué existe: el respaldo era el único que hay y nunca se había verificado. Tenía dos
 * formas de salir incompleto sin avisar:
 *   1. El `wal_checkpoint(TRUNCATE)` iba en un try/catch que descartaba el error, así que
 *      si otra conexión tenía la base tomada el checkpoint fallaba en silencio.
 *   2. Se leía el archivo .db VIVO con createReadStream, así que lo que seguía en el WAL
 *      no entraba en la copia.
 * Estas pruebas fijan el invariante y, sobre todo, demuestran que el método viejo perdía
 * datos: si alguien vuelve a "simplificar" el respaldo a una copia del archivo, falla aquí.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import DatabaseCtor from 'better-sqlite3';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'oicp-respaldo-'));

function baseConWalSucio(nombre: string, filas: number) {
  const ruta = path.join(TMP, nombre);
  const db = new DatabaseCtor(ruta);
  db.pragma('journal_mode = WAL');
  // Sin auto-checkpoint: las escrituras se quedan en el -wal y no llegan al .db, que es
  // exactamente el estado en el que el respaldo viejo perdia datos.
  db.pragma('wal_autocheckpoint = 0');
  db.exec(`CREATE TABLE procedures (id TEXT PRIMARY KEY, score INTEGER, buyer_id TEXT)`);
  const ins = db.prepare(`INSERT INTO procedures (id, score, buyer_id) VALUES (?,?,?)`);
  const tx = db.transaction(() => {
    for (let i = 0; i < filas; i++) ins.run(`p${i}`, i % 100, `b${i % 7}`);
  });
  tx();
  return { db, ruta };
}

test('VACUUM INTO copia TODO, incluido lo que sigue en el WAL', () => {
  const { db, ruta } = baseConWalSucio('completo.db', 2000);
  const vivas = (db.prepare(`SELECT COUNT(*) AS n FROM procedures`).get() as any).n;
  assert.equal(vivas, 2000);

  // Prueba de que el WAL de verdad esta sucio: el .db en disco todavia no las tiene.
  assert.ok(fs.existsSync(ruta + '-wal'), 'debe haber WAL');
  assert.ok(fs.statSync(ruta + '-wal').size > 0, 'el WAL debe tener contenido sin consolidar');

  const snap = path.join(TMP, 'snapshot.db');
  db.prepare(`VACUUM INTO ?`).run(snap);

  const leido = new DatabaseCtor(snap, { readonly: true });
  assert.equal((leido.prepare(`SELECT COUNT(*) AS n FROM procedures`).get() as any).n, 2000,
    'el snapshot debe traer las 2000 filas, incluidas las que vivian solo en el WAL');
  assert.equal((leido.prepare(`SELECT integrity_check FROM pragma_integrity_check`).get() as any).integrity_check, 'ok',
    'el snapshot debe pasar integrity_check');
  leido.close(); db.close();
});

test('db.backup() (lo que usa el endpoint) tambien captura el WAL y no bloquea', async () => {
  const { db } = baseConWalSucio('incremental.db', 2000);
  const snap = path.join(TMP, 'snapshot-incremental.db');
  // El endpoint usa db.backup() y NO VACUUM INTO: los dos dan la misma consistencia, pero
  // VACUUM INTO es sincrono y sobre 1,3 GB bloquearia el unico hilo de Node medio minuto.
  // db.backup() copia por lotes y devuelve el control al event loop entre lotes.
  let cedioElControl = false;
  setImmediate(() => { cedioElControl = true; });
  await db.backup(snap);
  assert.equal(cedioElControl, true, 'db.backup() debe ceder el control: si no, bloquea la plataforma');

  const leido = new DatabaseCtor(snap, { readonly: true });
  assert.equal((leido.prepare(`SELECT COUNT(*) AS n FROM procedures`).get() as any).n, 2000);
  assert.equal((leido.prepare(`SELECT integrity_check FROM pragma_integrity_check`).get() as any).integrity_check, 'ok');
  leido.close(); db.close();
});

test('copiar el archivo .db vivo PIERDE datos: es el defecto que se corrigio', () => {
  const { db, ruta } = baseConWalSucio('vivo.db', 2000);
  const copia = path.join(TMP, 'copia-cruda.db');
  // Exactamente lo que hacia el respaldo viejo: leer el .db sin consolidar el WAL.
  fs.copyFileSync(ruta, copia);

  const leido = new DatabaseCtor(copia, { readonly: true });
  let filasEnLaCopia = 0;
  try { filasEnLaCopia = (leido.prepare(`SELECT COUNT(*) AS n FROM procedures`).get() as any).n; }
  catch { filasEnLaCopia = -1; }   // la copia puede no ser ni legible
  leido.close(); db.close();

  assert.notEqual(filasEnLaCopia, 2000,
    'si esta copia trajera las 2000 filas, el escenario de la prueba ya no reproduce el defecto');
});

test('el snapshot verificado detecta una base sin datos antes de entregarla', () => {
  const ruta = path.join(TMP, 'vacia.db');
  const db = new DatabaseCtor(ruta);
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE procedures (id TEXT PRIMARY KEY)`);
  const snap = path.join(TMP, 'snapshot-vacio.db');
  db.prepare(`VACUUM INTO ?`).run(snap);

  // Misma comprobacion que hace el endpoint antes de enviar: adjuntar y contar.
  db.prepare(`ATTACH DATABASE ? AS snap`).run(snap);
  const n = (db.prepare(`SELECT COUNT(*) AS n FROM snap.procedures`).get() as any).n;
  db.prepare(`DETACH DATABASE snap`).run();
  db.close();

  assert.equal(n, 0, 'la verificacion tiene que poder ver que el snapshot no trae procesos');
});

test('VACUUM INTO falla si el destino ya existe (no sobreescribe en silencio)', () => {
  const { db } = baseConWalSucio('destino.db', 10);
  const snap = path.join(TMP, 'ocupado.db');
  fs.writeFileSync(snap, 'contenido previo');
  // Lanza en los dos casos, con codigos distintos segun lo que haya en el destino:
  // SQLITE_NOTADB si el archivo no es una base, y "output file already exists" si si lo
  // es. Lo que importa es que NUNCA mezcla contenido en silencio. Por eso el endpoint
  // borra el temporal antes de pedir el snapshot.
  assert.throws(() => db.prepare(`VACUUM INTO ?`).run(snap), (e: any) => {
    assert.match(String(e.code || e.message), /SQLITE_NOTADB|SQLITE_ERROR|exists/i);
    return true;
  });
  db.close();
});

test('limpieza', () => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* Windows puede retener handles */ }
});
