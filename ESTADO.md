# ESTADO — actualizado 2026-08-11 (tarde)

> **Lee primero esta sección.** Lo que sigue después conserva el historial de las auditorías
> anteriores y tiene tramos que ya quedaron superados; donde haya contradicción, manda lo de aquí.

## 2026-08-11 (tarde) — auditoría de verificación y cierre de la regla 10

Se auditó, contra producción y contra la norma en su fuente primaria, todo lo que la sesión de la
mañana dio por hecho. **Las cifras que reportó son ciertas**, comprobadas una por una: los 1 704
disparos de IP-02 en 2024 con CERO por encima del presupuesto, los 65 497 de catálogo entre los
109 642 de IC-02, las 123 pruebas, los 29 commits de dos días. **La norma también resistió**: la
Resolución R.E-SERCOP-2025-0152 dice textualmente, en su numeral 4, que las ínfimas de más de
USD 7.212,60 y hasta USD 10.000 «podrán realizarse a partir del 07 de julio de 2025», y el Art. 50
de la LOSNCP vigente (verificado en Lexis) fija la ínfima en «igual o inferior a» USD 10.000
«siempre que no consten en el Catálogo Electrónico».

**Lo que no resistió fue la propagación.** El commit `109cd90` cambió cuatro reglas del motor pero
solo llevó UNA de las cuatro (IP-02) a las superficies publicadas. Es la regla 10 rota en el mismo
commit que dice respetarla. Corregido ahora:

- **`db.ts` tenía una SEGUNDA definición de ínfima** con el corte en el 7-oct-2025 mientras el motor
  usaba el 7-jul-2025. El índice de concentración clasificaba distinto que el motor **711 procesos**
  de esa ventana (USD 6,1 M), y CC-01 y CC-05 leen ese índice: contaban una cosa y marcaban otra.
  Ahora hay una sola definición (`SQL_ES_INFIMA_POR_MONTO`), réplica fiel de `isInfimaByAmount()`,
  y **tres pruebas nuevas** las comparan sobre una rejilla de cortes y montos y sobre las filas
  reales. Es el mismo blindaje que ya tenían `MONTO_SQL` y `montoPlausible()` (regla 11).
- **IC-02**: `Methodology.tsx` y el MCP seguían diciendo que el indicador INCLUYE el catálogo
  electrónico y que existe una rama por el texto «ínfima». El motor hace lo contrario desde
  `109cd90`. Reescritos los dos.
- **IT-02**: `Methodology.tsx` seguía publicando como «limitación conocida» el defecto ya corregido
  («la exclusión no descarta nada»). Reescrito, y el MCP explicitado a «por MONTO».
- **Umbral de ínfima**: la tabla del marco normativo y el `umbral_infima_cuantia_usd` del MCP
  seguían con dos tramos y el salto en octubre. Ahora publican los **tres tramos** con la
  Resolución citada, y declaran la zona gris del 3 al 6 de octubre por la sentencia 52-25-IN/25.
- **La etiqueta de régimen de la ficha** prometía «umbrales por coeficiente hasta el 6-oct-2025»,
  lo que desmentía al motor en los procesos de julio a septiembre de 2025. Reescrita.
- **URL de la guía de la OCP**: la publicada devolvía 404 (comprobado). Reemplazada por el PDF
  oficial de la edición 2024. El pie de página le ponía a esa edición el título de la de 2016;
  corregido.
- **La cifra «524 de los 2.237»** de IT-02 estaba corta en uno: son **525** (522 estrictamente bajo
  el umbral y 3 exactamente en él, que cuentan porque el Art. 50 dice «igual o inferior»).

### Lo que sigue pendiente y es lo primero que hay que hacer

1. **El recálculo NO se ha aplicado.** Producción sigue sirviendo los 1 704 falsos positivos de
   IP-02 en 2024 y los 65 497 disparos de catálogo de IC-02. Y hay algo peor que esperar: como la
   ficha rehidrata el texto desde el catálogo vigente pero conserva el `detail` guardado, hoy los
   **10 849** procesos con IP-02 muestran el título nuevo «Adjudicación **sobre** el presupuesto
   referencial» junto a un detalle que dice lo contrario. Comprobado en producción: el proceso
   `ocds-5wno2w-MCB-EPMMM--2024-002-452218` tiene presupuesto $21 655,48 y adjudicado **$659,67**,
   y se publica como si hubiera excedido el referencial. Es una contradicción visible para el
   usuario externo, y solo la cierra el recálculo.
