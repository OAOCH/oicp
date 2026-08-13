# Prompt para la siguiente sesión del OICP

> Copia TODO lo que está debajo de la línea y pégalo como primer mensaje de una sesión nueva
> abierta en `C:\Users\oscar\oicp-work\oicp`. Está escrito para ser autosuficiente.
>
> **Escrito el 2026-08-12.** Todo lo que afirma como verificado se comprobó ejecutando algo y
> leyendo la salida. Lo que NO está verificado está marcado como tal, y esa distinción es
> deliberada: **la versión anterior de este archivo daba por buenas dos cosas que resultaron
> falsas, y cada una por separado bastaba para que 16 horas de trabajo no repararan ni una fila.**

---

Retomo el OICP (Observatorio de Integridad de Contratación Pública del Ecuador). Soy Oscar,
abogado, no técnico: resuelve lo técnico tú y explícame en lenguaje llano.

## Lo primero: el rellenado YA TERMINÓ, y hay otro trabajo de fondo corriendo

**El rellenado de presupuestos está hecho y verificado.** 173 250 procesos reparados en 27,7
minutos por los volcados masivos del SERCOP. `con_texto_usd` está en **0 en los ocho años**,
`enquiry_deadline` pasó de 0 a **154 682**, y el reflag movió **92 506** procesos. No hay que
volver a correrlo; la tarea diaria lo comprueba y sale enseguida si no hay nada.

**Lo que SÍ está corriendo es el índice del SOCE**, que trae las dos fechas del Art. 96:

- Tarea de Windows **«OICP Indice SOCE Art96»**, diaria a las 22:00, hasta 11 h por corrida.
- Va de lo más nuevo hacia atrás, a ~1,6 peticiones por segundo. Reanudable por
  `.soce-cursor.json`. Se puede apagar el equipo sin perder nada.
- Es un trabajo de varios días. **Verifica el avance en `indice-soce.log`**: la línea de progreso
  trae `aplicadas`, que es lo que importa.
- **IT-01 se va activando solo** según ese índice se llena: no hay que tocar el motor.

Y para el presupuesto, la verificación sigue siendo:
`https://oicp-production.up.railway.app/api/admin/avance-reparacion?fresco=1`

## Lee esto primero

1. `ESTADO.md` — el estado real. La sección del 2026-08-12 va primero.
2. `server/flag-engine.ts` — el motor de los 15 indicadores. Es la fuente de verdad de la
   metodología. Todo lo que se publica tiene que coincidir con él (regla 10).
3. `server/ocds-proc.ts` — el mapeo OCDS → fila, en UNA sola definición. Léelo entero: explica por
   qué existe.

## Accesos

- **Repo**: `C:\Users\oscar\oicp-work\oicp`, rama `main`, `github.com/OAOCH/oicp`. El push está
  autenticado y despliega solo: Railway observa el repo.
- **Producción**: https://oicp-production.up.railway.app — verifica con `/api/version` que el
  commit desplegado sea el tuyo, y con `/api/health`.
- **Conector MCP "oicp"**: 10 herramientas de solo lectura sobre producción.
- **Mi navegador Chrome con mi sesión activa** (`mcp__claude-in-chrome__*`): panel de
  administración, cualquier pantalla, y **mi cuenta de Lexis** en
  https://app.lexis.com.ec/sistema/inicio.
- **Token de sincronización**: archivo `.sync-token` en la raíz (cabecera `x-sync-token`).

---

# LO QUE FALTA

## 1. El índice del SOCE, que es lo único grande que sigue en marcha

Corre solo. Lo que hay que vigilar es que **`aplicadas` suba** en `indice-soce.log`. Si se queda en
cero corrida tras corrida, el problema es el cruce, no el barrido: revisa que la fecha límite de
preguntas del portal esté coincidiendo con `enquiry_deadline`.

Cuando la cobertura sea apreciable, **vuelve a medir IT-01**: los procesos que pasen al régimen (A)
se evalúan contra el término legal y su detalle empieza por «Art. 96:». Captura la línea base con
`oicp_flag_stats` antes de cada recálculo y comprueba después que los cuatro niveles de riesgo
siguen sumando 1 470 321 exacto.

## 2. IT-01: DECIDIDO, implementado, y activándose solo

