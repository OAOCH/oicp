/**
 * OICP Auth — Magic link por email + whitelist + sesion con cookie firmada.
 *
 * Diseno de rollout SEGURO:
 *  - El server SIEMPRE arranca, aunque falten env vars. Nunca hace throw al boot.
 *  - La autenticacion solo se ACTIVA si existe JWT_SECRET. Sin el, la plataforma
 *    se comporta como hoy (abierta), permitiendo desplegar el codigo primero y
 *    activar la auth despues seteando las variables en Railway. Asi un deploy
 *    nunca deja la plataforma inaccesible ni rompe el healthcheck.
 *  - /api/health y las rutas /api/auth/* quedan SIEMPRE publicas.
 *
 * Sin dependencias nuevas para tokens: la sesion es un token firmado con
 * HMAC-SHA256 (equivalente a un JWS HS256) usando el modulo crypto nativo.
 */
import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import type { Database } from 'better-sqlite3';

// ── Configuracion (leida de forma perezosa para no fijar valores al importar) ──
const SUPERADMIN_EMAIL = (process.env.SUPERADMIN_EMAIL || 'oscar.obandoch@gmail.com').toLowerCase().trim();
const TOKEN_TTL_MIN = 15;                       // validez del magic link
const SESSION_TTL_DAYS = Number(process.env.SESSION_LIFETIME_DAYS) || 14;
const COOKIE_NAME = 'oicp_session';

export function getJwtSecret(): string | null {
  const s = process.env.JWT_SECRET;
  return s && s.length >= 16 ? s : null;
}

/** La auth solo se aplica si hay un JWT_SECRET valido configurado. */
export function authEnabled(): boolean {
  return getJwtSecret() !== null;
}

function appUrl(): string {
  return (process.env.APP_URL || 'https://oicp-production.up.railway.app').replace(/\/+$/, '');
}