2. **Las citas a la guía de la OCP.** De las 13, **10 no corresponden** a lo que el indicador
   evalúa (verificado contra el PDF oficial de 2024, no contra el resumen de nadie). Los casos más
   claros: IP-02 cita R059, que compara adjudicado contra contrato final, cuando el código compara
   adjudicado contra presupuesto referencial y el código correcto es **R031**; IC-02 cita R055, que
   exige sumar varias adjudicaciones directas del mismo par comprador-proveedor, cuando el código
   evalúa un proceso aislado; CC-05 implementa justamente la fórmula de R055 pero cita R011. Es
   decisión de Oscar si se corrigen los códigos o se retiran las citas.

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

- **`commit 5b3ac38` — CI que no miente y build reproducible.** El CI llevaba
  `continue-on-error` en typecheck y tests: quedaba **verde aunque fallaran**, y el typecheck del
  cliente no corría en ningún paso. Además Node 20 (sin soporte desde abril de 2026) → 22 y
  `npm install` → `npm ci`. `CONTRIBUTING.md` ordenaba que el healthcheck **no** tocara la base,
  lo contrario de lo que hace el código.
- **`commit 7db661d` — revocación inmediata en `/api/admin/*`.** `checkAuth` confiaba en el rol
  que venía **dentro de la cookie firmada** (14 días de vida), así que degradar o eliminar a un
  superadmin **no** le revocaba estas rutas: con esa cookie seguía pudiendo descargar la base
  completa (incluidas `allowed_users` y `access_log`), vaciarla con `batch-clear` o reemplazarla con
  `restore-from-url`. Las rutas de datos sí revalidaban; la incoherencia estaba solo aquí.
  Ahora revalida contra la base en cada petición y **las acciones de administración quedan en
  `access_log`** (antes ninguna, porque el `accessLogger` global corre antes de este router).
  También: `upload-db` autoriza **antes** de bufferizar 500 MB en RAM, y el magic link ya no se
  escribe en los logs cuando Resend falla (llevaba el token de un solo uso, válido 15 min).
  Verificado en producción: `/api/admin/backup` → 403, `/api/admin/status` → 403.
  *Riesgo aceptado y documentado*: el token del MCP sigue apareciendo en los logs del **edge** de
  Railway porque viaja en la URL. Sacarlo de ahí invalidaría los conectores ya configurados, que
  `CLAUDE.md` protege explícitamente.
- **`commit 60955fb` — las tres fallas de la búsqueda.** `buyerId`/`supplierId` no se leían ni se
  enviaban, así que «Ver todos los procedimientos de este comprador» devolvía **la base completa**;
  ordenar por «Mayor monto» o «Más recientes» no hacía nada porque dos `updateParam` seguidos se
  pisaban entre sí (la segunda construye la URL desde el mismo `searchParams` del render);
  y cada tecla disparaba una consulta sobre 1,47 M filas sin cancelación. Además el pie de página
  **dejó de inventar la cobertura de datos**: tenía clavados «1.460.511 procesos» y «14 de mayo de
  2026» como valores de reserva, que se publicaban mientras cargaba `/api/version` o si fallaba.

- **`commit 7c13c3b` — metodología publicada: lo que no depende del recálculo.** IC-02 publicaba
  «umbral del año» (es por FECHA), omitía el fallback a presupuesto y presentaba como válida la rama
  por texto «ínfima», que **no dispara nunca**; ahora también avisa de que ~60% de sus disparos son
  órdenes de catálogo. CC-04 publicaba media regla. TR-02 en el MCP omitía la condición `> 0`.
  TR-03 decía «prefijo RE-» siendo «contiene». El campo `verificado` presentaba una auditoría sobre
  1 460 511 procesos como si fuera la vigente. Nuevo campo `banderas_activas`: 15 definidas, **14
  pueden activarse**. Y `Methodology.tsx` afirmaba en falso que una descripción vacía dispara TR-01.
  Verificado en vivo llamando `oicp_methodology` contra producción.
  **Los textos de CC-01, CC-02, CC-03, CC-05 e IT-02 se dejaron sin tocar a propósito**: describen
  comportamiento defectuoso y se corrigen junto con el motor, porque publicar la regla antes de
  arreglar el código sería publicar el defecto.

