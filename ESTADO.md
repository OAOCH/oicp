# ESTADO — actualizado 2026-08-10

Producción al momento de escribir (`GET /api/version`):
`commit ab39bd8` · `authEnabled: true` · **1 470 321 procesos** · **corte de datos `2026-08-07`**

**El pendiente de datos quedó resuelto**: el corte pasó de `2026-07-11` a `2026-08-07`. La corrida
del 10-ago terminó bien (`finalizado: {"reflagged":606,"cutoff":"2026-08-07"}`), la tarea de Windows
está en `Ready` con último resultado `0` y las tres protecciones (despertar el equipo, tolerar
batería, no detenerse al pasar a batería) están verificadas en el XML de la tarea.

Ojo: el barrido **no completa en una corrida**. La del 10-ago agotó el presupuesto de 240 min en el
término 9 de 69 y guardó cursor (`.sync-cursor.json`). El corte avanza por tandas, no de golpe.

---

## Terminado y funcionando (verificado contra producción)

- **Plataforma web**: búsqueda, detalle de proceso, perfiles de comprador y proveedor, rankings y
  metodología. `/api/health` responde en ~0,3 s y ahora **consulta realmente la base** (antes decía
  «ok» aunque la base estuviera corrupta).
- **Autenticación por invitación**: magic link de 15 min y un solo uso + cookie de sesión de 14 días.
  Ciclo probado de punta a punta: alta (200) → aparece en la lista → baja (200) → su login vuelve a
  **403 `NOT_WHITELISTED`**. La revocación es inmediata: se revalida la whitelist en cada petición.
- **Panel de administración**: `/admin/usuarios`, `/admin/auditoria` y `/admin/actividad` (sesiones y
  páginas por usuario, en hora de Ecuador).
- **Registro de actividad** (`access_log`): correo, ruta y query de cada petición autenticada;
  excluye `token|key|secret`; retención de 90 días con purga al arrancar y cada 24 h; el `INSERT`
  ocurre fuera del camino de respuesta (0 ms de impacto medido).
- **Servidor MCP remoto** en `/mcp/:token` con sus 10 herramientas; token inválido → 401.
- **Auditoría integral (2026-08-09)**: 5 auditores independientes + verificación adversarial de cada
  hallazgo → **30 defectos reales, los 30 corregidos y verificados en producción** (detalle abajo).
- **Costo bajo control**: ~$6/mes el OICP dentro de un consumo total de $6,59 en el ciclo
  18-jul→18-ago. **Límite duro de $20/mes** configurado en Railway, con alerta a los $10.
- **Calidad de código**: `npm run typecheck` limpio en servidor y cliente (había 11 errores
  preexistentes), 21/21 tests del motor de banderas en verde.

## Auditoría adversarial 2026-08-10 (segunda ronda)

7 revisores independientes (backend/datos, seguridad, MCP/IA, metodología, frontend/UX,
operación, producción en vivo), cada uno con un escéptico que intentó refutar sus hallazgos:
**30 hallazgos confirmados** y 6 refutados. Dos escépticos (metodología y MCP/IA) murieron por
límite de sesión, así que sus 17 hallazgos quedaron **sin veredicto** y se verifican a mano.

**Incidente durante la auditoría**: una consulta del propio revisor de MCP dejó la plataforma sin
responder ~20 min (logs del edge: `POST /mcp/... 499 182951ms`, `GET /api/version 499 300004ms`).
El proceso quedó vivo y colgado, no muerto, así que `restartPolicyType ON_FAILURE` no lo recuperó.
Se liberó solo. **No hubo fuga de datos personales**: se revisaron los 14 transcritos y el correo
del periodista no aparece en ninguno; la lista negra de `oicp_sql` aguantó.

### Terminado y desplegado

