# ESTADO — actualizado 2026-08-07

Producción al momento de escribir (`GET /api/version`):
`commit b0deff1` · desplegado `2026-08-07T17:41Z` · `authEnabled: true` ·
**1 469 508 procesos** · **corte de datos `2026-07-11`**.

---

## Terminado y funcionando (verificado hoy contra producción)

- **Plataforma web**: búsqueda, detalle de proceso, perfiles de comprador y proveedor, rankings,
  metodología. `/api/health` responde `{"status":"ok"}` en ~0,3 s.
- **Autenticación por invitación**: magic link de 15 min y un solo uso + cookie de sesión de 14 días.
  Probado hoy el ciclo completo: alta de correo (200) → aparece en la lista → baja (200) → su login
  vuelve a **403 `NOT_WHITELISTED`**. Un correo no autorizado nunca recibe código.
  La revocación es inmediata: el servidor revalida la whitelist en cada petición.
- **Panel de administración**: `/admin/usuarios` (alta/baja/rol), `/admin/auditoria` (operaciones de
  datos), `/admin/actividad` (sesiones y páginas por usuario, horas en zona de Ecuador).
- **Registro de actividad** (`access_log`, commit a6adeb5): captura correo, ruta y query de cada
  petición autenticada; excluye parámetros `token|key|secret`; retención 90 días con purga al
  arrancar y cada 24 h. Verificado capturando navegación real.
- **Servidor MCP remoto** en `/mcp/:token`: 10 herramientas (`oicp_info`, `oicp_search`, `oicp_sql`,
  `oicp_process`, `oicp_methodology`, `oicp_flag_stats`, `oicp_top_buyers`, `oicp_top_suppliers`,
  `oicp_buyer_profile`, `oicp_supplier_profile`). Verificado hoy: handshake OK, `tools/list` = 10,
  llamada real con datos, y **token inválido → 401**.
- **Correo transaccional** por Resend (variables `RESEND_API_KEY` y `MAIL_FROM` configuradas).
- **CI** (`ci.yml`: typecheck + build + 21 tests del motor de banderas) y **monitor**
  (`monitor.yml`: ping a `/api/health` cada 30 min).
- **Costo bajo control**: en Railway el consumo del ciclo 18-jul→18-ago iba en $6,59 (el proyecto
  del OICP aporta ~$5,14). Configurado **límite duro de $20/mes** y alerta por correo a los $10.

## A medias — punto exacto donde quedó

**Puesta al día de los datos (corte 2026-07-11, debería llegar a agosto).**
- La sincronización corre en la PC de Oscar (tarea de Windows «OICP Sync SERCOP», mar/jue 08:00,
  lanzador `run-sync.cmd`). Hoy 7-ago la corrida arrancó dos veces y **quedó interrumpida** las dos:
  la primera por un 502 del servidor (coincidió con un despliegue), la segunda sin causa registrada
  (el log termina en `^C`). La tarea quedó en estado `Ready`, sin corrida activa.
- El mecanismo de recuperación **sí funcionó**: a las 18:05 la corrida siguiente detectó la
  finalización pendiente y la ejecutó (`reflagged: 0` → no había nada represado).
- Estado de los archivos de control: `.sync-cursor.json` = `null` (la próxima corrida empieza en el
  término 1, página 1) y `.sync-pending-finalize` = `2026` (la próxima corrida hará primero la
  finalización; es idempotente, no hace daño).

## Siguiente paso concreto

1. Dejar correr la tarea programada del **martes 11-ago 08:00** sin intervenir.
2. Al terminar, verificar que el corte avanzó: `curl -s .../api/version` → `dataCutoff` debe pasar de
   `2026-07-11` a una fecha de agosto.
3. Si no avanzó, leer `sync.log` (raíz del proyecto) y buscar la última línea `finalizado:` o el
   motivo de corte. Si el barrido se queda otra vez en términos genéricos, subir
   `MAX_PAGES_PER_RUN` o correr manualmente `npx tsx server/local-sync.ts --budget-min 240`.

## Decisiones tomadas (con la alternativa descartada)

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| **Sincronización híbrida**: el barrido del SERCOP corre en una PC ecuatoriana y empuja los procesos a producción (`/api/admin/missing-ocids` + `/ingest` + `/ingest-finalize`) | Cron en la nube bajando datos directamente | El SERCOP bloquea IPs de datacenter: desde Railway la petición falla (`fetch failed`), desde la IP local responde HTTP 200 en 1,4 s. El cron de la nube sigue en el código pero se autoexcluye verificando alcanzabilidad. |
| **Una sola fuente MCP: el conector remoto** | Mantener también el MCP local (stdio sobre una copia de la base) | La copia local quedó congelada y las dos fuentes devolvían cifras distintas a la vez. Se eliminó el registro local; nunca volver a registrarlo mientras exista el remoto. |
| **Acceso por invitación** con whitelist | Portal público abierto | Las banderas sobre entidades y proveedores con nombre pueden circular fuera de contexto como si fueran veredictos. Se controla quién entra mientras se valida el uso. |
| **Monitor cada 30 min** | Cada 5 min | Con 5 min el workflow consumía ~8 600 min/mes contra los 2 000 gratuitos y GitHub cancelaba las corridas. |
| **Registro de actividad fuera del camino de respuesta** (`setImmediate`) | `INSERT` síncrono antes del handler | Las rutas del usuario nunca habían tocado disco; el `INSERT` síncrono añadía latencia medible a cada petición. Medido: 0 ms de impacto con el cambio. |
| **Re-evaluación de banderas con `.iterate()` y escritura solo de diferencias** | `.all()` sobre `procedures` | Medido contra la base real: `.all()` llevó el proceso de 54 MB a ~4 GB de RSS en 40 s, con riesgo de que el contenedor muriera por falta de memoria. |
| **IP-03 se mantiene en el catálogo, marcada inactiva** | Borrar el indicador | El SERCOP no publica enmiendas contractuales, así que el indicador nunca dispara. Su ausencia es en sí un hallazgo sobre la transparencia de la fuente; borrarlo lo ocultaría. |
| **Banderas de concentración excluidas del catálogo electrónico** y CC-02 solo con ≥10 procesos | Aplicarlas a todo por igual | En catálogo el SERCOP precalifica centralmente: la "recurrencia" es el procedimiento funcionando. Y sin el piso de 10, una entidad pequeña con un único proveedor habitual quedaba marcada injustamente. |