- **`commit e9fcc20` + `f3cc9ce` — el respaldo ya es de fiar.** No solo «nunca se había probado»:
  tenía dos formas de producir una copia incompleta que parecía correcta. El
  `wal_checkpoint(TRUNCATE)` iba en un `try/catch` que **descartaba el error**, así que si otra
  conexión tenía la base tomada (el actualizador, o la segunda conexión de `buildAnalytics`) la copia
  salía sin lo que seguía en el WAL; y `createReadStream` leía el archivo **vivo** durante minutos,
  de modo que una escritura concurrente podía dejarlo partido y el cliente recibía un 200 con un
  archivo corrupto. Ahora se pide un snapshot consistente con **`db.backup()`** y no se entrega
  hasta verificar que se puede leer y que trae procesos; se comprueba el espacio libre antes
  (507 con cifras si no cabe, en vez de llenar el volumen de 5 GB); se publican las cabeceras
  `X-OICP-Backup-Procesos` y `X-OICP-Backup-Bytes-Sin-Comprimir` para comprobar que llegó completo;
  si la lectura falla con las cabeceras ya enviadas se corta la conexión a propósito; y el temporal
  se borra siempre, incluso si el cliente aborta.
  **Se usa `db.backup()` y NO `VACUUM INTO` a propósito**: los dos dan la misma consistencia, pero
  VACUUM INTO es síncrono y sobre 1,3 GB bloquearía el único hilo de Node entre 30 y 90 s, es decir
  otro vector de congelamiento. Hay una prueba que verifica explícitamente que el respaldo **cede el
  control al event loop**. `server/backup.test.ts`: 6 pruebas con el WAL sucio a propósito, una de
  ellas demuestra que copiar el archivo vivo **pierde datos**, así que si alguien vuelve a
  «simplificar» el respaldo a una copia de archivo, el CI lo grita.
  *Alcance de la verificación*: el mecanismo está probado contra SQLite real y corre en cada push.
  **No** se ejecutó una corrida sobre la base de producción concreta (requiere descargar ~1,3 GB).
  Esa corrida ahora es segura y falla de forma clara si algo no está bien.

### Contexto operativo verificado en caliente el 2026-08-10

- **Usuarios con acceso: 2.** `oscar.obandoch@gmail.com` (superadmin) y
  **`xgonzalez14@hotmail.com`** (rol `viewer`, **nunca ha ingresado**). El periodista
  `alejoaleph@gmail.com` **ya no está en la whitelist**: Oscar lo removió antes del 10-ago.
  Este documento decía que el segundo usuario era el periodista; queda corregido.
- **El registro de acciones de administración funciona**: tras `7db661d`, una llamada a
  `/api/admin/status` aparece en `/admin/actividad`. Antes no se registraba ninguna.

### 2026-08-11 — el recálculo SE APLICÓ y quedó verificado en producción

`commit 3cf4b6b` · **79 pruebas** · typecheck, tests y build limpios en cada despliegue.

El reflag corrió con el finalize de la sincronización del 11-ago (el cliente se cortó, pero el
servidor completó el trabajo). **Verificado en pantalla, no inferido:**

| Caso | Antes | Ahora |
|---|---|---|
| `ocds-5wno2w-RE-EPP-2017355-19-253178` (mar-2019) | CC-02 «98.8%», score 100, crítico | **sin CC-02**, score **74** |
| `ocds-5wno2w-CDC-001-GADPNT-2022-117563` (ene-2022) | CC-02 «100.0%», score 48, alto | **sin CC-02**, score **18**, moderado |
| CC-03 en la ficha | «presente en 8 de los últimos 7 años» | «contrató en 8 años distintos del período» |
| Composición del Score | no sumaba el total | 30+8+18+18 = **74**, cuadra |
| Críticos en el corpus | 16 623 | **13 259** |
| Riesgo alto | 51 418 | **47 738** |

