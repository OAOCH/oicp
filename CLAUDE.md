# OICP — Observatorio de Integridad de Contratación Pública (Ecuador)

## Qué es y para quién
Plataforma web que analiza contratación pública del Ecuador (datos abiertos OCDS del SERCOP) y
aplica **15 indicadores de riesgo** a cada proceso, con score y nivel (low/moderate/high/critical).
Acceso **por invitación** (whitelist de correos); no hay registro público. El superadministrador por
defecto es `oscar.obandoch@gmail.com` (`server/auth.ts:21`). Repo: `github.com/OAOCH/oicp`, rama `main`.
Aviso legal del propio README: los indicadores **NO** constituyen evidencia ni acusación de corrupción.

## Stack
- **Frontend:** React 19 + Vite + Tailwind + React Router + Recharts (`client/`)
- **Backend:** Express + TypeScript ejecutado con `tsx` (`server/`)
- **BD:** SQLite vía `better-sqlite3` (WAL). Tablas: `procedures`, `concentration_index`,
  `allowed_users`, `magic_tokens`, `mcp_settings`, `access_log`, `import_log`, y agregados `a_*`.
- **Otras deps de producción:** helmet, cors, compression, morgan, express-rate-limit, node-cron, zod

## Estructura
```
client/src/pages|components|lib   UI (Home, Search, ProcedureDetail, Buyer/SupplierProfile,
                                  Rankings, Methodology, Login, AdminUsers, AdminAudit, AdminActivity)
server/index.ts                   entry: helmet+CSP, CORS, rate limit, guardia de sesión, rutas
server/db.ts                      esquema, queries, bootRecovery (WAL>200MB) y apertura a prueba de corrupción
server/flag-engine.ts             motor de las 15 banderas, pesos y score  (+ flag-engine.test.ts, 21 tests)
server/auth.ts                    magic link (15 min, un solo uso) + cookie de sesión (14 días)
server/updater.ts                 actualización incremental + cron mar/jue 02:00 America/Guayaquil
server/local-sync.ts              barrido desde una PC ecuatoriana que empuja a producción
server/mcp-server.ts              servidor MCP (10 herramientas) + agregados a_*
server/routes/                    auth.ts, admin.ts, mcp.ts
.github/workflows/                ci.yml (typecheck+build+tests) y monitor.yml (ping /api/health c/30 min)
data/                             base SQLite local (gitignored)
```

## Correr en local
```bash
npm install
cp .env.example .env     # deja JWT_SECRET vacío => plataforma abierta, sin login
npm run dev              # server (tsx watch, :3000) + client (vite, :5173) en paralelo
```
App en `http://localhost:5173` (vite proxea `/api` a `:3000`). Otros comandos: `npm test`,
`npm run db:seed`, `npm run db:migrate`. Sin base real, `npx tsx server/seed.ts` genera datos demo.
Para apuntar a una base concreta: `DB_PATH=/ruta/oicp.db PORT=3999 npx tsx server/index.ts`.

## Desplegar
**`git push origin main` despliega solo.** Railway observa el repo y publica.
- Workspace `oaoch's Projects` · Proyecto **efficient-success** · Entorno **production**
- Servicio **oicp** → `https://oicp-production.up.railway.app` · Volumen **oicp-volume**
- Build por **Dockerfile** (`railway.toml`), healthcheck `/api/health` (timeout 300 s)
- El contenedor arranca con `npx tsx server/index.ts` (NO usa `npm start`/`dist`)

Verificar que el deploy aterrizó (el commit debe coincidir con el que subiste):
```bash
curl -s https://oicp-production.up.railway.app/api/version
```

## Reglas que siempre debes respetar
1. **Verificar en producción después de cada push**: `/api/version` (commit) y `/api/health`.
2. **WAL acotado**: toda escritura masiva va por lotes con `wal_checkpoint(TRUNCATE)` entre ellos.
   Un WAL sin control ya llenó el volumen y tumbó producción (ver ESTADO.md).
3. **Nunca cargar tablas completas en memoria**: usar `.iterate()`, no `.all()`, sobre `procedures`
   (1,4 M filas: un `.all()` medido llevó el proceso a ~4 GB de RAM).
4. **No cachear la conexión SQLite a través de `await`**: usar `getDb()` en cada punto de uso;
   `upload-db`/`restore-*` reemplazan la conexión en caliente.
5. **Los agregados `a_*` deben quedar sincronizados con `procedures`** en la misma transacción;
   las herramientas MCP leen de ahí y una divergencia es invisible para el usuario.
6. **La respuesta al usuario nunca se bloquea por trabajo accesorio** (el registro de actividad
   escribe fuera del camino de respuesta y descarta errores en silencio).
7. **Un flag no es un hallazgo**: mantener el disclaimer en UI y en toda salida del MCP.
8. **Ningún secreto en el repo.** Verificado: no hay claves escritas en `server/` ni `client/`.
9. **Respetar el rate limit del SERCOP**: concurrencia ≤3, ~3 req/s, honrar `Retry-After` del 429.

## Qué NO tocar nunca
- **`data/*.db` en producción a mano.** La base vive en el volumen `oicp-volume`; se reemplaza solo
  por `/api/admin/upload-db` o `/api/admin/restore-from-url`, que además rechazan (409) si el
  actualizador está corriendo.
- **`bootRecovery()` y `openWithFailover()` (`server/db.ts`)**: son la red que permitió recuperar
  producción de una corrupción por disco lleno. Sin ellos la app no arranca tras un WAL roto.
- **`.sync-token`, `.sync-cursor.json`, `.sync-pending-finalize`, `.env`**: gitignored, contienen
  estado o secretos locales. No commitear ni pegar su contenido en documentos.
- **El umbral de ínfima cuantía por año en `flag-engine.ts`**: son cifras legales verificadas
  (incluye el cambio del 7-oct-2025). No "redondear" ni ajustar sin norma que lo respalde.
- **`/mcp/:token`**: el token viaja en la URL y su hash vive en `mcp_settings`. Rotarlo invalida
  los conectores ya configurados en las máquinas de Oscar.

## POR CONFIRMAR
- **`nixpacks.toml` convive con `railway.toml`** (que fuerza Dockerfile). ¿Es residuo que se puede
  borrar o hay algún entorno que lo use?
- **`npm run build` compila a `dist/` y `npm start` lo ejecuta, pero producción corre `tsx`.**
  ¿Se mantiene ese camino por algo o se puede eliminar?
- **Ruta exacta de montaje del volumen `oicp-volume`.** `.env.example` dice que `DB_PATH` apunta a
  `/data` en Railway; no verifiqué el valor real de la variable (no leo valores de secretos/config).
- **`DEPLOY-RAILWAY.md` y `GUIA-PASO-A-PASO.md`** describen el alta inicial (repo público, $0/mes)
  y ya no coinciden con la operación actual. ¿Se actualizan o se archivan?
- **`README.md` menciona una carpeta `scripts/`** que no existe en el proyecto.
