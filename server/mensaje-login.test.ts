/**
 * Mensajes del POST /api/auth/login segun el resultado de sendMagicLinkEmail.
 *
 * Por que existe este archivo: delivered:false tiene DOS causas distintas
 * (via 'log' = modo bootstrap sin RESEND_API_KEY; via 'error' = Resend rechazo
 * el envio, p. ej. destinatario invalido) y ambas mostraban el mensaje de
 * bootstrap. Un administrador que invitaba un correo invalido leia "modo
 * bootstrap sin email" y creia que faltaba configurar el email, cuando en
 * realidad la direccion fue rechazada (verificado en produccion el 2026-08-12
 * con un correo @example.com).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// auth.ts importa db.ts, que abre la base AL IMPORTAR. En un checkout limpio
// data/ no existe y el import revienta, asi que se apunta a una base en memoria
// ANTES del import (dinamico a proposito: los import estaticos se izan).
process.env.DB_PATH = ':memory:';
const { mensajeEnvioMagicLink } = await import('./auth.js');

test('via resend (entregado): pide revisar la bandeja del correo', () => {
  const msg = mensajeEnvioMagicLink({ delivered: true, via: 'resend' });
  assert.match(msg, /enlace de acceso a tu correo/i);
});

test('via log (bootstrap sin RESEND_API_KEY): manda a los logs del server', () => {
  const msg = mensajeEnvioMagicLink({ delivered: false, via: 'log' });
  assert.match(msg, /logs/i);
  assert.match(msg, /bootstrap/i);
});

test('via error (Resend rechazo el envio): avisa que no se entrego y NO menciona bootstrap ni logs', () => {
  const msg = mensajeEnvioMagicLink({ delivered: false, via: 'error' });
  assert.match(msg, /no se pudo entregar/i);
  assert.doesNotMatch(msg, /bootstrap/i);
  assert.doesNotMatch(msg, /logs/i);
});