O sea que ~6 800 procesos dejaron de estar mal clasificados.

**Rendimiento**: `getStatistics` ya no recorre `procedures` (leía 8-131 s de hilo bloqueado); lee
`a_risk_year` y `a_flag_year`. El caché pasa a *stale-while-revalidate*, así que ninguna petición
espera un recálculo. Los rankings y las opciones de filtro, que también recorrían la tabla en cada
carga, usan el mismo caché. Medido en producción: todas las rutas entre **196 y 391 ms**.

**Regla 11 cerrada en todas las superficies**: el ranking de proveedores lee `a_suppliers` (mismo
agregado que el MCP): ROCHE muestra $213 034 526,12, la cifra que la web antes contradecía con
$109,7 M. La lista de búsqueda, la portada y el perfil usan `monto_usd`, no `award_amount` crudo.

**Metodología publicada**: además de las condiciones, ahora se declaran tres limitaciones reales
que antes se ocultaban: que ~60% de los disparos de IC-02 son órdenes de catálogo electrónico
(porque el SERCOP las publica como `direct`), que la exclusión de ínfima de IT-02 **no excluye nada**
y deja pasar ~23% de sus disparos, y una sección nueva que explica cómo se cuentan los días hábiles
(incluye ambos extremos, no descuenta feriados, depende de la hora de la fuente).

**Defectos de UX corregidos, todos vistos en pantalla en producción**: el estado salía como
`Complete` en inglés crudo; el régimen como `LOSNCP_COEFICIENTES`; los montos del texto de las
banderas en formato inglés (`$40,328,858.64`) junto a otros en formato ecuatoriano; «Procesos
Críticos» imprimía un guion donde el valor real era cero; los conteos sin separador de miles; y la
distribución de riesgo del perfil de comprador en orden arbitrario. Las etiquetas de estado estaban
duplicadas en dos pantallas y ninguna cubría los valores que el SERCOP devuelve: ahora hay una sola
definición y un valor no catalogado se capitaliza en vez de exponer el identificador técnico.

**Alerta de datos estancados** en `monitor.yml`: falla si el corte se atrasa más de 10 días o si la
base trae menos de un millón de procesos (el síntoma de haber arrancado vacía tras una corrupción,
que antes respondía «ok» y pasaba inadvertido).

**Aviso**: la sincronización del 11-ago **falló** (`0xC000013A`, las 60 búsquedas al SERCOP sin
respuesta). El corte sigue en 2026-08-07. `.sync-pending-finalize` queda en disco, así que la
próxima corrida reintenta la finalización sola. Si el SERCOP sigue sin responder, es la fuente, no
la plataforma.

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

### El recálculo pendiente: orden exacto y por qué va en una sola pasada

Las correcciones de arriba están entrelazadas: las tres cambian `share_of_buyer` y por tanto los
scores y niveles de riesgo publicados. Hacerlas por separado obligaría a recalcular 1,47 M procesos
varias veces. **Antes de correrlo hay que arreglar dos cosas o el recálculo tumba producción:**

0. **Prerrequisito `updater.ts:333`**: `reflagChanged` acumula el conjunto completo de cambios en
   RAM. Con un cambio de regla que toque a casi todos los procesos son ~3 GB y el contenedor muere.
   Hay que lotear con escritura + `wal_checkpoint(TRUNCATE)` entre lotes (regla 2).
0.b **Prerrequisito `db.ts:589`**: `rebuildConcentrationIndex()` reescribe 517 344 filas en dos
   sentencias sin lotes ni checkpoint. Mismo tratamiento.

Luego, en este orden:
1. `db.ts:678`: `total_value` y `infima_total_value` pasan a usar `MONTO_SQL` en vez de
   `award_amount` crudo. Esto **cambia `share_of_buyer`**, así que también arregla la divergencia de
   $69 M del ranking web contra el MCP y el umbral de $50 000 de CC-03.
2. `updater.ts:267-306`: indexar el contexto por `(buyer_id, supplier_id, año)` y que
   `evaluateConcentrationFlags` lea la fila del **año del proceso**. Quitar los tres `Math.max`.
   `buyer_total_procs` pasa a ser del año. `years_active` se recorta a una ventana real o se publica
   sin ventana. `consortium_count` excluye catálogo.
