/**
 * OICP Auth routes — /api/auth/* y gestion de whitelist /api/auth/users
 *
 * Flujo magic link:
 *   POST /api/auth/login      { email }  -> 200 {sent} si esta en whitelist; 403 si no; 429 si rate limit
 *   GET  /api/auth/callback?token=...    -> set-cookie de sesion + redirect a / ; 401 si invalido
 *   POST /api/auth/logout                -> borra cookie
 *   GET  /api/auth/me                    -> { email, role, authEnabled } ; 200 siempre (user null si no hay sesion)
 *
 * Gestion de usuarios (solo superadmin):
 *   GET    /api/auth/users
 *   POST   /api/auth/users        { email, role }
 *   PATCH  /api/auth/users/:email { role }
 *   DELETE /api/auth/users/:email
 */
import { Router } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { getDb } from '../db.js';
import {
  authEnabled, ensureAuthTables, isAllowed, createMagicToken, consumeMagicToken,
  sendMagicLinkEmail, issueSession, setSessionCookie, clearSessionCookie, sessionFromRequest,
  requireSuperadmin, listUsers, addUser, setRole, removeUser, normalizeEmail, isValidEmail,
  type AuthedRequest,
} from '../auth.js';

const router = Router();
router.use(express.json({ limit: '64kb' }));

// Rate limit del login: 5 intentos por IP cada 15 minutos.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera 15 minutos.', code: 'RATE_LIMITED' },
});

// ── POST /login ─────────────────────────────────────────────
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email || '');
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Ingresa un email valido.' });

    if (!authEnabled()) {
      return res.status(503).json({ error: 'El acceso por email aun no esta habilitado en el servidor.', code: 'AUTH_DISABLED' });
    }

    const db = getDb();
    const allowed = isAllowed(db, email);
    if (!allowed) {
      // Respuesta neutra: no revela si el email existe o no, pero el brief pide mensaje claro de no-habilitado.
      return res.status(403).json({ error: 'Tu acceso aun no esta habilitado. Pide al administrador que te agregue.', code: 'NOT_WHITELISTED' });
    }

    const { url } = createMagicToken(db, email);
    const result = await sendMagicLinkEmail(email, url);
    return res.json({
      sent: true,
      delivered: result.delivered,
      // En modo bootstrap (sin Resend) NO exponemos el link al cliente por seguridad; queda solo en los logs del server.
      message: result.delivered
        ? 'Te enviamos un enlace de acceso a tu correo. Revisa tu bandeja (valido 15 minutos).'
        : 'Enlace generado. El administrador del servidor debe revisar los logs para obtenerlo (modo bootstrap sin email).',
    });
  } catch (e: any) {
    return res.status(500).json({ error: 'Error procesando el acceso.' });
  }
});

// ── GET /callback ───────────────────────────────────────────
router.get('/callback', (req, res) => {
  try {
    if (!authEnabled()) return res.redirect('/login?e=disabled');
    const token = (req.query.token as string) || '';
    const db = getDb();
    const email = consumeMagicToken(db, token);
    if (!email) return res.redirect('/login?e=invalid');
    const user = isAllowed(db, email);
    if (!user) return res.redirect('/login?e=revoked');
    const session = issueSession(user.email, user.role);
    setSessionCookie(res, session);
    return res.redirect('/');
  } catch (e: any) {
    return res.redirect('/login?e=error');
  }
});

// ── POST /logout ────────────────────────────────────────────
router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ── GET /me ─────────────────────────────────────────────────
router.get('/me', (req, res) => {
  const sess = sessionFromRequest(req);
  res.json({ user: sess, authEnabled: authEnabled() });
});

// ── Gestion de whitelist (solo superadmin) ──────────────────
router.get('/users', requireSuperadmin, (req, res) => {
  res.json({ users: listUsers(getDb()) });
});

router.post('/users', requireSuperadmin, (req: AuthedRequest, res) => {
  try {
    const email = normalizeEmail(req.body?.email || '');
    const role = req.body?.role === 'superadmin' ? 'superadmin' : 'viewer';
    if (!isValidEmail(email)) return res.status(400).json({ error: 'email invalido' });
    const invitedBy = req.user?.email || 'admin-key';
    const user = addUser(getDb(), email, role, invitedBy);
    res.json({ user });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.patch('/users/:email', requireSuperadmin, (req, res) => {
  const email = normalizeEmail(decodeURIComponent(String(req.params.email)));
  const role = req.body?.role === 'superadmin' ? 'superadmin' : 'viewer';
  setRole(getDb(), email, role);
  res.json({ ok: true });
});

router.delete('/users/:email', requireSuperadmin, (req: AuthedRequest, res) => {
  const email = normalizeEmail(decodeURIComponent(String(req.params.email)));
  // Evita que el superadmin se borre a si mismo y se quede fuera.
  if (req.user && req.user.email === email) {
    return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta de superadmin.' });
  }
  removeUser(getDb(), email);
  res.json({ ok: true });
});

export default router;
export { ensureAuthTables };
