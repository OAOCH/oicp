/**
 * Endpoint MCP remoto: POST /mcp/:token (streamable HTTP, respuestas JSON stateless).
 * El token viaja en la ruta (URL secreta) y se valida contra el hash en mcp_settings.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getDb } from '../db.js';
import { verifyMcpToken, handleMcpMessage } from '../mcp-server.js';

const router = Router();

const mcpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Rate limited' } },
});
router.use(mcpLimiter);

router.post('/:token', (req, res) => {
  const db = getDb();
  if (!verifyMcpToken(db, req.params.token)) {
    return res.status(401).json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } });
  }
  const body = req.body;
  try {
    if (Array.isArray(body)) {
      const out = body.map(m => handleMcpMessage(db, m)).filter(Boolean);
      if (!out.length) return res.status(202).end();
      return res.json(out);
    }
    const out = handleMcpMessage(db, body);
    if (!out) return res.status(202).end();
    return res.json(out);
  } catch (e: any) {
    return res.status(500).json({ jsonrpc: '2.0', id: body?.id ?? null, error: { code: -32603, message: `Internal error: ${e.message}` } });
  }
});

// El transporte streamable HTTP puede sondear GET (stream de servidor): no lo ofrecemos.
router.get('/:token', (req, res) => {
  res.status(405).json({ error: 'Method not allowed. Use POST (JSON-RPC).' });
});
router.delete('/:token', (req, res) => res.status(405).end());

export default router;
