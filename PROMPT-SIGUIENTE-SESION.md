# Prompt para la siguiente sesión del OICP

> Copia TODO lo que está debajo de la línea y pégalo como primer mensaje de una sesión nueva
> abierta en `C:\Users\oscar\oicp-work\oicp`. Está escrito para ser autosuficiente.
>
> **Escrito el 2026-08-11 a las 23:55 UTC, tras una sesión de auditoría de nueve despliegues y
> tres recálculos.** Todo lo que afirma como verificado se comprobó ejecutando algo y leyendo la
> salida. Lo que NO está verificado está marcado como tal, y esa distinción es deliberada: la
> versión anterior de este archivo daba por buenas cosas que resultaron falsas y eso costó horas.

---

Retomo el OICP (Observatorio de Integridad de Contratación Pública del Ecuador). Soy Oscar,
abogado, no técnico: resuelve lo técnico tú y explícame en lenguaje llano.

**Queda muy poco por hacer y quiero que lo termines.** La sesión anterior cerró casi todo. Lo que
falta está especificado abajo con precisión suficiente para que no tengas que investigarlo otra
vez. Lo único que puede quedar pendiente al final es ampliar el volumen de Railway, porque eso
cuesta dinero y lo decido yo.

## Lee esto primero

1. `ESTADO.md` — el estado real, con las tres tandas del 11-ago al inicio.
2. `server/flag-engine.ts` — el motor de los 15 indicadores. Es la fuente de verdad de la
   metodología. Todo lo que se publica tiene que coincidir con él (regla 10).
3. `server/ocds-valor.ts` — pequeño, léelo entero: explica el defecto de lectura del presupuesto
   que es la causa del trabajo pendiente número 1.

## Accesos

- **Repo**: `C:\Users\oscar\oicp-work\oicp`, rama `main`, `github.com/OAOCH/oicp`. El push está
  autenticado y despliega solo: Railway observa el repo.
- **Producción**: https://oicp-production.up.railway.app — verifica con `/api/version` que el
  commit desplegado sea el tuyo, y con `/api/health`.
- **Conector MCP "oicp"**: 10 herramientas de solo lectura sobre producción. Úsalo para consultar
  datos reales.
- **Mi navegador Chrome con mi sesión activa** (`mcp__claude-in-chrome__*`): panel de
  administración, cualquier pantalla, y **mi cuenta de Lexis** en
  https://app.lexis.com.ec/sistema/inicio. Todo criterio que dependa de norma verifícalo ahí.
  Si Lexis se cae a la web pública, es que se cerró la sesión: pídemelo y vuelvo a entrar.
- **Token de sincronización**: archivo `.sync-token` en la raíz del repo. Es lo que autentica el
  barrido local contra producción (cabecera `x-sync-token`).

## Estado exacto, medido el 2026-08-11 23:50 UTC

Producción en **`dd1737a`**, health ok, **1 470 321 procesos**, corte de datos 2026-08-07,
**143 pruebas en verde**, typecheck y build limpios, árbol de trabajo limpio y todo subido.

Disparos por bandera tras los tres recálculos:

| | | | |
|---|---|---|---|
| IT-01 58 541 | TR-01 52 940 | IC-01 50 581 | TR-03 45 969 |
| IC-02 44 064 | CC-03 39 417 | IP-01 16 140 | CC-02 1 836 |
| CC-05 1 734 | IT-02 1 223 | TR-02 1 579 | CC-01 129 |
| CC-04 23 | **IP-02 5** | IP-03 0 (inactiva) | |

Riesgo: crítico **10 079**, alto **46 524**, moderado **78 008**, bajo **1 335 710**.
Los cuatro suman 1 470 321 exacto; si alguna vez no suman, algo se rompió.

---

# LO QUE FALTA

## 1. El rellenado de la fuente — hazlo primero, desbloquea al 2 y al 3

**El problema, ya diagnosticado y con la causa corregida.** La ingesta leía el presupuesto
referencial de `tender.value`, que el SERCOP publica **vacío** en muchos procesos, cuando el monto
vive en **`tender.lots[].value.amount`**. Resultado: **174 547 procesos (11,9%)** tienen el TEXTO
`"USD"` en el campo del monto en vez de una cifra. Se llegó a creer que el dato era irrecuperable
y **es falso**: la fuente sí lo publica.

Comprobado contra la API del SERCOP, cinco procesos de esa bolsa, cinco de cinco con
`tender.value` vacío y el monto en los lotes:

```
SIE-DD01D04S-2024-00003 ->  40 105,69     SIE-CELECEP-2024-04422 -> 536 037,63
SIE-GADMCG-2024-071     ->  26 057,94     SIE-EMAPAACEP-2024-015 ->  18 033,59
SIE-GADGIRON-2024-20    ->  16 812,60
```

La lectura ya está corregida en `server/ocds-valor.ts` y la usan los dos caminos de ingesta, así
que **todo lo que entre desde ahora trae su presupuesto**. Falta releer los 174 547 anteriores.

En la misma llamada viene **`tender.enquiryPeriod.endDate`**, que es la fecha desde la que corre
el término del Art. 96 del Reglamento. La columna `enquiry_deadline` ya existe y ya se mapea, pero
está en **0 de 1 470 321** filas porque solo se llena al ingerir. El mismo rellenado la llena.

### Cómo hacerlo, con la arquitectura ya investigada

**Railway NO puede llegar al SERCOP**: la API bloquea IPs de datacenter. Por eso existe
`server/local-sync.ts`, que corre en mi PC (tarea programada de Windows, martes y jueves 08:00) y
empuja a producción. El rellenado tiene que ir por ahí.

Lo que ya existe y puedes reutilizar tal cual:

- `POST /api/admin/ingest` con `{procs: [...]}`, máximo 500 por llamada. **Hace upsert por ocid**,
  así que sirve igual para reparar que para insertar. Autentica con `x-sync-token`.
- `POST /api/admin/ingest-finalize` con `{year}`: reconstruye concentración, re-evalúa banderas y
  sincroniza los agregados.
- `sercopFetch()` en `local-sync.ts`: ya tiene throttle de ~3 req/s y respeto del 429.
- `releaseToProc()` en `server/updater.ts`: convierte el release OCDS al formato de la tabla, y ya
  usa `valorReferencial()` y mapea `enquiry_deadline`.

Lo único que falta construir:

1. **Un endpoint nuevo** que devuelva una página de ocid a reparar. Algo como
   `POST /api/admin/ocids-a-reparar` con `{limite, desde}` que devuelva los ids donde
   `typeof(budget_amount) = 'text'` o `enquiry_deadline IS NULL`, ordenados por id para que el
   cursor sea estable. Autentícalo con `checkAuthOrSync`, igual que `/api/admin/ingest`.
2. **Un modo nuevo en `local-sync.ts`**, por ejemplo `--reparar`, que pida esa lista, traiga cada
   record de SERCOP, lo pase por `releaseToProc()` y lo empuje por `/api/admin/ingest` en lotes de
   500. Guarda cursor en un archivo, igual que `.sync-cursor.json`, para que sea resumible.
3. Al terminar cada año, `ingest-finalize`.

**Pruébalo con un lote chico primero** (100 o 200 ocid), comprueba con el MCP que esos procesos
pasaron de `typeof(budget_amount)='text'` a un número y que ya traen `enquiry_deadline`, y recién
ahí suéltalo sobre los 174 547.

**Cuánto tarda**: son ~174 mil peticiones a 3 por segundo, o sea **unas 16 horas**. No cabe en una
sesión de chat. Déjalo corriendo en mi PC como tarea y dime cómo verifico el avance; yo no ejecuto
comandos, así que déjamelo listo para que arranque solo o con un clic.

**Al terminar**: el recálculo. Con presupuestos nuevos, IP-02 puede pasar de 5 disparos a bastantes
más, y eso es correcto: hoy no dispara en esos procesos porque no tiene con qué comparar.

## 2. IT-01: decide conmigo y aplícalo

Los mínimos que usa IT-01 hoy (9/13/17 días hábiles) **no corresponden a lo que mide**. Verificado
en Lexis sobre el texto vigente del Reglamento (Decreto Ejecutivo 193, R.O. Noveno Suplemento 153
de **28-oct-2025**, última reforma 30-jul-2026):

> «Art. 96.- **Términos para la entrega de ofertas.**- De conformidad al presupuesto referencial
> del procedimiento, la entidad contratante, para establecer la fecha límite de entrega de ofertas
> técnicas, observará los términos previstos a continuación, **contados a partir de fenecer la
> fecha límite para contestar respuestas y aclaraciones**»

Tres cosas de ahí:

- El término **no arranca en la publicación**, arranca al cerrar el período de preguntas. Ese dato
  es `enquiry_deadline`, que tendrás después del punto 1.
