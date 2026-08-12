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

## 2. IT-01: decisión de Oscar, pendiente

**La tabla del Art. 96 ya está verificada en fuente primaria** (Registro Oficial Noveno Suplemento
153 de 28-oct-2025, página 69, extraída del PDF oficial y contrastada con una copia independiente y
con Lexis). El Decreto Ejecutivo 461 **no** la reformó, ni la fe de erratas, ni los decretos 295 y
356:

| Presupuesto referencial (USD) | Término mínimo |
|---|---|
| Superior a 10.000 hasta 100.000 | No menor a 2 días |
| Superior a 100.000 hasta 500.000 | No menor a 4 días |
| Superior 500.000 a 1.000.000 | No menor a 6 días |
| 1´000.000 en adelante | No menor a 10 días |

Son **términos** (días hábiles). La tabla **empieza en «superior a 10.000»**: por debajo no hay
término asignado.

**El problema, medido:** el término legal **no es reproducible con los datos abiertos**.

- Arranca «al fenecer la fecha límite para contestar respuestas y aclaraciones». La API publica
  `tender.enquiryPeriod.endDate`, que es la fecha límite para **preguntar**, no para responder;
  entre una y otra median de 2 a 6 días (Art. 91).
- El otro extremo tampoco: `tender.tenderPeriod.endDate` **viene vacío en el 93%** de los procesos.
- Por eso IT-01 solo evalúa **106 249 de 1 470 321 procesos (7,2%)** y dentro de ese universo marca
  **58 541, el 55,1%**, con mínimos de 9/13/17 días que no salen de ninguna norma.

Las opciones que se le plantearon a Oscar están en el historial de la sesión del 12-ago. **No
apliques ninguna sin su decisión.** Y ojo: el Art. 96 usa el **presupuesto referencial**, así que
cualquier opción depende del rellenado del punto 1.

## 3. El día inicial del cómputo (COA Art. 158)

`businessDays()` cuenta el día inicial y el COA manda contar «a partir del día hábil siguiente», así
que **sobreestima el término en un día**. Está así **a propósito**: cambiarlo mueve el significado
de los mínimos de IT-01, así que se resuelve junto con el punto 2, no antes. Los feriados del
Art. 65 **ya se descuentan** desde el 11-ago-2026 y eso está verificado; no lo rehagas.

## 4. Ampliar el volumen de Railway

Cuesta dinero y **lo decide Oscar**. El respaldo sigue sin poder correr por espacio.

---

# Trampas que ya costaron tiempo. Léelas antes de tocar nada

1. **`/api/admin/ingest` NO repara: SALTA los ocid que ya existen** (`updater.ts`, `ingestProcs`).
   La versión anterior de este archivo afirmaba que hacía upsert. Para reparar existe
   `/api/admin/reparar`, que escribe SOLO `budget_amount` y `enquiry_deadline`.
2. **El mapeo OCDS vive en `server/ocds-proc.ts` y en ningún otro sitio.** Estuvo duplicado en
   `updater.ts` y en `local-sync.ts`, se corrigió solo uno, y el otro es el ÚNICO que llega al
   SERCOP (Railway tiene la IP bloqueada). Hay una prueba que falla si alguien vuelve a copiarlo.
3. **Un limitador de tasa del tipo «espera desde la última petición» se rompe con concurrencia.**
   Medido: 12 emisiones en 50 ms donde el correcto tarda 449 ms. Usa `server/limitador.ts`, que
   RESERVA el turno, y recuerda que un 429 tiene que frenar a TODOS los hilos.
4. **La API del SERCOP es LENTA (p50 7-12 s) pero eso no es límite de tasa.** La concurrencia
   multiplica el rendimiento. **No existe descarga masiva usable**: `/api/records` ignora el filtro
   por año y fija `per_page` en 15 (184 930 peticiones, ~95 GB). Ya está comprobado, no lo repitas.
5. **El panel de administración tiene un `confirm()` nativo que la automatización descarta sola.**
   Hay que ejecutar `window.confirm = () => true` con `javascript_tool` y luego invocar el handler.
   **No selecciones la tarjeta por texto**: un selector por `textContent` agarra el contenedor de
   las TRES tarjetas y su primer botón es «Reparar budget_amount». Filtra los botones cuyo texto sea
   exactamente `Ejecutar`, sube al ancestro que contenga UNA sola vez esa palabra, y **verifica el
   rótulo antes de hacer clic**. El índice 2 es el bueno.
6. **El recálculo corta con `upstream error` a los 300 s y el trabajo SIGUE.** Nunca concluyas por
   la respuesta HTTP. Señal real: `/api/version` vuelve a responder rápido y las cifras de
   `a_flag_year` dejan de moverse.
7. **`oicp_sql` tiene un tope de 300 filas, se pagina con `LIMIT ... OFFSET`, y el campo `truncado`
   dice la verdad.** El tope de costo rechaza recorridos completos y auto-joins: filtra por columna
   indexada (`id`, `buyer_id`, `source_year`, `risk_level`, `score`, `published_date`, `status`,
   `procurement_method_details`) o usa los agregados `a_*`. Para cruzar una tabla consigo misma, usa
   una función de ventana.
8. **Mientras queden procesos con el TEXTO `"USD"` en `budget_amount`**, todo código que evalúe
   banderas tiene que normalizar con `Number(...) || 0` antes. Sin eso la cadena es *truthy* y TR-01
   deja de marcar el valor como faltante.
9. **Lexis**: el buscador es de palabras, no de códigos. La pestaña **Art** tiene campo de número de
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

**Verificado ejecutando algo y leyendo la salida**: el rellenado de punta a punta (119 pedidos, 119
reparados, 0 fallos, y el tramo procesado sin un solo `"USD"`) · **CC-01 con el motor real, 103
procesos y 0 discrepancias, con control positivo y negativo** · la tabla del Art. 96 contra el PDF
oficial del Registro Oficial · que el DE 461 no la reformó, rastreando las cuatro afectaciones
posteriores · el régimen recomputado (627 834 filas, 2025 partido en 142 464 / 30 746 en el corte
exacto) · 0 proveedores sin nombre útil · las 10 herramientas del MCP, con la serie anual de CNT
sumando su total al centavo · 174 pruebas en verde · el limitador contra la reproducción literal del
código roto.

**NO verificado, y no lo des por bueno**: el comportamiento de la plataforma DESPUÉS de que el
rellenado termine (hay que volver a medirlo todo) · los 60 disparos de CC-01 que quedaron fuera de
la muestra · si existe una vía pública y automatizable para las dos fechas del Art. 96.

Empieza por leer `ESTADO.md`, mira el avance del rellenado, dime en pocas líneas qué encontraste y
cuál es tu plan.