- **`commit ccf6f28` — tope de costo real en `oicp_sql`.** Las guardas anteriores filtraban la
  *forma* del SQL con expresiones regulares y habían fallado dos veces: la primera versión dejaba
  pasar `FROM a x, b y`, la segunda cerró esa forma pero dejó abiertas `JOIN ... ON 1=1` y la
  subconsulta antes de la coma. Ahora se le pregunta al **planificador** (`EXPLAIN QUERY PLAN`) qué
  va a hacer y se rechaza el plan caro. Hallazgo clave al implementarlo: **SQLite reporta el alias,
  no la tabla** (`FROM procedures p` → `SCAN p`), así que un filtro por nombre de tabla se evade
  aliasando; y las dos evasiones aparecen como `SCAN ... USING COVERING INDEX`, de modo que permitir
  los índices cubridores habría dejado pasar justo el caso catastrófico. La versión final resuelve
  alias→tabla y **falla cerrado**: lo que no puede identificar, lo rechaza.
  También: `LIMIT` impuesto siempre (antes bastaba escribir «limit» en un comentario para anularlo),
  `dbstat` y todo `sqlite_*` en la lista negra, lote JSON-RPC acotado a 20 mensajes, `pageSize`
  saneado con piso (con `-1` SQLite entiende «sin límite» = `.all()` sobre 1,47 M filas, regla 3),
  404 explícito para `/api` (antes esas rutas quedaban colgadas para siempre), y eliminado el
  *fallback* `LIKE` de `oicp_search`, que se disparaba con cualquier palabra mal escrita y recorría
  la tabla entera. **32 pruebas nuevas**, una por evasión conocida (`server/mcp-guards.test.ts`).
- **`commit ab39bd8` — perfil de proveedor: totales exactos (regla 11).** La web publicaba como
  totales lo que era una muestra de 500 filas: COGECOMSA salía con 500 contratos cuando tiene
  497 290, y ROCHE mostraba $109,7 M donde el MCP decía $213,0 M. Ahora los totales salen de
  `a_suppliers`/`a_supplier_year`/`a_supplier_buyer`, **la misma fuente que el MCP**, así que la
  regla 11 se cumple por construcción y no por disciplina. La lista va rotulada como muestra y se
  filtra por `buyer_id` (indexado) en vez de recorrer 1,47 M filas con `EXISTS(json_each(...))`,
  que era un tercer vector de congelamiento. 7 pruebas de integración, incluida una que compara
  web contra MCP y exige coincidencia al centavo (`server/supplier-profile.test.ts`).

### A medias — punto exacto donde quedó

Pendiente un **recálculo de metodología** (una sola pasada que cubre tres correcciones entrelazadas,
porque las tres cambian `share_of_buyer` y por tanto los scores publicados):

1. **CC-02/CC-01/CC-05 usan el máximo histórico, no el año del proceso** (`updater.ts:283-285`,
   `Math.max` al colapsar `concentration_index` por año). **Verificado con datos de producción**: el
   proceso `ocds-5wno2w-RE-EPP-2017355-19-253178`, publicado en **marzo de 2019**, lleva CC-02 activa
   con el detalle «CUERPO DE INGENIEROS representa 98.8% del gasto de este comprador». El share real
   de 2019 fue **17,17%**; el 98,85% es el de **2026**. Como 17% no pasa del 40%, esa bandera **no
   debía existir**, y deja el proceso en score 100/crítico. Lo publicado dice «en un año».
2. **`concentration_index.total_value` suma `award_amount` crudo** (`db.ts:678`), no `MONTO_SQL`: el
   ranking web difiere del MCP en $69 M en el primer puesto.
3. **CC-03 publica una ventana de «los últimos 7 años» que no existe en el código**: el detalle en
   producción dice literalmente «presente en **8 de los últimos 7 años**».

Trabajo restante ya inventariado (ver «Hallazgos confirmados pendientes» abajo).

## Auditoría 2026-08-09: los 30 hallazgos y su corrección

**Seguridad (5)**
- *XSS reflejado* en `GET /api/admin/`: el parámetro `key` se incrustaba sin escapar dentro de un
  `<script>`, y `checkAuth()` dejaba llegar ahí a un superadmin con sesión. Un enlace malicioso podía
  autoconceder superadmin o destruir la base. **Corregido**: la clave solo se refleja si fue ella la
  que autorizó, y se serializa escapando el marcado. Verificado: el payload da 403 y no aparece.