3. `flag-engine.ts`: excluir catálogo electrónico de IC-02; sustituir `isInfima` (texto muerto) por
   `isInfimaByAmount` en IC-02 e IT-02; `businessDays` truncado a medianoche en zona de Ecuador y
   sin contar el día inicial; interpolar el año en el `detail` de CC-02/CC-01/CC-05.
4. Reescribir `Methodology.tsx` y `METHODOLOGY` para que digan exactamente lo que quedó (regla 10),
   incluida la corrección de «15 banderas» → 14 vivas.
5. `rebuildConcentrationIndex()` + reflag completo, y **verificar en producción los dos casos
   nombrados** de CC-02: el share que muestren tiene que ser el de su año.
6. Ampliar `flag-engine.test.ts` con un caso por cada corrección antes de correr nada.

**Nada de esto está desplegado todavía.** Producción sigue mostrando los scores con el defecto del
máximo entre años.

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
  *(Superado el 11-ago-2026: el corte real es el 6-jul-2025, no el 6-oct. Ver la sección del
  11-ago arriba.)*
- El marco normativo decía «2019-jun 2025», dejando sin cubrir julio–octubre. **Corregido** a
  «2019 — 6 oct 2025», con el umbral de cada año publicado.
  *(Superado el 11-ago-2026: hoy publica los tres tramos de 2025.)*
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
nombre que un periodista puede citar.** Comparación literal de las 15 banderas entre motor, web y
MCP hecha el 2026-08-10; **todo lo de abajo está verificado contra el código y contra producción**
(los «sin veredicto» de la primera pasada quedaron confirmados, con una corrección de atribución).

*Defectos del motor (cambian scores publicados → exigen recálculo):*
- **CC-02, CC-01 y CC-05 usan el máximo entre años**, no el año del proceso
  (`updater.ts:283-285`, `Math.max`). Dos casos verificados en producción:
  `ocds-5wno2w-RE-EPP-2017355-19-253178` (marzo 2019, share real 17,17%, la bandera dice 98,8%, que
  es el de 2026) y `ocds-5wno2w-CDC-001-GADPNT-2022-117563` (enero 2022, share real 1,6%, la bandera
  dice 100,0%, que es el de 2021). El `detail` (`flag-engine.ts:464`) **nunca dice de qué año es el
  porcentaje**, y el `description_es` (`flag-engine.ts:117`) afirma «en un año».
- **El piso de 10 procesos de CC-02 también es acumulado** de 2019-2026, no del año
  (`updater.ts:291-295`, `GROUP BY buyer_id` sin año).
- **CC-03: la ventana de «los últimos 7 años» no existe** (`updater.ts:287-289` cuenta el tamaño del
  conjunto de años sin recorte). En producción **2 861 procesos** llevan el detalle literal
  «presente en 8 de los últimos 7 años» y 9 755 dicen «7 de los últimos 7». Total CC-03: 39 417.
- **CC-03 compara su umbral de $50 000 contra `award_amount` crudo**, porque
  `concentration_index.total_value` (`db.ts:678`) no usa `MONTO_SQL`.
- **IC-02 no excluye el catálogo electrónico**: de sus 109 642 disparos, **65 497 (59,7%) son órdenes
  de catálogo** rotuladas «Adjudicación directa». Es incoherente con `flag-engine.ts:436`, que sí
  excluye el catálogo de todas las CC-* con el argumento de que es compra centralizada
  precalificada. IC-02 es la bandera de peso 30 más disparada del sistema.
  *Corrección de atribución*: la etiqueta `direct` **la trae el SERCOP**, no la fabrica el OICP (se
  refutó con el reparto real: «Mejor oferta» y «Menor Cuantía» llegan como `selective`). El código
  para fabricarla existe (`updater.ts:105`, `load-data.ts:141`, `db.ts:765-766`) pero no actuó.