- La tabla de plazos está en un anexo que Lexis no renderiza: «ver Registro Oficial Suplemento 153
  de 28 de octubre de 2025, página 69». **Tienes que abrir ese Registro Oficial y leer la tabla.**
  No la inventes ni la copies de un resumen.
- El Reglamento es de octubre de 2025, así que aplicar esos mínimos a procesos de 2019 a 2025 es un
  anacronismo que un auditor va a marcar.

**Tráeme dos opciones en pocas líneas y yo elijo**, sin bloquear el resto del trabajo:
(A) declarar IT-01 como indicador referencial de plazo corto, manteniendo los disparos actuales y
diciendo con claridad que no reproduce el término del Art. 96; o (B) aplicar el término real solo
desde el 28-oct-2025 con el dato de `enquiry_deadline`, y declarar los años anteriores como no
evaluables por ese criterio.

## 3. El día inicial del cómputo (COA Art. 158)

El Código Orgánico Administrativo dispone que los términos corren «a partir del día hábil
siguiente» y hoy `businessDays()` cuenta el día inicial. **Está así a propósito**: cambiarlo mueve
el significado de los mínimos de IT-01, así que se resuelve junto con el punto 2, no antes.

Los feriados **ya se descuentan** desde el 11-ago-2026, con el calendario del Art. 65 del Código
del Trabajo verificado textualmente en Lexis. Eso ya está hecho; no lo rehagas.

## 4. Verificar CC-01 ejecutando el motor

CC-01 (129 disparos) está verificada **por predicado SQL** (un par con 6 ínfimas ≥5, montos que
cuadran al centavo) pero **no re-ejecutada con el motor real y su contexto de concentración**. Las
otras cuatro CC sí. Ciérralo así:

- Usa el arnés que ya existe: `server/verificar-lote.mjs`. Se ejecuta con
  `npx tsx server/verificar-lote.mjs archivo.json` y compara, proceso por proceso, lo que produce
  el motor real contra lo que la plataforma tiene guardado.
- El archivo es un array de procesos con el campo `esperadas` (códigos activos separados por coma)
  y, para las CC-*, un campo `concentracion` con las filas de `concentration_index` de **todos los
  proveedores y todos los años de ese comprador**. Si el contexto viene incompleto, el resultado
  es falso: elige compradores chicos o pagina.
- Busca procesos con CC-01 así: `WHERE source_year = X AND flags LIKE '%CC-01%' AND
  json_array_length(suppliers) = 1`.

---

# Trampas que ya costaron tiempo. Léelas antes de tocar nada

1. **El panel de administración tiene un `confirm()` nativo que la automatización descarta sola.**
   Hacer clic por coordenadas no hace nada y el botón se queda en «Ejecutar» sin dar error. Hay que
   ejecutar `window.confirm = () => true` con `javascript_tool` y luego invocar el handler.
2. **No selecciones la tarjeta del panel por texto.** Un selector tipo
   `querySelectorAll('div').find(d => d.textContent.includes('Re-normalizar'))` agarra el
   contenedor de las TRES tarjetas y su primer botón es «Reparar budget_amount». Así se ejecutó por
   error la operación equivocada. Lo seguro: filtrar los botones cuyo texto sea exactamente
   `Ejecutar`, subir por el DOM hasta el ancestro que contenga UNA sola vez esa palabra, y
   **verificar el rótulo antes de hacer clic, abortando si no coincide**. El índice 2 es el bueno.
3. **El recálculo corta con `upstream error` a los 300 s y el trabajo SIGUE.** Nunca concluyas por
   la respuesta HTTP. Señal real de que terminó: `/api/version` vuelve a responder rápido (durante
   el trabajo tarda 4-8 s, después 0,5-1,5 s) y las cifras de `a_flag_year` dejan de moverse. Dura
   entre 5 y 11 minutos. **Captura la línea base con `oicp_flag_stats` antes de correrlo.**
4. **`oicp_sql` tiene un tope de 300 filas, pero se pagina con `LIMIT ... OFFSET`.** Está probado.
   Y desde el 11-ago el campo `truncado` **por fin dice la verdad**: antes salía siempre `false`
   aunque devolviera 300 de 11 430. Si ves `truncado: true`, hay más filas y no puedes sacar
   conclusiones de lo que recibiste.
5. **El tope de costo de `oicp_sql` rechaza recorridos completos y auto-joins.** Filtra por columna
   indexada (`id`, `buyer_id`, `source_year`, `risk_level`, `score`, `published_date`, `status`,
   `procurement_method_details`) o usa los agregados `a_*`. Para cruzar una tabla consigo misma,
   usa una función de ventana en vez de un JOIN.