- `oicp_sql` leía `allowed_users` (datos personales), `access_log` (**la investigación en curso del
  periodista**), `mcp_settings` y el esquema. **Corregido** con lista negra que normaliza comillas y
  corchetes; verificado con 9 intentos de evasión, todos bloqueados.
- `oicp_sql` podía **congelar toda la plataforma** con un producto cartesiano o `WITH RECURSIVE`
  (better-sqlite3 ejecuta de forma síncrona). **Corregido**: se rechazan esos patrones y se impone
  `LIMIT`. La primera versión del filtro dejaba pasar `FROM a x, b y`; se detectó probando y se cerró.
- El **token del conector MCP** quedaba en texto plano en los logs. **Corregido**: `/mcp/***`.
- Login: la respuesta distinta para un correo no habilitado permite comprobar si una dirección tiene
  acceso. **Se mantiene deliberadamente** (quien escribe necesita saber que debe pedir acceso) pero
  ahora está documentado como decisión consciente y acotado por el límite de 5 intentos/15 min.

**Metodología (9)** — el riesgo de credibilidad más alto: lo publicado no coincidía con el código.
- Las reglas publicadas de IC-01, IC-02 y TR-03 citaban campos OCDS que el motor **nunca usa**
  (`procurementMethod == "open"`, `"limited"`, un campo `rationale` inexistente). Un auditor que
  intentara reproducirlas habría obtenido resultados distintos. **Las 15 se reescribieron para
  coincidir literalmente con `flag-engine.ts`.**
- La tabla `UMBRALES` daba $10.000 para 2025 y **contradecía a la propia función**, que aplica
  $7.212,60 hasta el 6-oct-2025. **Corregida** con la fecha de corte explícita.
- El marco normativo decía «2019-jun 2025», dejando sin cubrir julio–octubre. **Corregido** a
  «2019 — 6 oct 2025», con el umbral de cada año publicado.
- CC-03, CC-04 e IT-02 omitían exclusiones que el código sí aplica (catálogo electrónico, ínfima).
- TR-02, README: detalles menores alineados (descripción vacía, endpoint inexistente).

**Datos (4)** — «dos cifras para lo mismo».
- La web sumaba solo `award_amount` y el MCP aplicaba la regla de plausibilidad: **para CELEC EP la
  diferencia era de $4,5 millones**. **Corregido**: una sola definición (`MONTO_SQL`) para web y MCP.
  Verificado en producción: PETROECUADOR y CELEC ahora coinciden al centavo entre ambas vías.
- `oicp_search` devolvía el `COALESCE` crudo pese a documentar la regla: unificado.
- La ficha de un proceso mostraba montos absurdos de la fuente como si fueran reales: ahora **avisa**
  y muestra el monto saneado junto al dato oficial.

**UX (7)**
- Cualquier fallo de API se veía como «no encontrado» o «0 resultados», y un fallo en la portada
  dejaba **el spinner girando para siempre**. **Corregido**: `ApiError` conserva el código HTTP y
  cada pantalla distingue el 404 de una caída del servicio, con botón de reintento.
- **Aviso de privacidad LOPDP** permanente en el pie (qué se registra, 90 días, a quién escribir).
- Tablas del panel de actividad con desplazamiento horizontal en móvil.

**Operación (5)**
- `/api/health` no tocaba la base: el monitor no habría detectado una base corrupta. **Corregido**.
- `batch-clear` (vacía la base entera) no pedía confirmación. Ahora exige `{"confirm":"BORRAR TODO"}`
  y rechaza si hay un job escribiendo.
- El respaldo copiaba el `.db` sin checkpoint del WAL: podía salir incompleto. **Corregido**.
- La ingesta local no verificaba el job de `/admin/load`: podían pisarse. **Corregido**.
- `nixpacks.toml` era configuración muerta (Railway construye con **Dockerfile**, confirmado en el
  panel) y `npm start` apuntaba a `dist/`, que ningún build genera. **Ambos alineados con la realidad.**

## Hallazgos confirmados pendientes (auditoría 2026-08-10)