- **La detección de ínfima por texto es inoperante**: `isInfima` (`flag-engine.ts:231-235`) busca
  «ínfima» en `procurement_method_details`, y **0 de 1 470 321 procesos** contienen esa palabra ahí
  ni en el título. Consecuencias: la rama A de IC-02 (`flag-engine.ts:256`) es **código muerto con 0
  disparos**, y la exclusión de ínfima que IT-02 publica **deja pasar 524 de sus 2 237 disparos
  (23,4%)**. El propio repo ya lo sabía (comentario en `flag-engine.ts:413-416`) y por eso las CC-*
  usan `isInfimaByAmount`; IC-02 e IT-02 se quedaron atrás. De paso, el tercer `includes` de
  `isInfima` es un duplicado literal del primero.
- **`businessDays` (`flag-engine.ts:218-229`) cuenta ambos extremos y depende de la hora**: no trunca
  a medianoche y usa `getDay()`/`setDate()` en hora local del servidor, mientras las fechas del
  SERCOP traen offset `-05:00` con hora real del día. Medido sobre los 2 237 disparos de IT-02: con
  **la misma diferencia de 1 día calendario**, 395 procesos reportan «1 días hábiles» y **616
  reportan «2»**. Hay 406 disparos con 0 días calendario que imprimen «1 días hábiles». No hay
  calendario de feriados ecuatorianos en el repo, y «días hábiles» no está definido en ninguna de las
  tres superficies publicadas.
- **CC-04 cuenta procesos-consorcio de catálogo** (`updater.ts:296`, sin filtro) aunque el proceso
  evaluado sí se excluye: 7 de los 41 procesos-consorcio del dataset son catálogo.

*Divergencias de texto (no cambian scores; se corrigen publicando lo que el motor hace):*
- IP-02: el motor exige además que `award_amount` sea truthy (`flag-engine.ts:304`); web y MCP no lo
  publican, así que con adjudicado 0 la fórmula publicada dispararía y el motor no.
- TR-02: el motor exige longitud `> 0` (`flag-engine.ts:349`) y la web lo publica; **el MCP no**
  (`mcp-server.ts:277`), ni el `description_es` del motor (`flag-engine.ts:147`). Además la web
  afirma que una descripción vacía «dispara TR-01», y eso es falso: TR-01 no mira description ni
  title (`flag-engine.ts:335-339`).
- CC-04: el MCP omite la condición de que el proceso tenga 2+ proveedores, que es media regla.
- IC-02: el MCP omite el fallback a `budget_amount` y dice «umbral del año» cuando es por FECHA.
- TR-03: el MCP dice «prefijo RE-» cuando el motor hace `includes('-RE-')` sobre el ocid.
- `mcp-server.ts:258`: el campo `verificado` cita 1 460 511 procesos; producción tiene 1 470 321.
- Web y MCP anuncian **15 banderas**; IP-03 tiene 0 disparos, así que las vivas son **14**.
- No se publica que `getInfimaThreshold(null)` devuelve 10 000 (`flag-engine.ts:35`): un proceso sin
  fecha usa el umbral post-reforma aunque sea de 2019.
- El índice de concentración decide el umbral por `source_year` (`db.ts:686-692`) y el motor por
  `published_date || award_date` (`flag-engine.ts:246`): dos implementaciones del mismo umbral.
- `ProcedureDetail.tsx:53` describe CC-05 y CC-04 con reglas que el motor no aplica.
- `ProcedureDetail.tsx:274` la «Composición del Score» muestra una suma que no da el total que ella
  misma imprime.

*Lo que SÍ coincide en los tres* (verificado uno por uno, no volver a revisar): los 8 umbrales de
ínfima cuantía y su fecha de corte del 7-oct-2025; los pesos por severidad `{0:3, 1:8, 2:18, 3:30}`;
los cortes de riesgo 0-10 / 11-30 / 31-60 / 61-100; los 3 pares de correlación
(IC-01+IC-02, CC-01+CC-05, IP-01+CC-05) al 50%; los 15 pesos por bandera; y las reglas de
IC-01, IT-01, IP-01, IP-03, TR-01 y TR-03.

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

**Seguridad** — cerrado en `7db661d`, ver arriba. Nota para quien vuelva: `auth.ts:60-63`
repromueve `SUPERADMIN_EMAIL` a superadmin en **cada arranque**, así que degradar esa cuenta
concreta no persiste tras un redeploy. Es a propósito (evita quedarse sin administrador), pero
conviene saberlo.

