/**
 * Registro de actividad por usuario autenticado (audit log).
 *
 * Principios:
 *  - Best-effort SIEMPRE: si el insert falla por lo que sea, se descarta en
 *    silencio y la respuesta al usuario sale intacta. Jamás lanza.
 *  - Aditivo: tabla propia, sin tocar tablas ni rutas existentes.
 *  - Sin datos sensibles: nunca se guardan tokens ni parámetros key/token.
 *  - Retención 90 días (purga al arrancar).
 */
import type { Response, NextFunction } from 'express';
import { getDb } from './db.js';

export function ensureAccessLog() {
  try {
    const db = getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS access_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        method TEXT,
        path TEXT,
        query TEXT,
        ts TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_access_email_ts ON access_log(email, ts);
    `);
    db.prepare(`DELETE FROM access_log WHERE ts < datetime('now','-90 days')`).run();
    // Purga periódica (el proceso puede vivir semanas sin redeploy).
    const t = setInterval(() => {
      try { getDb().prepare(`DELETE FROM access_log WHERE ts < datetime('now','-90 days')`).run(); }
      catch { /* best-effort */ }
    }, 24 * 60 * 60 * 1000);
    t.unref?.();
  } catch (e: any) {
    console.error(`access-log: init falló (no fatal): ${e.message}`);
  }
}

function sanitizedQuery(q: any): string {
  try {
    if (!q || typeof q !== 'object') return '';
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(q)) {
      if (/token|key|secret/i.test(k)) continue;
      out[k] = String(v).slice(0, 120);
    }
    const s = JSON.stringify(out);
    return s === '{}' ? '' : s;
  } catch { return ''; }
}

/** Middleware: registra la petición si hay sesión (req.user). Nunca bloquea:
 *  el INSERT corre FUERA del camino de la respuesta (setImmediate). */
export function accessLogger(req: any, _res: Response, next: NextFunction) {
  try {
    const email = req.user?.email;
    if (email) {
      const method = req.method;
      const path = String(req.path).slice(0, 300);
      const query = sanitizedQuery(req.query).slice(0, 300);
      setImmediate(() => {
        try {
          getDb().prepare(`INSERT INTO access_log (email, method, path, query) VALUES (?,?,?,?)`)
            .run(email, method, path, query);
        } catch { /* best-effort */ }
      });
    }
  } catch { /* best-effort: jamás afectar la respuesta */ }
  next();
}

/** Actividad de un usuario: sesiones (cortes de 30 min), páginas top y eventos recientes. */
export function getActivity(email: string, days: number) {
  const db = getDb();
  const d = Math.max(1, Math.min(days || 30, 90));
  const rows = db.prepare(`
    SELECT method, path, query, ts FROM access_log
    WHERE email = ? AND ts >= datetime('now', ?)
    ORDER BY ts ASC`).all(email, `-${d} days`) as any[];

  const sesiones: { inicio: string; fin: string; minutos: number; eventos: number }[] = [];
  let cur: any = null;
  for (const r of rows) {
    const t = Date.parse(r.ts.replace(' ', 'T') + 'Z');
    if (!cur || t - cur._last > 30 * 60_000) {
      if (cur) sesiones.push({ inicio: cur.inicio, fin: cur.fin, minutos: cur.minutos, eventos: cur.eventos });
      cur = { inicio: r.ts, fin: r.ts, minutos: 0, eventos: 1, _first: t, _last: t };
    } else {
      cur._last = t;
      cur.fin = r.ts;
      cur.minutos = Math.round((t - cur._first) / 60_000);
      cur.eventos++;
    }
  }
  if (cur) sesiones.push({ inicio: cur.inicio, fin: cur.fin, minutos: cur.minutos, eventos: cur.eventos });
  sesiones.reverse();

  const top = db.prepare(`
    SELECT path, COUNT(*) AS n FROM access_log
    WHERE email = ? AND ts >= datetime('now', ?)
    GROUP BY path ORDER BY n DESC LIMIT 15`).all(email, `-${d} days`) as any[];

  const recientes = db.prepare(`
    SELECT method, path, query, ts FROM access_log
    WHERE email = ? AND ts >= datetime('now', ?)
    ORDER BY ts DESC LIMIT 200`).all(email, `-${d} days`) as any[];

  return { email, dias: d, total_eventos: rows.length, sesiones, paginas_top: top, eventos_recientes: recientes };
}