// ── Esquema y seed ──────────────────────────────────────────
export function ensureAuthTables(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS allowed_users (
      email TEXT PRIMARY KEY,
      role TEXT NOT NULL DEFAULT 'viewer',          -- 'superadmin' | 'viewer'
      invited_by TEXT,
      invited_at TEXT DEFAULT (datetime('now')),
      last_login_at TEXT
    );
    CREATE TABLE IF NOT EXISTS magic_tokens (
      token_hash TEXT PRIMARY KEY,                  -- sha256 del token (nunca el token en claro)
      email TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_magic_email ON magic_tokens(email);
  `);
  // Seed del superadmin (idempotente). Si ya existe, le garantiza el rol.
  if (SUPERADMIN_EMAIL) {
    db.prepare(`INSERT INTO allowed_users (email, role, invited_by) VALUES (?, 'superadmin', 'system')
                ON CONFLICT(email) DO UPDATE SET role='superadmin'`).run(SUPERADMIN_EMAIL);
  }
}

// ── Whitelist (CRUD) ────────────────────────────────────────
export interface AllowedUser { email: string; role: string; invited_by?: string; invited_at?: string; last_login_at?: string; }

export function isAllowed(db: Database, email: string): AllowedUser | null {
  const e = normalizeEmail(email);
  return (db.prepare('SELECT * FROM allowed_users WHERE email = ?').get(e) as AllowedUser) || null;
}
export function listUsers(db: Database): AllowedUser[] {
  return db.prepare('SELECT email, role, invited_by, invited_at, last_login_at FROM allowed_users ORDER BY invited_at DESC').all() as AllowedUser[];
}
export function addUser(db: Database, email: string, role: string, invitedBy: string): AllowedUser {
  const e = normalizeEmail(email);
  if (!isValidEmail(e)) throw new Error('email invalido');
  const r = role === 'superadmin' ? 'superadmin' : 'viewer';
  db.prepare(`INSERT INTO allowed_users (email, role, invited_by) VALUES (?, ?, ?)
              ON CONFLICT(email) DO UPDATE SET role=excluded.role`).run(e, r, invitedBy);
  return isAllowed(db, e)!;
}
export function setRole(db: Database, email: string, role: string): void {
  const r = role === 'superadmin' ? 'superadmin' : 'viewer';
  db.prepare('UPDATE allowed_users SET role = ? WHERE email = ?').run(r, normalizeEmail(email));
}
export function removeUser(db: Database, email: string): void {
  db.prepare('DELETE FROM allowed_users WHERE email = ?').run(normalizeEmail(email));
}

// ── Magic tokens ────────────────────────────────────────────
function sha256(s: string): string { return crypto.createHash('sha256').update(s).digest('hex'); }

/** Crea un magic token de un solo uso para un email ya validado en la whitelist. */
export function createMagicToken(db: Database, email: string): { token: string; url: string } {
  const e = normalizeEmail(email);
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + TOKEN_TTL_MIN * 60_000).toISOString();
  // Invalida tokens previos no usados del mismo email (un link activo a la vez).
  db.prepare('DELETE FROM magic_tokens WHERE email = ? AND used_at IS NULL').run(e);
  db.prepare('INSERT INTO magic_tokens (token_hash, email, expires_at) VALUES (?, ?, ?)').run(sha256(token), e, expires);
  // El link lo procesa el backend (valida, emite cookie y redirige), sin pasar por React.
  const url = `${appUrl()}/api/auth/callback?token=${token}`;
  return { token, url };
}

/** Consume un magic token. Devuelve el email si es valido; null si no. */
export function consumeMagicToken(db: Database, token: string): string | null {
  if (!token) return null;
  const row = db.prepare('SELECT * FROM magic_tokens WHERE token_hash = ?').get(sha256(token)) as any;
  if (!row) return null;
  if (row.used_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  db.prepare('UPDATE magic_tokens SET used_at = datetime(\'now\') WHERE token_hash = ?').run(sha256(token));
  db.prepare('UPDATE allowed_users SET last_login_at = datetime(\'now\') WHERE email = ?').run(row.email);
  return row.email as string;
}

/** Limpia tokens expirados (llamar ocasionalmente). */
export function purgeExpiredTokens(db: Database) {
  db.prepare("DELETE FROM magic_tokens WHERE expires_at < datetime('now') OR used_at IS NOT NULL").run();
}

// ── Sesion (token firmado HMAC-SHA256, estilo JWS HS256) ─────
function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}
export function issueSession(email: string, role: string): string {
  const secret = getJwtSecret();
  if (!secret) throw new Error('JWT_SECRET no configurado');
  const payload = { sub: normalizeEmail(email), role, exp: Date.now() + SESSION_TTL_DAYS * 86_400_000 };
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}
export function verifySession(token: string | undefined): { email: string; role: string } | null {
  const secret = getJwtSecret();
  if (!secret || !token || token.indexOf('.') < 0) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  // Comparacion en tiempo constante para evitar timing attacks.
  const a = Buffer.from(sig); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return { email: payload.sub, role: payload.role };
  } catch { return null; }
}

// ── Cookies (parseo nativo, sin dependencia) ────────────────
export function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}
export function setSessionCookie(res: Response, token: string) {
  const maxAge = SESSION_TTL_DAYS * 86_400;
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: maxAge * 1000,
    path: '/',
  });
}
export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
}
export function sessionFromRequest(req: Request): { email: string; role: string } | null {
  return verifySession(readCookie(req, COOKIE_NAME));
}

// ── Middlewares ─────────────────────────────────────────────
export interface AuthedRequest extends Request { user?: { email: string; role: string }; }

/** Exige sesion valida. Si la auth no esta activada (sin JWT_SECRET), deja pasar (modo abierto / rollout). */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!authEnabled()) return next();
  const sess = sessionFromRequest(req);
  if (!sess) return res.status(401).json({ error: 'No autenticado', code: 'UNAUTHENTICATED' });
  req.user = sess;
  next();
}

/** Comparacion de strings en tiempo constante (evita timing attacks sobre la ADMIN_KEY). */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a); const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Exige rol superadmin. Acepta DOS vias:
 *  - ADMIN_KEY válida por query/header (para scripts internos como subir.mjs), o
 *  - sesión de cookie con rol superadmin (cuando la auth está activada).
 * Sin ADMIN_KEY configurada NO hay clave por defecto (se cerró el default débil).
 */
export function requireSuperadmin(req: AuthedRequest, res: Response, next: NextFunction) {
  const key = process.env.ADMIN_KEY;
  const provided = (req.query.key as string) || (req.headers['x-admin-key'] as string);
  if (key && provided && safeEqual(provided, key)) return next();

  if (authEnabled()) {
    const sess = sessionFromRequest(req);
    if (!sess) return res.status(401).json({ error: 'No autenticado', code: 'UNAUTHENTICATED' });
    if (sess.role !== 'superadmin') return res.status(403).json({ error: 'Requiere rol superadmin', code: 'FORBIDDEN' });
    req.user = sess;
    return next();
  }
  return res.status(403).json({ error: 'Requiere ADMIN_KEY o sesión de superadmin', code: 'FORBIDDEN' });
}

// ── Email transaccional (Resend via fetch; fallback a logs) ──
export async function sendMagicLinkEmail(email: string, url: string): Promise<{ delivered: boolean; via: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM || 'OICP <onboarding@resend.dev>';
  if (!apiKey) {
    // Modo bootstrap: sin proveedor de email, el link queda en los logs del server.
    console.log(`[auth] (sin RESEND_API_KEY) magic link para ${email}: ${url}`);
    return { delivered: false, via: 'log' };
  }
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [email],
        subject: 'Tu acceso a OICP',
        html: magicEmailHtml(url),
        text: `Ingresa a OICP con este enlace (valido ${TOKEN_TTL_MIN} minutos):\n${url}\n\nSi no solicitaste esto, ignora el mensaje.`,
      }),
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      console.error(`[auth] Resend fallo: HTTP ${resp.status} ${t.slice(0, 200)}`);
      console.log(`[auth] (fallback) magic link para ${email}: ${url}`);
      return { delivered: false, via: 'log' };
    }
    return { delivered: true, via: 'resend' };
  } catch (e: any) {
    console.error(`[auth] Resend error: ${e.message}`);
    console.log(`[auth] (fallback) magic link para ${email}: ${url}`);
    return { delivered: false, via: 'log' };
  }
}

function magicEmailHtml(url: string): string {
  return `<!DOCTYPE html><html lang="es"><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f9fafb;padding:32px">
  <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:32px">
    <h1 style="color:#005da1;font-size:20px;margin:0 0 8px">OICP</h1>
    <p style="color:#374151;font-size:14px;line-height:1.5">Observatorio de Integridad de Contratacion Publica del Ecuador.</p>
    <p style="color:#374151;font-size:14px;line-height:1.5">Haz clic para ingresar. El enlace es valido por ${TOKEN_TTL_MIN} minutos y solo puede usarse una vez.</p>
    <p style="margin:24px 0"><a href="${url}" style="background:#0074c7;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;display:inline-block">Ingresar a OICP</a></p>
    <p style="color:#9ca3af;font-size:12px;line-height:1.5;word-break:break-all">Si el boton no funciona, copia este enlace:<br>${url}</p>
    <p style="color:#9ca3af;font-size:12px;margin-top:16px">Si no solicitaste este acceso, ignora este correo.</p>
  </div></body></html>`;
}

// ── Utilidades ──────────────────────────────────────────────
export function normalizeEmail(email: string): string {
  return (email || '').toLowerCase().trim();
}
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