**La tabla del Art. 96 está verificada en fuente primaria** (Registro Oficial Noveno Suplemento 153
de 28-oct-2025, página 69, extraída del PDF oficial y contrastada con una copia independiente y con
Lexis). Ni el Decreto Ejecutivo 461, ni la fe de erratas, ni los decretos 295 y 356 la reformaron:

| Presupuesto referencial (USD) | Término mínimo |
|---|---|
| Superior a 10.000 hasta 100.000 | No menor a 2 días |
| Superior a 100.000 hasta 500.000 | No menor a 4 días |
| Superior 500.000 a 1.000.000 | No menor a 6 días |
| 1´000.000 en adelante | No menor a 10 días |

Son **términos** (días hábiles). La tabla **empieza en «superior a 10.000»**: por debajo no hay
término asignado y esos procedimientos no se evalúan por este criterio.

**Decisiones de Oscar del 12-ago-2026, ya implementadas, no hay que volver a preguntarlas:**
(a) hacer el barrido completo del índice del SOCE; (b) en Régimen Especial, la «Audiencia de
Preguntas y Aclaraciones» **sí cuenta** como el hito del Art. 96.

El motor ya tiene los dos regímenes y **el (A) se activa solo** según el índice se llena:

- **(A) término legal**, solo desde el 28-oct-2025 y solo con `answer_deadline` y
  `submission_deadline`. Días hábiles desde el día SIGUIENTE al cierre de respuestas (COA Art. 158)
  y sin feriados (Art. 159). Su detalle empieza por «Art. 96:».
- **(B) referencial** en el resto: publicación → cierre de ofertas contra 9/13/17, mínimos que no
  salen de ninguna norma, y **el detalle lo dice expresamente**.

## 3. El día inicial del cómputo (COA Art. 158): resuelto donde importa

En el **término legal del Art. 96** ya se cuenta desde el día hábil siguiente, como manda el COA
Art. 158, con `terminoEnDiasHabiles()`. En la **regla referencial** se sigue contando el día inicial
a propósito, porque sus mínimos de 9/13/17 se calibraron así y cambiarlo movería su significado sin
ganar nada: esa regla ya se publica declarando que no reproduce ningún término legal. Los feriados
del Art. 65 se descuentan en las dos desde el 11-ago-2026; no lo rehagas.

## 4. Ampliar el volumen de Railway

Cuesta dinero y **lo decide Oscar**. El respaldo sigue sin poder correr por espacio.

---

# Trampas que ya costaron tiempo. Léelas antes de tocar nada

0. **Si una cifra del OICP se ve vieja, mira el TOTAL antes de depurar el servidor.** Si los
   niveles de riesgo suman 1 460 511 (o el corte dice 2026-05-14 o 2026-07-11), NO es un bug de
   producción: es el «gemelo», una copia local congelada de julio que algún dispositivo todavía
   tiene registrada como MCP junto al conector remoto. Ya reapareció TRES veces (la última, el
   13-ago: una investigación desde el chat mezcló las dos fuentes y reportó `oicp_info`
   «desactualizado» con 16 405 críticos = los 16 407 de scratch.db ± la deriva documentada de ±2).
   El código de producción consulta en vivo y no puede servir eso.
0b. **Toda tabla derivada necesita deltas en TODAS las vías de mutación Y un control en la
   boleta.** `a_supplier_critical` sirvió scores viejos por el MCP porque su mantenimiento estaba
   anidado bajo «solo si cambió el nivel». Si creas un agregado nuevo: (1) generarlo en
   buildAnalytics, (2) mantenerlo en patchAggregatesForNew Y en reflagChanged, (3) añadirlo a
   TABLAS_CHICAS del guardián o oicp_sql no podrá leerlo, y (4) control en verificar-anio.ts.
   Cada paso de esa lista se olvidó una vez y costó un ciclo entero de despliegue.
0c. **`/api/admin/build-analytics` es SÍNCRONO y NO se puede hacer push mientras corre**: el
   redespliegue mata la regeneración a mitad, con los DROP ya hechos. Regla 2 aplicada también a
   esto. Primero aterrizan todos los commits, después se regenera.

