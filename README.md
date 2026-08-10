# 🔍 OICP — Observatorio de Integridad de Contratación Pública

Plataforma de análisis de riesgos en contratación pública del Ecuador basada en datos abiertos OCDS.

## Inicio Rápido

```bash
# 1. Instalar dependencias
npm install

# 2. Crear base de datos y cargar datos demo
npx tsx server/seed.ts

# 3. Iniciar en modo desarrollo
npm run dev

# 4. Abrir en el navegador
# → http://localhost:5173
```

## ¿Qué hace?

OICP analiza datos de contratación pública del Ecuador y detecta **15 indicadores de riesgo** basados en:

- **LOSNCP reformada** (7 octubre 2025) y Reglamento D.E. 193
- **OCP Red Flags Guide 2024** (Open Contracting Partnership)
- **Umbrales verificados** de SERCOP para 2019-2026
- **Estándar OCDS** (Open Contracting Data Standard)

### Indicadores

| Código | Nombre | Severidad |
|--------|--------|-----------|
| IC-01 | Proveedor Único en Proceso Competitivo | Media |
| IC-02 | Alto Valor Sin Competencia | Alta |
| IT-01 | Plazo de Publicación Insuficiente | Baja |
| IT-02 | Adjudicación Relámpago | Media |
| IP-01 | Valor Cercano al Umbral | Media |
| IP-02 | Diferencia Presupuesto vs Adjudicación | Media |
| IP-03 | Modificación Contractual Significativa | Alta |
| CC-01 | Proveedor Recurrente en Ínfima Cuantía | Alta |
| CC-02 | Proveedor Dominante | Alta |
| CC-03 | Proveedor Histórico Permanente | Media |
| CC-04 | Miembro Recurrente de Consorcio | Media |
| CC-05 | Posible Fraccionamiento | Alta |
| TR-01 | Información Incompleta Crítica | Baja |
| TR-02 | Descripción Genérica | Info |
| TR-03 | Sin Justificación Régimen Especial | Media |

## Stack Técnico

- **Frontend:** React 19 + Vite + Tailwind CSS + React Router + Recharts
- **Backend:** Express + TypeScript
- **Base de datos:** SQLite (better-sqlite3)
- **Motor de flags:** TypeScript puro, sin dependencias externas

## Estructura del Proyecto

```
oicp/
├── client/                  # Frontend React
│   └── src/
│       ├── pages/           # Páginas: Home, Search, Detail, etc.
│       ├── components/      # Componentes reutilizables
│       └── lib/             # API client, utilidades
├── server/                  # Backend Express
│   ├── index.ts             # Entry point del servidor
│   ├── db.ts                # Base de datos + queries
│   ├── flag-engine.ts       # Motor de 15 banderas de riesgo
│   ├── updater.ts           # Actualización incremental + cron
│   ├── local-sync.ts        # Barrido desde IP ecuatoriana → producción
│   ├── mcp-server.ts        # Servidor MCP (10 herramientas)
│   ├── auth.ts              # Magic link + whitelist + sesión
│   ├── seed.ts              # Generador de datos demo
│   └── migrate.ts           # Migración de esquema
└── data/                    # SQLite DB (generada, fuera de git)
```

## Cargar Datos Reales de SERCOP

El sistema viene con datos demo. Para cargar datos reales:

1. Descarga releases OCDS de: https://datosabiertos.compraspublicas.gob.ec
2. Usa la función `parseOcdsRelease()` de `server/flag-engine.ts` para parsear
3. Inserta con `upsertProcedure()` de `server/db.ts`
4. Reconstruye índice: `rebuildConcentrationIndex()`

## API Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/statistics` | Dashboard general |
| GET | `/api/procedures?q=&risk=&method=&year=&flag=&page=` | Búsqueda |
| GET | `/api/procedures/:id` | Detalle de procedimiento |
| GET | `/api/buyers/:id` | Perfil de comprador |
| GET | `/api/suppliers/:id` | Perfil de proveedor |
| GET | `/api/rankings?type=buyers\|suppliers\|pairs` | Rankings |
| GET | `/api/filters` | Opciones de filtros |

## Despliegue

### Railway / Render
```bash
npm run build
npm start
```

### Docker
```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx tsx server/seed.ts
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

### Replit
Importar repositorio → detecta Node.js automáticamente → funciona.

## Aviso Legal

Los indicadores de riesgo son señales analíticas basadas en datos públicos OCDS. **NO constituyen evidencia ni acusación de corrupción.** Los datos pueden contener errores o no estar actualizados. Este sistema no es una herramienta oficial del gobierno ecuatoriano. Para información definitiva, consulte el [Portal de SERCOP](https://portal.compraspublicas.gob.ec).

## Licencia

MIT