**Datos y sincronización**
- `local-sync.ts:238` el tope de 300 páginas por término no guarda cursor propio y deja huecos
  silenciosos: julio 2026 tiene el 11% del volumen de julio 2025 y se publica como dato al día.
- `local-sync.ts:115` escribe `regime` = `'LOIP'` donde el resto del código escribe
  `'LOSNCP_REFORMADA'`, y la ficha lo muestra crudo.

**UX** — cerrado en `60955fb`, ver arriba.

**Operación**
- `monitor.yml` no vigila que los datos avancen: la sincronización puede morir semanas en verde.
- `index.ts:94` tras una corrupción la plataforma arranca con base vacía, el healthcheck sigue en
  verde y el pie informa el conteo viejo.
- **Cadencia del respaldo**: el mecanismo ya es correcto y está probado (ver `f3cc9ce`), pero sigue
  siendo **manual**. Falta decidir cada cuánto se corre y dónde se guarda la copia.

## Lo único estructural que queda

> **Esta sección quedó desmentida por mediciones posteriores del mismo 11-ago. Se conserva por el
> historial, pero las dos cifras que la sostenían son falsas.** El volumen real está al **54%**
> (4,69 GB totales, 2,16 GB libres), no al 93%, medido con el endpoint `/api/admin/db-size` del
> commit `6bf2287`. Y la columna `flags` pesa **184 MB**, no «bien por encima de 1 GB»: la
> estimación estaba diez veces por encima. El commit `8c2bee0` decidió además, explícitamente, NO
> normalizar la escritura de `flags`, porque no libera disco (el reflag no encoge el archivo y un
> VACUUM necesita el doble de espacio libre del que hay). El problema del respaldo sigue abierto,
> pero por el tamaño de la base frente al volumen, no por esta columna. El punto 2 de abajo sí se
> resolvió, y por otra vía: la rehidratación desde el catálogo (`hidratarBanderas`, commit
> `8c2bee0`) ya hace que el texto que ve el usuario salga del catálogo vigente.

**El volumen está al 93%** (base de 2,50 GB en 5 GB) y por eso el respaldo no se puede generar: el
endpoint responde 507 con las cifras en vez de llenar el disco. Es la misma condición que en julio
corrompió la base.

La causa está identificada con evidencia: **la columna `flags` duplica texto de catálogo estático en
cada una de los 1,47 M de filas**. Una sola bandera TR-02 ocupa 272 bytes, de los cuales solo unos 60
son datos reales (`code`, `active`, `detail`); el resto — `name`, `name_es`, `description_es`,
`category`, `severity`, `ocp_ref` — es el mismo texto repetido un millón de veces.

Guardar solo lo dinámico y renderizar el texto desde el catálogo al mostrarlo:
1. Baja la base de 2,50 GB a bien por debajo de 1 GB → volumen del 93% a ~40%, respaldos posibles.
2. **Hace imposible que la regla 10 vuelva a romperse**: hoy el texto que ve el usuario sale de la
   base, así que corregir la metodología exige reescribir 1,47 M de filas. Con el texto renderizado
   del catálogo, una corrección surte efecto al instante y no puede quedar desincronizada.
3. Va **gratis** con el próximo reflag, que ya reescribe esa columna de todos modos.

Es un cambio que toca **cada** punto donde el sistema lee banderas (ficha, búsqueda, perfiles, MCP y
los agregados `a_flag_year`), así que merece una sesión propia y su propia tanda de pruebas.

## Orden recomendado para retomar

1. **El recálculo de metodología** (sección «El recálculo pendiente» arriba), con sus dos
   prerrequisitos de memoria y WAL. Es lo que más pesa: hoy producción publica banderas con
   porcentajes de un año distinto al del proceso.
2. **`getStatistics`** fuera del camino HTTP. Comparte solución con el recálculo, porque ambos
   necesitan un punto donde recomputar agregados: conviene hacerlos juntos.
3. **Respaldo probado** de la base (crear, restaurar en una copia, verificar, y fijar cadencia).
4. **Alerta de datos viejos** en `monitor.yml` y arranque con base vacía que no quede en verde.

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
