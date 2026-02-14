# 🚀 GUÍA: Poner OICP en línea con Railway

## ¿Qué es Railway?
Un servicio de hosting que te da un servidor en la nube gratis ($5/mes incluidos).
Tu app queda en una URL pública tipo `oicp-production.up.railway.app`.

## Tiempo total: ~15 minutos
## Costo: $0 (el plan gratuito incluye $5/mes que alcanza de sobra)

---

## PASO 1: Crear cuenta en GitHub (si no tienes)

1. Ve a **https://github.com**
2. Click **"Sign up"**
3. Sigue los pasos (email, contraseña, nombre de usuario)

---

## PASO 2: Crear un repositorio en GitHub

1. Ya con tu cuenta abierta, ve a **https://github.com/new**
2. Llena así:
   - **Repository name:** `oicp`
   - **Description:** `Observatorio de Integridad de Contratación Pública del Ecuador`
   - Marca ✅ **Public** (tiene que ser público para el plan gratuito de Railway)
   - NO marques nada más (ni README, ni .gitignore, ni license)
3. Click **"Create repository"**
4. Te va a mostrar una página con instrucciones — déjala abierta

---

## PASO 3: Subir los archivos del proyecto a GitHub

### Opción A — Desde el navegador (más fácil si no usas Git):

1. En la página del repositorio que acabas de crear, busca el link que dice:
   **"uploading an existing file"**
2. Click ahí
3. Arrastra TODOS los archivos y carpetas de dentro de la carpeta `oicp/` 
   (NO la carpeta oicp en sí, sino su CONTENIDO: `package.json`, `server/`, `client/`, etc.)
4. Escribe un mensaje como "Initial commit"
5. Click **"Commit changes"**

### Opción B — Desde la terminal (si tienes Git instalado):

```bash
cd ruta/a/oicp
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/oicp.git
git push -u origin main
```

(Reemplaza `TU_USUARIO` con tu nombre de usuario de GitHub)

---

## PASO 4: Crear cuenta en Railway

1. Ve a **https://railway.app**
2. Click **"Login"** (arriba a la derecha)
3. Elige **"Login with GitHub"**
4. Autoriza la conexión

---

## PASO 5: Crear el proyecto en Railway

1. Ya logueado en Railway, click **"New Project"** (botón morado)
2. Elige **"Deploy from GitHub Repo"**
3. Si es la primera vez, te pedirá autorizar acceso a tus repos → acepta
4. Busca y selecciona tu repo **"oicp"**
5. Railway empieza a construir automáticamente (tarda 2-3 minutos)

---

## PASO 6: Configurar la variable de entorno

1. En Railway, click en tu servicio (el cuadrado que dice "oicp")
2. Ve a la pestaña **"Variables"**
3. Click **"New Variable"** y agrega:
   - **Name:** `ADMIN_KEY`
   - **Value:** (inventa una contraseña, ej: `mi-clave-secreta-123`)
4. Click **"Add"**
5. Railway se redespliega automáticamente

---

## PASO 7: Obtener tu URL pública

1. En Railway, click en tu servicio
2. Ve a la pestaña **"Settings"**
3. Busca **"Networking"** → **"Generate Domain"**
4. Click → te da una URL tipo: `oicp-production.up.railway.app`
5. **¡Esa es tu URL pública!** Abre en el navegador para verificar

---

## PASO 8: Cargar datos reales de SERCOP

Ahora viene lo mejor — cargas datos desde el navegador, sin terminal:

1. Abre: `https://TU-URL.up.railway.app/api/admin?key=TU_ADMIN_KEY`
   (reemplaza TU-URL y TU_ADMIN_KEY con los tuyos)
2. Verás un panel con botones: "Cargar 2024", "Cargar 2025", etc.
3. Click **"Cargar 2024"** → confirma
4. Espera 20-60 minutos (puedes cerrar la página y volver después)
5. Para verificar el progreso, vuelve a abrir esa misma URL
6. Cuando termine, ve a tu URL principal y verás los datos reales

### Para prueba rápida:
Click **"Buscar construcción 2024"** — tarda solo 1-2 minutos y carga ~50 procedimientos.

---

## ACTUALIZACIÓN SEMANAL

Cada semana:
1. Abre: `https://TU-URL.up.railway.app/api/admin?key=TU_ADMIN_KEY`
2. Click el botón del año actual (ej: "Cargar 2026")
3. Espera a que termine
4. Listo — los datos nuevos aparecen automáticamente

---

## POSIBLES PROBLEMAS

### "Application failed to respond"
→ Espera 2-3 minutos después del deploy, Railway está iniciando el servidor.

### La app se ve vacía
→ Todavía no cargaste datos. Ve al Paso 8.

### "Clave admin incorrecta"
→ Verifica que el `ADMIN_KEY` en la URL coincida con la variable en Railway.

### Railway dice "Build failed"
→ Revisa los logs en Railway (pestaña "Deployments" → click en el deploy → "View Logs").
   Copia el error y mándamelo, te ayudo a resolverlo.

### Se acabaron los $5 del mes
→ Para un proyecto como este es casi imposible que pase. Si pasa, Railway
   pausa el servicio hasta el próximo mes. Para evitarlo, puedes poner
   tarjeta de crédito (solo cobra si excedes los $5).

---

## RESUMEN DE URLs

| URL | Para qué |
|-----|----------|
| `https://TU-URL.up.railway.app` | La app pública (cualquiera puede acceder) |
| `https://TU-URL.up.railway.app/api/admin?key=TU_CLAVE` | Panel admin para cargar datos (solo tú) |
| `https://TU-URL.up.railway.app/api/statistics` | API de estadísticas (datos JSON) |

---

## ¿QUIERES UN DOMINIO PROPIO?

Si quieres que la URL sea algo como `oicp.ec` o `oicp.hekalaw.com`:

1. Compra un dominio (en GoDaddy, Namecheap, o cualquier registrador)
2. En Railway → Settings → Networking → "Custom Domain"
3. Sigue las instrucciones para configurar el DNS
4. Listo — tu app disponible en tu propio dominio
