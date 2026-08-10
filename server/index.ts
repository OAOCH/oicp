import express from 'express';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { migrate, getStatistics, searchProcedures, getProcedure, getBuyerProfile,
  getSupplierProfile, getRankings, getFilterOptions, getDb } from './db.js';
import adminRouter from './routes/admin.js';
import authRouter from './routes/auth.js';
import mcpRouter from './routes/mcp.js';
import { ensureAuthTables, requireAuth, authEnabled } from './auth.js';
import { getCachedStatistics } from './cache.js';
import { scheduleAutoUpdate, refreshDataCutoff, getDataCutoff } from './updater.js';
import { accessLogger, ensureAccessLog } from './access-log.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Red de seguridad: un rechazo no manejado (p.ej. en un job de fondo) se loguea
// en vez de tumbar el proceso completo que sirve la web y el MCP.
process.on('unhandledRejection', (reason: any) => {
  console.error(`[unhandledRejection] ${reason?.stack || reason}`);
});

const app = express();
const PORT = process.env.PORT || 3000;
const BOOT_TIME = new Date().toISOString();
const APP_URL = (process.env.APP_URL || 'https://oicp-production.up.railway.app').replace(/\/+$/, '');

// Detras de Railway (proxy) para que rate-limit y secure cookies lean la IP/HTTPS reales.
app.set('trust proxy', 1);
app.disable('x-powered-by');

