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
import { ensureAuthTables, requireAuth, authEnabled } from './auth.js';
import { getCachedStatistics } from './cache.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
  (req.originalUrl || req.url || '').replace(/([?&])(key|token)=[^&]*/gi, '$1$2=***'));
app.use(morgan(':method :maskedurl :status :res[content-length] - :response-time ms'));

app.use(express.json({ limit: '50mb' }));

// Initialize DB + tablas de auth + seed superadmin
migrate();
ensureAuthTables(getDb());

// ── Health check (SIEMPRE publico, sin auth, sin rate limit, no toca BD) ──
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ── Version (publico, util para verificar el deploy) ─────────
app.get('/api/version', (req, res) => {
  res.json({
    version: process.env.npm_package_version || '2.0.0',
    commit: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT || 'dev',
    deployedAt: BOOT_TIME,
    authEnabled: authEnabled(),
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

// ── Admin routes (protegidos por rol superadmin dentro del router) ──
app.use('/api/admin', adminRouter);

// ── Statistics (cacheado 5 min) ──────────────────────────────
app.get('/api/statistics', (req, res) => {
  try {
    res.json(getCachedStatistics(getStatistics));
  } catch (e: any) { res.status(500).json({ error: 'Error al obtener estadísticas' }); }
});

// ── Search procedures ────────────────────────────────────────
app.get('/api/procedures', (req, res) => {
  try {
    const params = {
      query: req.query.q as string,
      page: Number(req.query.page) || 1,
      pageSize: Math.min(Number(req.query.pageSize) || 20, 100),
      riskLevel: req.query.risk as string,
      method: req.query.method as string,
      flag: req.query.flag as string,
      year: req.query.year ? Number(req.query.year) : undefined,
      minScore: req.query.minScore ? Number(req.query.minScore) : undefined,
      maxScore: req.query.maxScore ? Number(req.query.maxScore) : undefined,
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
    const year = req.query.year ? Number(req.query.year) : undefined;
    res.json(getRankings(type, year));
  } catch (e: any) { res.status(500).json({ error: 'Error al obtener rankings' }); }
});

// Filter options
app.get('/api/filters', (req, res) => {
  try {
    res.json(getFilterOptions());
  } catch (e: any) { res.status(500).json({ error: 'Error al obtener filtros' }); }
});

// ── Serve static in production ───────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const publicDir = path.join(__dirname, '..', 'dist', 'public');
  app.use(express.static(publicDir));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(publicDir, 'index.html'));
    }
  });
}

app.listen(PORT, () => {
  console.log(`\n OICP - Observatorio de Integridad de Contratacion Publica`);
  console.log(` API: http://localhost:${PORT}/api`);
  console.log(` Auth: ${authEnabled() ? 'ACTIVADA (magic link)' : 'abierta (sin JWT_SECRET)'}`);
  console.log(` App: http://localhost:5173 (dev) | http://localhost:${PORT} (prod)\n`);
});