Ordenados por gravedad. Los marcados «sin veredicto» los reportó un revisor cuyo escéptico murió
por límite de sesión: **hay que verificarlos antes de tocar el código**, no se dan por buenos.

**Metodología (regla 10) — el riesgo reputacional más alto: son afirmaciones sobre entidades con
nombre que un periodista puede citar.**
- CC-02/CC-01/CC-05 con el máximo histórico en vez del año del proceso (verificado, ver arriba).
- CC-03 con la ventana de 7 años inexistente (verificado: «8 de los últimos 7 años»).
- IC-02 publica `procurement_method == "direct"` sin decir que esa etiqueta **la fabrica el OICP**:
  65 497 órdenes de catálogo electrónico salen rotuladas «Adjudicación directa» (sin veredicto).
- La exclusión de ínfima publicada para IT-02 y la rama de ínfima de IC-02 **no excluyen nada**:
  ningún proceso del dataset tiene «ínfima» en el texto del método (sin veredicto).
- «días hábiles» se publica como función sin definir y cuenta ambos extremos (sin veredicto).
- `METHODOLOGY` del MCP: TR-02 omite la condición de longitud > 0 que sí publica la web, y el campo
  `verificado` cita una auditoría sobre 1 460 511 procesos cuando producción tiene 1 470 321.
- `ProcedureDetail.tsx:53` describe CC-05 y CC-04 con reglas que el motor no aplica.
- `ProcedureDetail.tsx:274` la «Composición del Score» muestra una suma que no da el total que ella
  misma imprime.

**Disponibilidad**
- `getStatistics` (`db.ts:245`) expande `FROM procedures, json_each(flags)` sobre 1,47 M filas dentro
  de la petición HTTP: medido en 8-131 s de event loop bloqueado, y bloquea incluso `/api/health`.
  El caché es de 5 min sin protección de estampida, así que **la primera visita a la portada tras el
  vencimiento paga el costo**. Debe leer de `a_risk_year`/`a_flag_year` o materializarse.
  El comentario de `index.ts:89` todavía dice «no toca BD» y ya no es verdad.
- `railway.toml:8` `restartPolicyType ON_FAILURE` no cubre un proceso vivo pero colgado: fue
  exactamente lo que pasó el 10-ago y no se recuperó solo.
- `updater.ts:333` `reflagChanged` acumula el conjunto completo de cambios en RAM (~3 GB si se
  cambia un peso de bandera): **esto afecta al recálculo pendiente**, hay que lotear antes de correrlo.
- `db.ts:589` `rebuildConcentrationIndex()` completo reescribe 517 344 filas en dos sentencias sin
  lotes ni checkpoint (regla 2).

**Seguridad**
- `admin.ts:64` `checkAuth` confía en el rol que viene **dentro de la cookie**: degradar o eliminar a
  un superadmin no le revoca `/api/admin/*` por hasta 14 días, y eso incluye `backup` (descarga la
  base completa, con `allowed_users` y `access_log`), `batch-clear` y `restore-from-url`. Nada queda
  en `access_log` porque no setea `req.user`. **Contradice lo que este documento afirmaba sobre
  revocación inmediata**: eso es cierto para las rutas de datos, no para `/api/admin/*`.
  Cuidado al corregir: `auth.ts:60-63` repromueve `SUPERADMIN_EMAIL` en cada arranque.
- `admin.ts:98` `upload-db` bufferiza hasta 500 MB en RAM **antes** de verificar autorización.
- `auth.ts:251` el magic link completo va en texto claro a los logs cuando Resend falla.
- `?tempkey=` no lo enmascara el filtro de morgan; el token del MCP sigue en claro en los logs del
  **edge** de Railway (el enmascarado solo cubre el log de la app).

**Datos y sincronización**
- `local-sync.ts:238` el tope de 300 páginas por término no guarda cursor propio y deja huecos
  silenciosos: julio 2026 tiene el 11% del volumen de julio 2025 y se publica como dato al día.
- `local-sync.ts:115` escribe `regime` = `'LOIP'` donde el resto del código escribe
  `'LOSNCP_REFORMADA'`, y la ficha lo muestra crudo.

