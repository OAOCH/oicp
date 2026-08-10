# ESTADO — actualizado 2026-08-09

Producción al momento de escribir (`GET /api/version`):
`commit 5611b78` · `authEnabled: true` · **1 469 508 procesos** · **corte de datos `2026-07-11`**
(la puesta al día está corriendo, ver «A medias»).

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

## A medias — punto exacto donde quedó

**Puesta al día de los datos: el corte sigue en 2026-07-11 y debería estar en agosto.**
- Causa raíz encontrada: la tarea de Windows moría con código `0xC000013A` (proceso terminado) y el
  registro del sistema muestra **suspensiones del equipo** en esos momentos. La laptop se dormía y
  mataba el barrido.
- Corregido: la tarea ahora **despierta el equipo** (`WakeToRun`), tolera batería y **reintenta 4
  veces cada 15 minutos** si se interrumpe.
- La corrida se relanzó el 2026-08-09 por la noche y está en curso. La recuperación automática ya
  demostró funcionar: al arrancar detecta la finalización pendiente y la ejecuta antes de barrer.

## Siguiente paso concreto

1. Verificar que el corte avanzó: `curl -s https://oicp-production.up.railway.app/api/version` →
   `dataCutoff` debe pasar de `2026-07-11` a una fecha de agosto.
2. Si no avanzó, leer `sync.log` (raíz del proyecto) y buscar la última línea `finalizado:`.
3. La tarea programada corre sola los **martes y jueves a las 08:00**; no requiere intervención.

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