## Errores conocidos y cómo se resolvieron

- **WAL gigante llenó el volumen → base corrupta → caída de ~1,5 h.** Construir agregados con un
  iterador de lectura abierto impedía el checkpoint. Se resolvió con `bootRecovery()` (descarta un
  WAL >200 MB al arrancar) y apertura a prueba de fallos que aparta el archivo dañado y arranca
  vacío; la base se restauró subiendo la réplica. Regla derivada: checkpoints entre lotes.
- **`table procedures has no column named data_coverage`** al ingerir en una base restaurada desde
  una réplica vieja. Resuelto con `healSchema()` en `migrate()` (commit f36984c): agrega columnas
  faltantes con `ALTER TABLE` al arrancar.
- **`/api/admin/normalize` devolvía 502 a los 300 s** por el límite del proxy de Railway, aunque el
  backend terminaba bien (confirmado en logs). No es un fallo: verificar por logs, no por el HTTP.
- **Monitor de GitHub «All jobs were cancelled»** (6-ago): cuota de Actions agotada. Resuelto
  bajando la frecuencia (commit f86888f).
- **La tarea de Windows no corría con el equipo a batería** y se detenía al desconectar el cargador.
  Resuelto re-registrándola con `AllowStartIfOnBatteries` y `DontStopIfGoingOnBatteries`.
- **Términos de búsqueda genéricos ahogaban la sincronización**: `"del"` tiene 1 167 páginas y una
  corrida entera se consumía ahí sin llegar a finalizar. Resuelto moviendo los genéricos al final de
  la lista y limitando a 300 páginas por término y corrida (commit f86888f).
- **«Couldn't register with OICP's sign-in service»** al agregar el MCP como conector de cuenta: el
  catch-all del SPA respondía HTML 200 en `/.well-known/*` y el cliente creía que había OAuth.
  Resuelto con 404 explícito (commit b0deff1); verificado en producción.
- **MCP duplicado en la PC de la oficina**: dos entradas `oicp` peleaban por el mismo puente y las
  llamadas se colgaban indefinidamente. Regla: debe existir **una sola** entrada.

## Dónde viven las credenciales y variables (solo ubicación, nunca el valor)

- **Producción**: panel de Railway → proyecto `efficient-success` → servicio `oicp` → **Variables**.
  Hay 7 configuradas: `ADMIN_KEY`, `APP_URL`, `DB_PATH`, `JWT_SECRET`, `MAIL_FROM`,
  `RESEND_API_KEY`, `SUPERADMIN_EMAIL`.
  No están definidas `AUTO_UPDATE`, `UPDATE_CRON`, `UPDATE_TZ` ni `UPDATE_BUDGET_MIN`: rigen los
  valores por defecto del código (cron `0 2 * * 2,4`, zona `America/Guayaquil`, presupuesto 240 min).
- **Local**: `.env` en la raíz (gitignored). La plantilla comentada es `.env.example`.
- **Token de sincronización**: archivo `.sync-token` en la raíz (gitignored). Se rota con
  `POST /api/admin/mint-sync-token`; el servidor guarda solo su hash en `mcp_settings`.
- **Token del MCP**: viaja dentro de la URL del conector; el servidor guarda solo el hash sha256 en
  la tabla `mcp_settings`. El valor en claro vive en la configuración de Claude Desktop de las
  máquinas de Oscar, **no en el repositorio**. Se rota con `POST /api/admin/mcp-token`.
- **Verificado**: no hay ninguna clave escrita en el código de `server/` ni `client/`.

## Contexto operativo

- **Usuarios con acceso hoy**: 2 — `oscar.obandoch@gmail.com` (superadmin) y un periodista con rol
  `viewer` invitado el 16-jul, que ingresó por primera vez el 17-jul.
- **Reforma normativa**: el Decreto Ejecutivo 461 (R.O. 3S 337, 30-jul-2026) reformó 58 artículos del
  Reglamento de la LOSNCP. **No cambia ningún umbral ni bandera** del sistema. Su art. 426.1 ordena
  al SERCOP usar IA y minería de datos para detectar riesgos y generar alertas tempranas. Da al
  SERCOP 140 días para adecuar el Portal (≈ mediados de diciembre 2026): **vigilar `sync.log` en esa
  ventana** por si cambia la forma de la API de datos abiertos.

## POR CONFIRMAR

- **Causa de la interrupción de la corrida del 7-ago a las 18:05** (el log solo registra `^C`).
  ¿El equipo se suspendió, se cerró sesión, o hubo algo más?
- **¿Se debe completar el barrido histórico** (terminar los 69 términos hasta que el cursor quede en
  `null` de forma natural) **o basta con que cada corrida capture lo nuevo del año en curso?**
- **Frecuencia deseada mientras se pone al día**: ¿mantener solo martes y jueves, o agregar corridas
  diarias temporales hasta que el corte llegue a la fecha actual?
- **Política de retención del periodista invitado**: ¿hasta cuándo mantiene el acceso?