**UX**
- `Search.tsx:90` dispara una consulta por cada tecla y una respuesta vieja puede pisar la nueva.
- `Search.tsx:59` «Ver todos los procedimientos de este comprador» ignora `buyerId` y devuelve la
  base completa.
- `Search.tsx:213` ordenar por «Mayor monto» o «Más recientes» no hace nada y el selector se revierte.
- `Layout.tsx:34` el pie imprime un corte de datos y un conteo **fijos y desactualizados** mientras
  carga o si `/api/version` falla.

**Operación**
- `ci.yml:25` `continue-on-error` en typecheck y tests: **el CI queda verde aunque fallen**, y el
  typecheck del cliente no se ejecuta en ningún paso.
- `monitor.yml` no vigila que los datos avancen: la sincronización puede morir semanas en verde.
- `index.ts:94` tras una corrupción la plataforma arranca con base vacía, el healthcheck sigue en
  verde y el pie informa el conteo viejo.
- `admin.ts:803` el único respaldo es una copia en caliente, sin cadencia y **nunca restaurada**.
- `Dockerfile:7` build no reproducible sobre Node 20, sin soporte desde abril de 2026.
- `.gitignore` cubre `data/*.db` pero no `data/*.db-wal` ni `-shm`.
- `CONTRIBUTING.md:64` ordena que el healthcheck **no** consulte la base, lo contrario de lo que hace
  el código corregido.

**Refutados por el escéptico (no tocar)**: CSP con `unsafe-inline` (la necesita la página de
administración), `JWT_SECRET` corto, `?tempkey=` sin enmascarar como crítico, contraste del score,
el monitor que «se apaga solo», y la rutina semanal de `DEPLOY-RAILWAY.md`.

## Decisiones tomadas (con la alternativa descartada)

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| **Sincronización híbrida**: el barrido corre en una PC ecuatoriana y empuja a producción | Cron en la nube bajando datos | El SERCOP bloquea IPs de datacenter: desde Railway falla (`fetch failed`), desde la IP local responde 200 en 1,4 s. El cron de la nube se autoexcluye verificando alcanzabilidad. |
| **Una sola fuente MCP: el conector remoto** | Mantener también el MCP local | Las dos fuentes devolvían cifras distintas a la vez. Nunca volver a registrar el local mientras exista el remoto. |
| **Acceso por invitación** | Portal público abierto | Las banderas sobre entidades con nombre pueden circular fuera de contexto como veredictos. |
| **Bloquear `oicp_sql` por lista negra de tablas** | Base separada para datos de auth | La lista negra cierra el riesgo hoy sin migrar datos en producción; la separación física queda como mejora futura si el MCP se abre a terceros. |
| **Mantener la respuesta clara en login** | Respuesta neutra anti-enumeración | Una respuesta ambigua dejaría a los invitados esperando un correo que nunca llega. Riesgo acotado por rate limit. |
| **Monitor cada 30 min** | Cada 5 min | Con 5 min se agotaba la cuota gratuita de GitHub Actions y los runs se cancelaban. |
| **Registro de actividad fuera del camino de respuesta** | `INSERT` síncrono | Las rutas del usuario nunca tocaban disco; medido: 0 ms de impacto con el cambio. |
| **Re-evaluación con `.iterate()` y escritura de solo diferencias** | `.all()` sobre `procedures` | Medido: `.all()` llevó el proceso a ~4 GB de RSS en 40 s, con riesgo de muerte por memoria. |
| **IP-03 se mantiene, marcada inactiva** | Borrar el indicador | El SERCOP no publica enmiendas; su ausencia es en sí un hallazgo sobre la transparencia de la fuente. |
| **Concentración excluida del catálogo electrónico y CC-02 solo con ≥10 procesos** | Aplicarlas a todo | En catálogo el SERCOP precalifica: la recurrencia es el procedimiento funcionando. Sin el piso, una entidad pequeña con un proveedor habitual quedaba marcada injustamente. |

## Errores conocidos y cómo se resolvieron

