# Cómo trabajar en OICP

Guía corta para correr, probar y desplegar la plataforma.

## Requisitos

- Node.js 20+
- Una copia de `oicp.db` en `data/oicp.db` (la base pesa ~1.3 GB; pídesela a Oscar
  o descárgala con `GET /api/admin/backup` si está habilitado).

## Correr en local

```bash
npm install
cp .env.example .env      # ajusta las variables (deja JWT_SECRET vacío para modo abierto)
npm run dev               # server (tsx) + client (vite) en paralelo
```

- API: http://localhost:3000/api
- App: http://localhost:5173 (dev)

Para correr solo el server contra una BD concreta:

```bash
DB_PATH=/ruta/a/oicp.db PORT=3999 NODE_ENV=development npx tsx server/index.ts
```

## Autenticación en local

Mientras `JWT_SECRET` esté vacío, la plataforma está **abierta** (sin login). Para
probar el flujo de magic link:

1. Pon `JWT_SECRET` (cualquier cadena ≥32 chars) en `.env`.
2. Sin `RESEND_API_KEY`, el magic link **se imprime en los logs del server** (modo
   bootstrap). Copia el enlace `/api/auth/callback?token=...` y ábrelo.
3. Con `RESEND_API_KEY`, el enlace llega por correo.

El superadmin (`SUPERADMIN_EMAIL`) se inserta solo al migrar.

## Tests

```bash
npm test            # tests del motor de banderas (node:test)
```

## Calibración / auditoría

Para validar que un cambio no altera la distribución de banderas:

1. Copia la BD a un scratch: `cp data/oicp.db scratch.db`.
2. Corre el server contra `scratch.db`.
3. `POST /api/admin/fix-budget`, luego `POST /api/admin/normalize`.
4. Compara `riskCounts` / `flagCounts` con la referencia de producción
   (`docs/BANDERAS.md`). Diferencias <0.01% son normales (zona horaria en banderas
   de tiempo). Diferencias grandes = revisar el cambio.

> No cambies umbrales de banderas ni la detección de ínfima sin verificar el impacto
> contra los datos reales y consultarlo. Ver `docs/BANDERAS.md` y `BUGS_RESUELTOS.md`.

## Deploy

- Push a `main` → Railway redespliega automático (~3 min).
- El `Dockerfile` corre `npx vite build` (frontend) y `npx tsx server/index.ts` (backend).
- Healthcheck: `/api/health` (no tocar; cualquier ruta que consulte la BD rompe el deploy).
- Si el deploy falla: Railway → Deployments → ver logs (Build vs Deploy).

## Variables de entorno

Todas están documentadas en `.env.example`. Las nuevas para auth:
`JWT_SECRET`, `APP_URL`, `SUPERADMIN_EMAIL`, `SESSION_LIFETIME_DAYS`, `RESEND_API_KEY`, `MAIL_FROM`.