1. **`/api/admin/ingest` NO repara: SALTA los ocid que ya existen** (`updater.ts`, `ingestProcs`).
   La versión anterior de este archivo afirmaba que hacía upsert. Para reparar existe
   `/api/admin/reparar`, que escribe SOLO `budget_amount` y `enquiry_deadline`.
2. **El mapeo OCDS vive en `server/ocds-proc.ts` y en ningún otro sitio.** Estuvo duplicado en
   `updater.ts` y en `local-sync.ts`, se corrigió solo uno, y el otro es el ÚNICO que llega al
   SERCOP (Railway tiene la IP bloqueada). Hay una prueba que falla si alguien vuelve a copiarlo.
3. **Un limitador de tasa del tipo «espera desde la última petición» se rompe con concurrencia.**
   Medido: 12 emisiones en 50 ms donde el correcto tarda 449 ms. Usa `server/limitador.ts`, que
   RESERVA el turno, y recuerda que un 429 tiene que frenar a TODOS los hilos.
4. **SÍ existe descarga masiva, y no está documentada.** `/PLATAFORMA/download?type=json&year=YYYY&month=0&method=all`
   entrega el año entero en un ZIP, y `/PLATAFORMA/get-totals` dice cuántos releases debería traer,
   que es la comprobación de completitud. Medido: **todo el corpus en ~28 minutos y 8 peticiones**,
   contra ~54 horas y 174 547 peticiones yendo uno por uno. Esa ruta **no devolvió ni un 429**.
   Lo que NO sirve es `/api/records`, que ignora el filtro por año y fija `per_page` en 15
   (184 930 peticiones, ~95 GB): ya está comprobado, no lo repitas.
   Leer esos ficheros tiene **cuatro trampas, todas con prueba en `bulk-sercop.test.ts`**: no se
   puede `JSON.parse` el contenido (1,54 GB en claro), no se puede partir por líneas (hay años en
   una sola línea), no se puede usar `toString('utf8')` por trozo (parte los caracteres) y no se
   puede contar llaves a secas (el volcado de 2020 trae una comilla sin escapar). Y el lector
   necesita control de flujo real: sin él muere solo cuando el consumidor se detiene a empujar.
5. **La API `record?ocid=` es LENTA (p50 7-12 s) y eso NO es límite de tasa.** La concurrencia
   multiplica el rendimiento; el límite es de EMISIÓN. Sirve para reparar unos pocos procesos
   sueltos, no para barridos grandes.
6. **El panel de administración tiene un `confirm()` nativo que la automatización descarta sola.**
   Hay que ejecutar `window.confirm = () => true` con `javascript_tool` y luego invocar el handler.
   **No selecciones la tarjeta por texto**: un selector por `textContent` agarra el contenedor de
   las TRES tarjetas y su primer botón es «Reparar budget_amount». Filtra los botones cuyo texto sea
   exactamente `Ejecutar`, sube al ancestro que contenga UNA sola vez esa palabra, y **verifica el
   rótulo antes de hacer clic**. El índice 2 es el bueno.
7. **El recálculo corta con `upstream error` a los 300 s y el trabajo SIGUE.** Nunca concluyas por
   la respuesta HTTP. Señal real: `/api/version` vuelve a responder rápido y las cifras de
   `a_flag_year` dejan de moverse.
8. **`oicp_sql` tiene un tope de 300 filas, se pagina con `LIMIT ... OFFSET`, y el campo `truncado`
   dice la verdad.** El tope de costo rechaza recorridos completos y auto-joins: filtra por columna
   indexada (`id`, `buyer_id`, `source_year`, `risk_level`, `score`, `published_date`, `status`,
   `procurement_method_details`) o usa los agregados `a_*`. Para cruzar una tabla consigo misma, usa
   una función de ventana.
9. **Ya no queda ningún proceso con el TEXTO `"USD"` en `budget_amount`** (verificado: 0 en los ocho
   años), pero **no quites la normalización con `Number(...) || 0`** de `updater.ts` ni del arnés
   `verificar-lote.mjs`. Es lo que impide que una cadena vuelva a colarse como monto: en JavaScript
   una cadena es *truthy*, así que sin eso TR-01 dejaría de marcar el valor como faltante y nadie
   se daría cuenta.