- **WAL gigante llenó el volumen → base corrupta → caída de ~1,5 h.** Resuelto con `bootRecovery()`
  (descarta un WAL >200 MB al arrancar) y apertura a prueba de fallos que aparta el archivo dañado.
  Regla derivada: checkpoints entre lotes en toda escritura masiva.
- **`table procedures has no column named data_coverage`** al ingerir sobre una base restaurada.
  Resuelto con `healSchema()` en `migrate()`.
- **`/api/admin/normalize` devolvía 502 a los 300 s** por el límite del proxy de Railway aunque el
  backend terminaba bien: verificar por logs, no por el HTTP.
- **Monitor «All jobs were cancelled»**: cuota de GitHub Actions agotada. Resuelto bajando la frecuencia.
- **La tarea de Windows moría** con el equipo a batería o al suspenderse. Resuelto con
  `AllowStartIfOnBatteries`, `DontStopIfGoingOnBatteries`, `WakeToRun` y 4 reintentos.
- **Términos genéricos ahogaban la sincronización** (`"del"` tiene 1 167 páginas). Resuelto moviéndolos
  al final y limitando a 300 páginas por término y corrida.
- **«Couldn't register with OICP's sign-in service»** al agregar el conector: el catch-all del SPA
  respondía HTML en `/.well-known/*`. Resuelto con 404 explícito.
- **MCP duplicado en la PC de la oficina**: dos entradas peleaban por la conexión y las llamadas se
  colgaban. Regla: debe existir **una sola** entrada `oicp`.

## Dónde viven las credenciales y variables (solo ubicación, nunca el valor)

- **Producción**: Railway → proyecto `efficient-success` → servicio `oicp` → **Variables**. Hay 7:
  `ADMIN_KEY`, `APP_URL`, `DB_PATH`, `JWT_SECRET`, `MAIL_FROM`, `RESEND_API_KEY`, `SUPERADMIN_EMAIL`.
  No están definidas `AUTO_UPDATE`, `UPDATE_CRON`, `UPDATE_TZ` ni `UPDATE_BUDGET_MIN`: rigen los
  valores por defecto del código (cron `0 2 * * 2,4`, `America/Guayaquil`, 240 min).
- **Local**: `.env` (gitignored). Plantilla comentada en `.env.example`.
- **Token de sincronización**: archivo `.sync-token` en la raíz (gitignored). Se rota con
  `POST /api/admin/mint-sync-token`; el servidor guarda solo su hash.
- **Token del MCP**: viaja en la URL del conector; el servidor guarda solo el hash sha256 en
  `mcp_settings`. El valor en claro vive en la configuración de Claude Desktop de las máquinas de
  Oscar, **no en el repositorio**. Se rota con `POST /api/admin/mcp-token`.
- **Verificado**: no hay ninguna clave escrita en el código de `server/` ni `client/`.

## Contexto operativo

- **Usuarios con acceso**: 2 — Oscar (superadmin) y un periodista con rol `viewer`, invitado el
  16-jul, que ingresó por primera vez el 17-jul a las 17:50 (hora de Ecuador).
- **Reforma normativa**: el Decreto Ejecutivo 461 (R.O. 3S 337, 30-jul-2026) reformó 58 artículos del
  Reglamento de la LOSNCP. **No cambia ningún umbral ni bandera.** Su art. 426.1 ordena al SERCOP usar
  IA y minería de datos para detectar riesgos y generar alertas tempranas. Da 140 días para adecuar el
  Portal (≈ mediados de diciembre 2026): **vigilar `sync.log` en esa ventana** por si cambia la forma
  de la API de datos abiertos.

## POR CONFIRMAR

- **Política de retención del acceso del periodista**: ¿hasta cuándo se mantiene? (recomendación
  pendiente de decisión: 30 días de prueba editorial con revisión al día 15).
- **¿Separar físicamente los datos de autenticación** (`allowed_users`, `access_log`) a una base
  distinta de la de datos públicos? Hoy el riesgo está cerrado con la lista negra de `oicp_sql`;
  la separación sería la defensa definitiva si algún día el MCP se comparte con terceros.