// ── Seguridad: headers (helmet) ──────────────────────────────
// CSP permite inline en script/style porque la pagina /api/admin sirve HTML con
// <script>/<style> inline. La SPA de Vite usa bundles propios (self). frameAncestors
// 'none' previene clickjacking.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// ── CORS restringido a los origenes propios (con credenciales para la cookie) ──
const allowedOrigins = [APP_URL, 'http://localhost:5173', 'http://localhost:3000'];
app.use(cors({
  origin(origin, cb) {
    // Permite same-origin / herramientas sin Origin (curl, healthcheck) y los origenes propios.
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
}));

app.use(compression());

// ── Logging que enmascara ?key=... y tokens en las URLs ──────
morgan.token('maskedurl', (req: any) =>
  (req.originalUrl || req.url || '')
    // Secretos en la query (?key=..., ?token=...)
    .replace(/([?&])(key|token)=[^&]*/gi, '$1$2=***')
    // Secreto en la RUTA del conector MCP (/mcp/<token>): sin esto el token
    // quedaba en texto plano en los logs de la plataforma en cada petición.
    .replace(/\/mcp\/[^/?#\s]+/gi, '/mcp/***'));
app.use(morgan(':method :maskedurl :status :res[content-length] - :response-time ms'));

app.use(express.json({ limit: '50mb' }));

// Initialize DB + tablas de auth + seed superadmin
migrate();
ensureAuthTables(getDb());
ensureAccessLog();

// ── Health check (SIEMPRE publico, sin auth, sin rate limit, no toca BD) ──
app.get('/api/health', (req, res) => {
  // Comprobación REAL: una consulta trivial a la base. Antes devolvía siempre "ok"
  // aunque la base estuviera corrupta o ausente, y el monitor no se enteraba.
  try {
    getDb().prepare('SELECT 1').get();
    res.json({ status: 'ok' });
  } catch (e: any) {
    res.status(503).json({ status: 'error', detail: 'base de datos no disponible' });
  }
});

// ── Version (publico, util para verificar el deploy) ─────────
app.get('/api/version', (req, res) => {
  const { cutoff, processes } = getDataCutoff();
  res.json({
    version: process.env.npm_package_version || '2.0.0',
    commit: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT || 'dev',
    deployedAt: BOOT_TIME,
    authEnabled: authEnabled(),
    dataCutoff: cutoff,
    processes,
  });
});

// ── Rate limit global del API (100/min por IP). Excluye health/version. ──
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Intenta en un momento.', code: 'RATE_LIMITED' },
});
app.use('/api', (req, res, next) => {
  if (req.path === '/health' || req.path === '/version') return next();
  return apiLimiter(req, res, next);
});

// ── Auth (login publico; /users protegido dentro del router) ──
app.use('/api/auth', authRouter);

// ── Guardia de sesion para las rutas de datos ────────────────
// /api/auth/* y /api/admin/* manejan su propia autorizacion. El resto de /api
// exige sesion valida SOLO si la auth esta activada (gate por JWT_SECRET).
app.use('/api', (req, res, next) => {
  const p = req.path;
  if (p === '/health' || p === '/version') return next();
  if (p.startsWith('/auth') || p.startsWith('/admin')) return next();
  return requireAuth(req, res, next);
});

// ── Registro de actividad (best-effort; solo peticiones con sesión) ──
app.use('/api', accessLogger);

// ── Admin routes (protegidos por rol superadmin dentro del router) ──
app.use('/api/admin', adminRouter);

// ── MCP remoto (conector para claude.ai; token secreto en la URL) ──
app.use('/mcp', mcpRouter);

// ── Descubrimiento OAuth: este servidor NO usa OAuth (la autenticación del MCP
// es el token en la URL). Sin esta respuesta explícita, el catch-all del SPA
// contestaba HTML 200 a /.well-known/* y el flujo de conectores de Claude
// intentaba registrarse contra un servicio de login inexistente
// ("Couldn't register with OICP's sign-in service").
app.all('/.well-known/*', (req, res) => res.status(404).json({ error: 'not_found' }));

// ── Statistics (cacheado 5 min) ──────────────────────────────
app.get('/api/statistics', (req, res) => {
  try {
    res.json(getCachedStatistics(getStatistics));
  } catch (e: any) { res.status(500).json({ error: 'Error al obtener estadísticas' }); }
});

// ── Saneo de parámetros del cliente ──────────────────────────
// `Math.min` solo ponía techo, nunca piso: con pageSize=-1 el valor llegaba intacto a
// SQLite, donde un LIMIT negativo significa SIN LÍMITE, o sea un .all() sobre 1,47 M
// filas (regla 3, medido en ~4 GB de RSS). Y los valores no numéricos (minScore=abc)
// entraban como NaN al WHERE y devolvían 0 resultados en silencio, como si de verdad
// no hubiera coincidencias.
function enteroAcotado(v: any, porDefecto: number, min: number, max: number): number {
  if (v === undefined || v === null || v === '') return porDefecto;
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return porDefecto;
  return Math.min(Math.max(n, min), max);
}
function numeroOpcional(v: any): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// ── Search procedures ────────────────────────────────────────
app.get('/api/procedures', (req, res) => {
  try {
    const params = {
      query: req.query.q as string,
      page: enteroAcotado(req.query.page, 1, 1, 100000),
      pageSize: enteroAcotado(req.query.pageSize, 20, 1, 100),
      riskLevel: req.query.risk as string,
      method: req.query.method as string,
      flag: req.query.flag as string,
      year: numeroOpcional(req.query.year),
      minScore: numeroOpcional(req.query.minScore),
      maxScore: numeroOpcional(req.query.maxScore),
      buyerId: req.query.buyerId as string,
      supplierId: req.query.supplierId as string,
      status: req.query.status as string,
      sortBy: (req.query.sortBy as string) || 'score',
      sortOrder: (req.query.sortOrder as string) || 'DESC',
    };
    res.json(searchProcedures(params));
  } catch (e: any) { res.status(500).json({ error: 'Error al buscar procedimientos' }); }
});

// Single procedure
app.get('/api/procedures/:id', (req, res) => {
  try {
    const proc = getProcedure(decodeURIComponent(req.params.id));
    if (!proc) return res.status(404).json({ error: 'Procedimiento no encontrado' });
    res.json(proc);
  } catch (e: any) { res.status(500).json({ error: 'Error al obtener el procedimiento' }); }
});

// Buyer profile
app.get('/api/buyers/:id', (req, res) => {
  try {
    const profile = getBuyerProfile(decodeURIComponent(req.params.id));
    if (!profile) return res.status(404).json({ error: 'Comprador no encontrado' });
    res.json(profile);
  } catch (e: any) { res.status(500).json({ error: 'Error al obtener el comprador' }); }
});

// Supplier profile
app.get('/api/suppliers/:id', (req, res) => {
  try {
    const profile = getSupplierProfile(decodeURIComponent(req.params.id));
    if (!profile) return res.status(404).json({ error: 'Proveedor no encontrado' });
    res.json(profile);
  } catch (e: any) { res.status(500).json({ error: 'Error al obtener el proveedor' }); }
});

// Rankings
app.get('/api/rankings', (req, res) => {
  try {
    const type = (req.query.type as string) || 'buyers';
    const year = numeroOpcional(req.query.year);
    res.json(getRankings(type, year));
  } catch (e: any) { res.status(500).json({ error: 'Error al obtener rankings' }); }
});

// Filter options
app.get('/api/filters', (req, res) => {
  try {
    res.json(getFilterOptions());
  } catch (e: any) { res.status(500).json({ error: 'Error al obtener filtros' }); }
});

// ── 404 explícito del API ────────────────────────────────────
// Va después de todas las rutas /api y antes del SPA. Sin esto, una ruta inexistente
// bajo /api (p. ej. GET /api/auth/login, que solo existe como POST) atravesaba los
// routers sin emparejar y caía en el catch-all de abajo, que para esos paths no llamaba
// a res.* ni a next(): la conexión quedaba abierta sin respuesta hasta que el cliente
// abandonaba (el edge de Railway la cortaba como 499 a los 300 s).
app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

// ── Serve static in production ───────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const publicDir = path.join(__dirname, '..', 'dist', 'public');
  app.use(express.static(publicDir));
  app.get('*', (req, res) => {
    // Ninguna rama puede quedarse sin responder ni sin delegar.
    if (req.path.startsWith('/api')) return res.status(404).json({ error: 'not_found' });
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`\n OICP - Observatorio de Integridad de Contratacion Publica`);
  console.log(` API: http://localhost:${PORT}/api`);
  console.log(` Auth: ${authEnabled() ? 'ACTIVADA (magic link)' : 'abierta (sin JWT_SECRET)'}`);
  console.log(` App: http://localhost:5173 (dev) | http://localhost:${PORT} (prod)\n`);
  refreshDataCutoff();
  scheduleAutoUpdate();
});
