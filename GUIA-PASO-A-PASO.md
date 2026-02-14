# 🔍 GUÍA PASO A PASO — OICP con Datos Reales

## Lo que vas a lograr
Una plataforma web funcionando en tu computadora que analiza datos REALES 
de contratación pública del Ecuador, descargados directamente de la API de SERCOP.

## Tiempo estimado
- Instalación: 10 minutos
- Descarga de un año de datos: 30-60 minutos (automático, solo esperas)
- Total: ~1 hora para tener todo funcionando

---

## PASO 1: Instalar Node.js (solo la primera vez)

### Si estás en Mac:
1. Abre Terminal (Cmd + Espacio → escribe "Terminal" → Enter)
2. Copia y pega este comando:
```
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
```
3. Cierra y vuelve a abrir Terminal
4. Escribe:
```
nvm install 20
```

### Si estás en Windows:
1. Ve a https://nodejs.org
2. Descarga la versión "LTS" (el botón verde grande)
3. Instala como cualquier programa (siguiente, siguiente, siguiente)
4. Cuando termine, abre "Command Prompt" o "PowerShell"

### Verificar que funciona:
Escribe esto en tu terminal:
```
node --version
```
Debería mostrar algo como `v20.x.x`. Si dice "command not found", reinicia la terminal.

---

## PASO 2: Descomprimir el proyecto

1. Descarga el archivo `oicp-v2.zip` que te di
2. Descomprímelo (doble click o clic derecho → "Extraer")
3. Abre tu terminal
4. Navega a la carpeta. Ejemplo:
   - Mac: `cd ~/Downloads/oicp`
   - Windows: `cd C:\Users\TuNombre\Downloads\oicp`

---

## PASO 3: Instalar dependencias

En tu terminal, dentro de la carpeta `oicp`, escribe:
```
npm install
```
Esto tarda 1-2 minutos. Verás muchos mensajes — es normal.
Cuando termine, deberías ver algo como "added XXX packages".

---

## PASO 4: Descargar datos reales de SERCOP

### Opción A — Prueba rápida (5 minutos, ~50 procedimientos)
```
npx tsx server/load-data.ts --year 2024 --search "construcción"
```
Esto busca procesos de 2024 que contengan "construcción" y los descarga.

### Opción B — Un año completo (30-60 minutos, ~2000+ procedimientos)
```
npx tsx server/load-data.ts --year 2024 --all
```
Esto usa 35+ términos de búsqueda para capturar la mayor cantidad de procesos de 2024.

### Opción C — Varios años (2-4 horas, miles de procedimientos)
```
npx tsx server/load-data.ts --bulk --years 2022,2023,2024,2025
```

### NOTAS IMPORTANTES:
- **Puedes cancelar en cualquier momento** con Ctrl+C y retomar después — no se duplican datos
- **Necesitas internet** para esta parte
- Verás mensajes como `[14:30:05] Buscando "adquisición" en 2024...` — es normal
- Si ves errores de conexión, espera unos minutos y vuelve a correr el mismo comando
- Al final te muestra cuántos procedimientos descargó

---

## PASO 5: Abrir la aplicación

```
npm run dev
```

Verás algo como:
```
  🔍 OICP — Observatorio de Integridad de Contratación Pública
  📡 API: http://localhost:3000/api
  🌐 App: http://localhost:5173
```

**Abre tu navegador** y ve a: **http://localhost:5173**

¡Listo! Deberías ver el dashboard con datos reales de Ecuador.

---

## PASO 6: Actualización semanal (manual)

Cada semana puedes descargar datos nuevos:

### Para datos del año en curso:
```
npx tsx server/load-data.ts --year 2026 --all
```
(Cambia el año según corresponda)

### Pasos:
1. Abre tu terminal
2. Navega a la carpeta del proyecto: `cd ruta/a/oicp`
3. Corre el comando de arriba
4. Espera a que termine (30-60 min)
5. Abre `npm run dev` si no está corriendo
6. La app ya muestra los datos nuevos

### ¿Cada cuánto actualizar?
- **Recomendado:** Una vez por semana
- **Mínimo:** Una vez al mes
- Los datos no se duplican, así que no pasa nada si corres el mismo comando varias veces

---

## PROBLEMAS COMUNES

### "command not found: npx"
→ Node.js no está instalado. Regresa al Paso 1.

### "Error: ENOENT: no such file or directory"
→ No estás en la carpeta correcta. Verifica con `ls` (Mac) o `dir` (Windows) 
  que ves archivos como `package.json`, `server/`, `client/`.

### La página se ve vacía (sin datos)
→ No descargaste datos. Corre el Paso 4 primero.

### "fetch failed" o errores de conexión
→ Problemas de internet o el servidor de SERCOP está caído.
  Espera unos minutos y reintenta.

### Puerto 5173 o 3000 ya en uso
→ Otra aplicación usa ese puerto. Cierra la terminal anterior o cambia el puerto:
  `PORT=4000 npm run dev`

---

## PARA CERRAR LA APLICACIÓN

Presiona **Ctrl+C** en la terminal donde está corriendo `npm run dev`.

## PARA VOLVER A ABRIRLA DESPUÉS

1. Abre terminal
2. `cd ruta/a/oicp`
3. `npm run dev`
4. Abre http://localhost:5173

(No necesitas volver a instalar ni descargar datos — ya están guardados)

---

## QUIERES PUBLICARLA EN INTERNET

Si quieres que otras personas puedan acceder (no solo tú en tu computadora):

### Opción 1 — Railway (gratis para empezar)
1. Crea cuenta en https://railway.app
2. Conecta tu GitHub
3. Sube el proyecto a un repositorio de GitHub
4. En Railway: New Project → Deploy from GitHub → selecciona el repo
5. Railway te da un URL público automáticamente

### Opción 2 — Replit (más fácil)
1. Crea cuenta en https://replit.com
2. Import from ZIP → sube el oicp-v2.zip
3. Click "Run"
4. Te da un URL público automáticamente

Para cualquiera de estas opciones, puedo guiarte paso a paso cuando estés listo.
