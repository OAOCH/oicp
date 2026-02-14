import express from 'express';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import { migrate, getStatistics, searchProcedures, getProcedure, getBuyerProfile,
  getSupplierProfile, getRankings, getFilterOptions } from './db.js';
import adminRouter from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(compression());
app.use(morgan('tiny'));
app.use(express.json());

// Initialize DB
migrate();

// Admin routes (data loading from browser)
app.use('/api/admin', adminRouter);

// ── API Routes ──────────────────────────────────────────────

// Statistics
app.get('/api/statistics', (req, res) => {
  try {
    res.json(getStatistics());
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Search procedures
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
      sortBy: (req.query.sortBy as string) || 'score',
      sortOrder: (req.query.sortOrder as string) || 'DESC',
    };
    res.json(searchProcedures(params));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Single procedure
app.get('/api/procedures/:id', (req, res) => {
  try {
    const proc = getProcedure(decodeURIComponent(req.params.id));
    if (!proc) return res.status(404).json({ error: 'Procedimiento no encontrado' });
    res.json(proc);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Buyer profile
app.get('/api/buyers/:id', (req, res) => {
  try {
    const profile = getBuyerProfile(decodeURIComponent(req.params.id));
    if (!profile) return res.status(404).json({ error: 'Comprador no encontrado' });
    res.json(profile);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Supplier profile
app.get('/api/suppliers/:id', (req, res) => {
  try {
    const profile = getSupplierProfile(decodeURIComponent(req.params.id));
    if (!profile) return res.status(404).json({ error: 'Proveedor no encontrado' });
    res.json(profile);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Rankings
app.get('/api/rankings', (req, res) => {
  try {
    const type = (req.query.type as string) || 'buyers';
    const year = req.query.year ? Number(req.query.year) : undefined;
    res.json(getRankings(type, year));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Filter options
app.get('/api/filters', (req, res) => {
  try {
    res.json(getFilterOptions());
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Methodology (flag catalog)
app.get('/api/methodology', (req, res) => {
  import('./flag-engine.js').then(({ FLAG_CATALOG }) => {
    res.json({ flags: Object.values(FLAG_CATALOG) });
  });
});

// ── Serve static in production ──────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const fs = await import('fs');
  const possibleDirs = [
    path.join(__dirname, '..', 'dist', 'public'),
    path.join(process.cwd(), 'dist', 'public'),
  ];
  
  let publicDir = possibleDirs[0];
  for (const dir of possibleDirs) {
    if (fs.existsSync(dir)) { publicDir = dir; break; }
  }
  
  console.log(`  📂 Serving static from: ${publicDir}`);
  app.use(express.static(publicDir));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(publicDir, 'index.html'));
    }
  });
}

app.listen(PORT, () => {
  console.log(`\n  🔍 OICP — Observatorio de Integridad de Contratación Pública`);
  console.log(`  📡 API: http://localhost:${PORT}/api`);
  console.log(`  🌐 App: http://localhost:5173 (dev) | http://localhost:${PORT} (prod)\n`);
});