6. **174 547 procesos tienen el TEXTO `"USD"` en `budget_amount`.** Cualquier código que evalúe
   banderas tiene que normalizar con `Number(...) || 0` antes, como hace `updater.ts`. Sin eso, la
   cadena es *truthy* en JavaScript y TR-01 deja de marcar el valor como faltante. El arnés de
   verificación tuvo ese defecto y producía discrepancias falsas.
7. **Lexis**: el buscador es de palabras, no de códigos. Buscar «RE-SERCOP-2025-0152» da cero
   resultados; buscar el nombre de la norma sí. Dentro de una norma, la pestaña **Art** tiene un
   campo de número de artículo, y la pestaña **Afectación** trae el historial de reformas con sus
   fechas. Lexis **no indexa las resoluciones del SERCOP**: esas están en
   `portal.compraspublicas.gob.ec`, y sus PDF llevan capa de texto que `WebFetch` no extrae pero un
   script de Node que infle los streams del PDF sí.

# Reglas que no quiero repetir

1. **Typecheck, pruebas y build limpios ANTES de cada push, y verificación en producción después.**
   Encadena los comandos de forma que aborten si una compuerta falla.
2. **NO hagas push mientras un recálculo esté corriendo**: el despliegue reinicia el servidor y lo
   mata. Espera a que termine.
3. **Hay un usuario externo real.** Nada puede romperse para él.
4. **Ninguna cifra sin verificar.** Si la afirmas, mídela. En la sesión anterior se publicó «524»
   cuando eran 525, y el recálculo lo confirmó al restar exactamente 525.
5. **Escribe pruebas de cada corrección.** Y que la prueba compruebe lo que su nombre promete: el
   defecto del aviso de truncamiento sobrevivió porque la prueba se llamaba «avisa cuando trunca» y
   solo verificaba el largo de la respuesta.
6. **Regla 10**: si cambias una regla, umbral o peso en `flag-engine.ts`, actualiza en el MISMO
   commit `client/src/pages/Methodology.tsx` y el objeto `METHODOLOGY` de `mcp-server.ts`.
7. **Regla 11**: una sola definición de cada cosa. Ya lo cumplen `MONTO_SQL`/`montoPlausible()`,
   `SQL_ES_INFIMA_POR_MONTO`/`isInfimaByAmount()` y `valorReferencial()`. Si duplicas una
   definición, el defecto va a estar en las dos copias, que es exactamente lo que pasó con el
   presupuesto.
8. **No me pases tareas de terminal.** Yo solo doy el OK inicial y las decisiones de negocio.
9. **NUNCA pruebes escrituras contra producción.** En la sesión anterior un subagente lanzó
   `DELETE`, `UPDATE` y `DROP TABLE` contra la base real para "probar las defensas". Las defensas
   aguantaron y no se perdió nada, pero esa prueba va contra una base de prueba.
10. Si usas subagentes, **fija `model` explícito** y ten en cuenta que pueden chocar con el límite
    de sesión. Un resultado de verificación vacío nunca es una aprobación.

# Qué está verificado y qué no

**Verificado ejecutando algo y leyendo la salida**: las cuatro correcciones de metodología con la
regla 10 en las tres superficies · la definición única de ínfima · las citas OCP contra el PDF
oficial de la guía 2024 · el umbral de ínfima del 7-jul-2025 contra la Resolución
R.E-SERCOP-2025-0152 · el Art. 50 de la LOSNCP y el Art. 65 del Código del Trabajo en Lexis · los
feriados contra el calendario que Ecuador observó de verdad · el descuento por correlación
(IC-02+TR-03 co-ocurre en el 96%) · tres recálculos con sus invariantes · **100 procesos reales
re-evaluados con el motor real, 0 discrepancias** · CC-02, CC-03, CC-04 y CC-05 · nueve pantallas
en caliente · las 10 herramientas del MCP.

**NO verificado, y no lo des por bueno**: CC-01 por ejecución del motor (ver punto 4) · la tabla de
plazos del Art. 96, que está en un anexo del Registro Oficial que nadie ha abierto · el
comportamiento de la plataforma después del rellenado, que habrá que volver a comprobar.

Empieza por leer `ESTADO.md`, dime en pocas líneas qué encontraste y cuál es tu plan, y arranca por
el punto 1.