10. **Lexis**: el buscador es de palabras, no de códigos. La pestaña **Art** tiene campo de número de
   artículo y la pestaña **Afectación** trae el historial de reformas. Lexis **no indexa las
   resoluciones del SERCOP** ni renderiza los anexos con tablas: esas van del PDF oficial del
   Registro Oficial, extraído con Node (y si el PDF es un escaneo con máscara CCITTFax, con PDFium).

# Reglas que no quiero repetir

1. **Typecheck, pruebas y build limpios ANTES de cada push, y verificación en producción después.**
   Encadena los comandos de forma que aborten si una compuerta falla.
2. **NO hagas push mientras un recálculo esté corriendo**: el despliegue reinicia el servidor y lo
   mata. El rellenado normal sí tolera un redespliegue (reintenta), el reflag no.
3. **Hay un usuario externo real.** Nada puede romperse para él.
4. **Ninguna cifra sin verificar, y ninguna cifra clavada.** Si la afirmas, mídela; y si la
   publicas y puede cambiar, que se mida al responder. Ya pasó dos veces: «524» cuando eran 525, y
   «174.547 sin presupuesto» escrito a mano en tres superficies mientras el rellenado lo bajaba.
5. **Escribe pruebas de cada corrección**, y que la prueba compruebe lo que su nombre promete.
   Comprueba que falla SIN el arreglo: una prueba que pasa con el defecto puesto no prueba nada.
6. **Regla 10**: si cambias una regla, umbral o peso en `flag-engine.ts`, actualiza en el MISMO
   commit `client/src/pages/Methodology.tsx` y el objeto `METHODOLOGY` de `mcp-server.ts`. Y **lee
   la página renderizada**: la contradicción de los feriados sobrevivió a varias revisiones del
   código y se vio en pantalla en dos minutos.
7. **Regla 11**: una sola definición de cada cosa. Ya lo cumplen `MONTO_SQL`/`montoPlausible()`,
   `SQL_ES_INFIMA_POR_MONTO`/`isInfimaByAmount()`, `valorReferencial()`, `releaseToProc()`,
   `estadoPresupuesto()` y `nombreVisible()`.
8. **No me pases tareas de terminal.** Yo solo doy el OK inicial y las decisiones de negocio.
9. **NUNCA pruebes escrituras contra producción.** Reparar datos es el trabajo encargado; probar
   defensas con `DELETE`/`DROP` va contra una base de prueba.
10. Si usas subagentes, **fija `model` explícito**. Un resultado de verificación vacío nunca es una
    aprobación.

# Qué está verificado y qué no

**Verificado ejecutando algo y leyendo la salida**: el rellenado COMPLETO (173 250 procesos
reparados en 27,7 min, `con_texto_usd` en 0 en los ocho años, `enquiry_deadline` de 0 a 154 682, el
reflag moviendo 92 506 procesos y los cuatro niveles de riesgo sumando 1 470 321 exacto) · los ocho
volcados cuadrando contra `get-totals` · la cadena completa en un proceso con nombre
(`SIE-CELECEP-2024-04422`: presupuesto 536 037,63, régimen corregido, y TR-01 pasando de «Faltan:
valor, proveedor» a «Faltan: proveedor») · **CC-01 con el motor real, 103
procesos y 0 discrepancias, con control positivo y negativo** · la tabla del Art. 96 contra el PDF
oficial del Registro Oficial · que el DE 461 no la reformó, rastreando las cuatro afectaciones
posteriores · el régimen recomputado (627 834 filas, 2025 partido en 142 464 / 30 746 en el corte
exacto) · 0 proveedores sin nombre útil · las 10 herramientas del MCP, con la serie anual de CNT
sumando su total al centavo · 174 pruebas en verde · el limitador contra la reproducción literal del
código roto.

**NO verificado, y no lo des por bueno**: los 60 disparos de CC-01 que quedaron fuera de la
muestra · la cobertura que alcanzará el índice del SOCE, que solo se sabrá corriéndolo · el efecto
de IT-01 en régimen (A) sobre las cifras publicadas, que no se puede medir hasta que haya
`answer_deadline` en un número apreciable de procesos · los ~500 procesos de la lista de reparación
que no aparecieron en ningún volcado.

Empieza por leer `ESTADO.md`, mira el avance del rellenado, dime en pocas líneas qué encontraste y
cuál es tu plan.
