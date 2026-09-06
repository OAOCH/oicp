# ESTADO — actualizado 2026-09-05

## 2026-09-05 (tarde y noche) — los volcados se bajan por rangos en paralelo; OFERENTES CARGADOS 2019-2026; la base tiene un hueco en 2025-2026

**Diagnóstico medido, no supuesto.** El vigilante de la noche midió 48 veces entre las 21:00 del
4-sep y las 11:28: 0-46 KB/s por conexión, nunca los 150 exigidos; abortó a las 11:42. La PC baja a
41 MB/s desde un host neutro, así que el cuello es del SERCOP; y el freno es POR CONEXIÓN, no por
franja horaria: 1 conexión 2-20 KB/s · 4 → 41 · 8 → 78-93 · 16 → 150 KB/s, con `Range` aceptado
(206) en los ocho volcados anuales (90-164 MB; 1,05 GB en total). Las conexiones sueltas mueren
además con `terminated` (una de un solo flujo murió a los 585 KB). «Reintentar en otra franja» no
podía funcionar: el vigilante v3 de la tarde siguió midiendo 0-7 KB/s por conexión y 57-93 con ocho.

**Hecho (commits `d3a3cb6`, `029944b` y `7590e0e`, cada uno verificado en `/api/version`).**
`descargarPorRangos()` en `server/bulk-sercop.ts` y el flag `--conexiones N` (tope 32) en
`local-sync.ts` para `--participaciones` y `--reparar-masivo`; con 1 conexión el camino de siempre
queda intacto. Política común por petición, sondeo incluido: un 429 frena a TODAS las conexiones
(lección de `limitador.ts`) y un 403 aborta sin reintentar ni por trozo ni por año, porque la IP de
la PC es la única que lee la fuente. 10 pruebas nuevas con un servidor local de rangos, verificadas
en ROJO y por MUTACIÓN (quitar una guarda tumba exactamente su prueba: cuenta de bytes, freno
compartido, Content-Range corrido, 403). Revisión adversarial con Sonnet (3 lentes + un escéptico
por hallazgo): 4 hallazgos confirmados y corregidos ANTES del commit (el sondeo no reintentaba y
disfrazaba un 429 de «no acepta rangos»; `repararMasivo` no cortaba ante un 403; dos pruebas las
aprobaba el transporte y no la guarda). Verificado contra la fuente real: volcado mensual 2026-08
con 8 conexiones en 13 trozos, tamaño exacto (3 358 921 bytes), CRC32 declarado por el ZIP igual al
del contenido inflado, y prefijo de 585 767 bytes idéntico al de una descarga de un solo flujo. El
lector leyó 5 420 releases frente a 5 457 declarados: misma clase de diferencia que las de 1 y 22 de
agosto con descargas de un solo flujo, o sea el contador de la fuente, no la descarga.

**Dos defectos que solo salieron en la carga real, corregidos sobre la marcha (commits `029944b` y
`7590e0e`, pruebas en rojo primero):** (1) a las 13:47, con 2019 al 93 %, un trozo falló seis veces
seguidas con `terminated` y el descargador tiró 111 MB y 45 minutos; ahora los trozos verificados se
apuntan en `<destino>.partes.json` (url, total, trozo y Last-Modified) y la siguiente llamada solo pide
lo que falta, con diez intentos por trozo y espera creciente hasta 60 s; en 2021, 2023 y 2024 el último
trozo tardó 13 minutos en ráfagas de cortes y ningún año se perdió. (2) A las 15:55, con 2022
descargado, `MCO-GADC-1752UE-2022-2616` (menor cuantía de obras: cientos de invitados) llevó el búfer
por encima de las 2 000 filas que acepta `ingest-participaciones`; el 400 se reintentaba en vano, el
búfer nunca se vaciaba y el año se perdía en silencio; ahora el tope vive en `server/lotes.ts` (el
endpoint lo importa) y el cliente parte SIEMPRE el búfer con `lotesDe` en lotes de 1 500. Además el
DNS de compraspublicas.gob.ec dejó de responder de 16:16 a ~16:30 (la red de la PC estaba bien): el
sondeo del año reintentó y siguió solo.

**Carga de oferentes HECHA (13:54 → 20:32, 16 conexiones, salida en `participaciones.log`).** Los ocho
volcados cuadran contra la fuente: 2019 275 055 / 2020 160 676 / 2021 167 058 / 2022 212 324 /
2023 217 913 / 2024 219 185 (declarados 219 186) / 2025 189 291 / 2026 92 055 releases. Procesos con
oferentes publicados: 279 734; participaciones enviadas: 1 448 765, que es EXACTAMENTE lo que
`participaciones-finalize` reportó en el agregado (`{"participantes":66867,"participaciones":1448765}`).
Los conteos por año en producción (`oicp_sql` sobre `participaciones`) coinciden fila a fila con lo
enviado (2019: 139 889 filas, 38 642 procesos, 38 584 con ganador). `oicp_oferentes` sin argumentos
ya da el ranking (Solís Guevara Silvia Jeannette: 4 447 participaciones, 238 ganadas, 4 209 perdidas,
pierde 72 veces frente a Mendoza Párraga; Cuenca Yépez, Britpharma y Representaciones Molina Herrera
pierden sobre todo frente a Laboratorio Vida) y con un RUC da el perfil con sus derrotas recientes.

**Boletas 2025 y 2026: 13 de 14 controles APROBADOS; el 14.º (`participantes`) FALLA y tiene razón.**
2025: «3 participaciones apuntan a procesos que no existen»; 2026: «10 739». No es un defecto de los
oferentes: es que la base NO tiene esos procesos. Medido con `a_risk_year` contra los volcados: 2019 a
2024 coinciden EXACTOS año por año, pero **2025 tiene 173 210 procesos frente a 189 291 del volcado
(faltan 16 081) y 2026 tiene 46 645 frente a 92 055 (faltan 45 410)**. Es el hueco silencioso del
barrido por términos que ya anotaba la auditoría del 10-ago (`local-sync.ts`, tope de 300 páginas por
término sin cursor): 2019-2024 se completaron con los volcados en agosto; 2025 y 2026 nunca. La boleta
seguirá diciendo FALLA en esos dos años hasta que se rellenen. OJO: las boletas del lanzador salieron
«Bad Request» porque PowerShell rompe las comillas del JSON al llamar a `curl.exe`; correrlas desde
Bash con `-d '{"year":2025}'` funciona (81 s y 14 s).

**SIGUIENTE PASO (decisión de Oscar, porque duplica 2026 en todo lo publicado):** rellenar los
procesos que faltan de 2025 y 2026 desde los volcados anuales con el descargador nuevo (`--conexiones
16`) y el endpoint `/api/admin/ingest`, que INSERTA los ocid nuevos y salta los existentes (trampa 1):
un modo `--ingestar-faltantes --desde-anio 2025 --hasta-anio 2026` en `local-sync.ts` que recorra el
volcado con `releaseToProc` (regla 11) y empuje en lotes; después finalize (banderas y agregados),
boletas 2025 y 2026 (que deben pasar a 14/14) y `oicp_info`. Son ~61 500 procesos: los conteos,
rankings y coberturas de 2025-2026 cambian de forma visible.

**Lecciones operativas del día:** (1) `Start-Process` desde la herramienta muere con la llamada;
los vigilantes se lanzan con WMI (`Invoke-CimMethod Win32_Process Create`) y
`cmd /c powershell -File ... >> <err> 2>&1` con un `.err` PROPIO, porque redirigir a un `.err` que
otro cmd vivo tiene abierto mata el lanzamiento en silencio; y el filtro de procesos debe excluir
`$PID`, o encuentra a la propia llamada. (2) Un revisor «de solo lectura» con herramientas editó el
archivo real y luego hizo `git checkout --`, que borró el diff sin commit (lo restauró de su copia):
antes de una revisión adversarial sobre cambios sin commit, confirmar en rama o darles una copia, y
verificar el diff al volver. (3) Los comandos Bash largos con código en heredoc mueren en el parseo
del envoltorio: el contenido va con Write y las ediciones CRLF por script.

## 2026-09-05 — auditoría de fondo: metodología vs motor, campos de la fuente, utilidad y cifras

Cuatro frentes con modelos baratos (Sonnet) y verificación propia. Resultado en producción
(commits `111805e` y `fa96ccc`), boletas 2025 y 2026 APROBADAS después del recálculo.

**Corregido (sustancia):**
1. **TR-01 medía «no adjudicado aún», no falta de información.** Exigía proveedor también a los
   procesos en convocatoria: 34 835/34 835 en `status=tender` y 18 624 en `active` llevaban la
   bandera (+8 puntos) solo por no tener proveedor todavía. Ahora el proveedor se exige desde la
   adjudicación (award/contract/complete); comprador, valor y método siempre. Tras la re-evaluación
   global (59 581 procesos, hecha por el cierre del barrido del SOCE con el código nuevo): 3 en
   `active` y 12 952 en `tender`, todos por falta de VALOR (sin presupuesto publicado), que sí es
   información faltante. Trampa que casi se cuela: los SELECT del reflag global (`updater.ts`) y
   de la boleta (`verificar-anio.ts`) NO traían `status`; sin añadirlo, la regla no habría aplicado
   en el recálculo y la boleta habría gritado discrepancias falsas.
2. **La página y el MCP decían dos cosas opuestas sobre los días hábiles** (que IT-01 «todavía no
   cumple el COA Art. 158» sin distinguir régimen). Reescrito en las tres superficies: dos
   cómputos, el término legal del Art. 96 (régimen A, desde el día hábil siguiente) y el intervalo
   referencial (incluye el día inicial, no es término). Además: IT-02 `description_es` con la
   exclusión de ínfima como las otras superficies; la co-ocurrencia IC-02+TR-03 fechada; y un
   «ceroco-ocurrencias» renderizado por un salto de línea tras `</strong>` (visto en pantalla).

**Verificado que está bien:** pesos, correlaciones, umbrales por fecha, exclusión de catálogo,
IP-01, IP-02, IT-02, TR-02, TR-03 coinciden con el código en las tres superficies; las cifras
escritas están fechadas como registro histórico.

**Lo que la fuente trae y NO usamos todavía (siguiente fase de datos, junto a los oferentes):**
`contracts[].status` (terminated/cancelled), `contracts[].period` (inicio/fin/duración),
`parties[].address` (provincia y cantón, en ~100% de los registros), `tender.awardCriteria`,
`tender.enquiries[]` (preguntas y respuestas), `planning.budget.id` (partida). Y `final_amount`
depende de `contracts[].implementation.finalValue`, que el SERCOP no suele publicar: declararlo.

**Utilidad (lo que un periodista pregunta y hoy no sale):** exportar a CSV, novedades desde la
última visita, filtro por régimen/sector y por provincia, comparar dos entidades, página web de
oferentes (hoy solo por MCP), proveedores nuevos con banderas.

**Oferentes (2-sep):** código en producción (tabla `participaciones`, `a_participantes`,
`oicp_oferentes`, control en boleta), pero la carga de los 8 años NO se pudo hacer: el SERCOP
entrega los volcados a 0-16 KB/s desde el 3-sep (el 12-ago iba a ~600 KB/s). Un vigilante en la
PC mide cada 15 min y lanza solo cuando haya ≥150 KB/s; abortó/abortará si no mejora. Reintentar
en otra franja. Dos lecciones operativas: un Monitor `tail -F` sobre un log escrito con
PowerShell lo bloquea y mata al script (usar sondeo con `cat`); a un modelo barato se le da una
tarea acotada y verificable, no una espera de horas.

---

## 2026-08-13 (tarde) — concentración por unidad declarada + consolidado por RUC (decisión 1+2, no 3)

Commit `d98ac61`, verificado en producción. Las banderas CC-01/CC-02/CC-05 siguen midiendo por
unidad de compra y la limitación quedó declarada en las TRES superficies de la regla 10 (leída la
página renderizada). El perfil del comprador (web y MCP) publica `unidades_de_compra` y
`consolidado_ruc {n_procs, total_usd}` desde `a_buyers`, con UNA definición compartida
(`server/consolidado-ruc.ts`) y sin tocar banderas ni scores. Bomberos de Quito en producción:
2 unidades, 2 221 procesos, $132 938 469,26 (web = MCP al centavo). Boleta APROBADA en 2024
(219 185 procesos, 13/13 controles) y 2025 (173 210, 13/13) tras el deploy.

**Hallazgo de datos**: el sufijo de unidad puede venir PEGADO al RUC sin guion. Medido: 337
compradores, 11 035 procesos y $406,5 M (p. ej. `EC-RUC-17681528000014-240717` es una unidad de
CNT). Un diseño intermedio que exigía guion tras los 13 dígitos dejaba esos $406 M fuera del
consolidado; la prueba de `consolidado-ruc.test.ts` fija el caso. Lección de método: la primera
revisión adversarial (4 lentes) APROBÓ ese diseño defectuoso porque revisaba coherencia interna
sin datos; la consulta a `a_buyers` en producción lo tumbó en una sola query. Verificar supuestos
de FORMATO contra la base real antes de dar por buena una revisión.

**Colateral anotado, sin tocar (fuera del alcance del día)**: la sección «Cómo se cuentan los
días hábiles» de Methodology.tsx y la limitación (3) de `limitaciones_del_dato` del MCP describen
IT-01/IT-02 como si el conteo siempre incluyera el día inicial; desde el 12-ago el régimen (A)
del Art. 96 cuenta desde el día siguiente (la regla de IT-01 del propio METHODOLOGY lo dice
bien). Las dos superficies son consistentes entre sí pero la matización del régimen (A) les
falta. Decidir si se reescriben.

## 2026-08-13 — una investigación externa auditó el MCP y encontró cosas de verdad

Oscar usó el MCP desde un chat para una investigación real de proveedores y el chat produjo un
reporte con 8 hallazgos. **Se reprodujo cada uno contra producción antes de tocar nada.** Vale
leerlo como lección: la plataforma acababa de salir 8/8 en la boleta por año y aun así un usuario
externo encontró defectos reales, porque miró superficies que la boleta no cubría.

| # | Hallazgo | Veredicto | Qué se hizo |
|---|---|---|---|
| 1 | `oicp_info` con distribución vieja | **NO se reproduce.** El código consulta en vivo (mcp-server.ts, `case 'oicp_info'`) y no puede servir otra cosa que la base. Los números que vio suman EXACTAMENTE 1 460 511, el corpus del 9-jul: firma de un SEGUNDO conector apuntando a una copia vieja (el «gemelo» ya documentado). | Pendiente de Oscar: revisar los conectores de ese chat |
| 2 | `a_supplier_critical` con scores viejos (8 de 8 muestreados) | **CONFIRMADO.** Causa raíz: todo el mantenimiento de la muestra estaba anidado bajo `if (rl !== oldRl)`; un score que baja sin cambiar de nivel jamás la tocaba. Los recálculos del 11-12-ago hicieron exactamente eso en masa. | Fix `eaa258b` + control `muestra_criticos` en la boleta + regeneración |
| 3 | La tabla es muestra top-5 con `high` adentro y el nombre no lo dice | **CONFIRMADO** (2 708 critical + 24 571 high). Es diseño, mal expuesto. | Documentado en la descripción del tool con su uso correcto (`b362466`) |
| 4 | No hay ruta para monto por proveedor × riesgo; la doc recomienda lo que el guardián rechaza | **CONFIRMADO.** El guardián falla cerrado A PROPÓSITO; la doc era la equivocada. | Agregado nuevo `a_supplier_risk` con mantenimiento incremental + control `riesgo_proveedor` en la boleta (`1ba4ff0`) + doc |
| 5 | «BOMBEROS QUITO» no encuentra a los bomberos de Quito | **CONFIRMADO.** El LIKE exigía subcadena contigua. | Match tokenizado en los dos perfiles (`b72d3f1`) |
| 6 | Columnas de nombre distintas por tabla rompen consultas | **CONFIRMADO.** | Esquema de cada tabla documentado en la descripción (`b362466`) |
| 7 | 79% del corpus (1 153 794 procesos, $6 944 M) en buyer_id sin sufijo, sin una sola bandera | **Números CONFIRMADOS.** Es casi todo catálogo electrónico (pre-competido, sin fechas ni oferentes): score 0 ahí es coherente con el diseño. | Decisiones de negocio pendientes de Oscar (cobertura publicada, consolidación por RUC) |
| 8 | `procurement_method_details` truncado ~80 chars de forma inconsistente | No re-verificado a fondo; consistente con el feed de búsqueda del SERCOP que trunca y el record que no. | Anotado; reparable con los volcados si Oscar lo pide |

**La moraleja quedó cableada**: la boleta ahora cubre `a_supplier_critical` y `a_supplier_risk`,
así que esta clase entera de deriva (agregado que no sigue al recálculo) grita en vez de servirse
como dato. Y las pruebas de los fixes se verificaron en ROJO contra el código viejo.

---

> **Lee primero esta sección.** Lo que sigue después conserva el historial de las auditorías
> anteriores y tiene tramos que ya quedaron superados; donde haya contradicción, manda lo de aquí.

## 2026-08-12 — el rellenado, y las dos afirmaciones falsas que lo habrían hecho fracasar

El traspaso anterior daba por buenas dos cosas sobre el rellenado de los 174 547 presupuestos.
**Las dos eran falsas, y cada una por separado bastaba para que el trabajo corriera 16 horas
contra la API del SERCOP y no reparara ni una sola fila, sin error y sin aviso.**

1. **«Reutiliza `/api/admin/ingest`, que ya hace upsert por ocid».** No lo hace. `ingestProcs()`
   salta los ocid que ya existen (`updater.ts`: `if (exists.get(raw.id)) { skipped++; continue; }`)
   porque es un barrido de novedades. La respuesta habría sido `skipped: 174547`.
2. **«La lectura ya está corregida y la usan los dos caminos de ingesta».** Había un TERCER
   camino: `local-sync.ts` tenía su propia copia de `releaseToProc`, sin corregir. Y es el único
   que llega de verdad al SERCOP, porque Railway tiene la IP bloqueada. **Cada corrida programada
   de martes y jueves seguía guardando el texto `"USD"` y `enquiry_deadline` en nulo.** Regla 11
   rota en el mismo sitio donde ya había costado horas.

### Otros cuatro defectos encontrados ejercitando la plataforma, todos corregidos y verificados

1. **627 834 procesos publicaban un marco legal FALSO.** Una vía de ingesta antigua escribió el
   identificador `LOIP` en todo 2023 (190 539), 2024 (219 185), 2025 (173 210) y 2026 (44 900).
   `LOIP` no existe en el resto del código y la ficha lo traducía a «LOSNCP reformada (desde el
   7-oct-2025)»: un proceso de mayo de 2023 declaraba regirse por una reforma de octubre de 2025.
   2023 quedaba además partido entre dos identificadores según por qué vía hubiera entrado cada
   proceso. **Recomputado desde la fecha con `getRegime()`, la misma función de la ingesta**, en
   1m39s: 2025 queda partido en 142 464 / 30 746 exactamente en el corte del 7-oct. No mueve
   ningún score (el motor usa `YEAR_DATA` por año, no esta columna): corrige lo que se publica.
2. **Un proveedor con USD 38,9 M se publicaba llamándose «null»** en el top 10 de CELEC EP. La
   fuente publica la cadena `"null"` como nombre y pasaba tal cual a los agregados. Eran 111
   procesos y 48 agregados. Ahora la ingesta lo normaliza, el dato guardado queda vacío (que es la
   verdad) y al mostrarlo cae al RUC. **Verificado: 0 proveedores sin nombre útil.**
3. **El MCP no encadenaba.** `oicp_buyer_profile` rechazaba el `buyer_id` que devuelve
   `oicp_top_buyers`: se quedaba solo con los dígitos y `EC-RUC-1768152800001-238940` se convertía
   en `1768152800001238940`, que no casa con ningún id (llevan guiones). Encadenar las dos
   herramientas, que es el uso natural, daba «Comprador no encontrado» para el primer comprador del
   ranking.
4. **La metodología publicaba dos versiones opuestas de la misma regla.** En la misma sección:
   «los feriados sí se descuentan desde el 11-ago-2026» y, tres párrafos más abajo, «aquí se cuenta
   el día inicial y NO se descuentan feriados». Encontrado leyendo la página renderizada, no el
   código. Ahora separa las dos condiciones del COA: el Art. 159 ya se cumple, el Art. 158 no.

### Ninguna cifra publicada vuelve a envejecer sola

Las tres superficies llevaban «174.547 procesos sin presupuesto (11,9%)» escrito a mano, y el
rellenado baja ese número cada hora: en pocas horas la metodología habría estado publicando un dato
falso sin que nadie lo notara. Ahora se **mide al responder** desde una sola definición
(`estadoPresupuesto()` en `db.ts`, cacheada 5 min porque recorre la tabla), `/api/version` la
publica, y la web y el MCP la leen de ahí. El texto incluso cambia solo cuando el rellenado termina.
Si la llamada falla, la web **no inventa cifras**: redacta la sección sin números.

### Lo que se construyó y quedó desplegado (`adbda4a`, `6543817`)

- **`server/ocds-proc.ts`**: el mapeo OCDS → fila, en UNA sola definición, importado por
  `updater.ts` y por `local-sync.ts`. Una prueba falla si algún archivo vuelve a definir el suyo.
- **Reparador aparte del ingestor**: escribe SOLO `budget_amount` y `enquiry_deadline`, y hay una
  prueba que compara columna por columna y falla si toca cualquier otra. Es lo que hace imposible
  desincronizar los agregados `a_*`: se construyen con `MONTO_SQL` (adjudicado/contratado/final) y
  con el texto de la ficha. Verificado además que el índice de concentración no depende del
  presupuesto (`SQL_ES_INFIMA_POR_MONTO` usa `award_amount`).
- **`POST /api/admin/ocids-a-reparar`** (cursor por clave primaria, criterio resuelto contra una
  tabla fija y nunca interpolado), **`POST /api/admin/reparar`**, **`POST /api/admin/reparar-finalize`**
  (solo re-evalúa banderas: reconstruir concentración sería riesgo de escritura masiva para nada) y
  **`/api/admin/avance-reparacion`**, cacheado 5 minutos porque recorre la tabla entera.
- **Modo `--reparar` en `local-sync.ts`**, reanudable por cursor en disco, con segunda pasada para
  los fallos de red. Se lanza con `run-rellenado.cmd`.
- **20 pruebas nuevas**: 143 → 163.

### Un defecto propio, encontrado releyendo antes de soltar nada

La primera versión del barrido avanzaba el cursor al último id de la página aunque se hubiera
quedado sin tiempo a mitad. Los no procesados **no se habrían vuelto a pedir nunca** y el
rellenado se habría dado por completo faltando datos: el mismo hueco silencioso que ya dejó el
barrido por términos. Ahora el cursor sigue al último ocid realmente consumido, con prueba.

### Verificado contra la fuente ANTES de construir

- En los procesos sondeados, `tender.value` viene **ausente** y el monto está en
  `tender.lots[].value.amount`; `tender.enquiryPeriod.endDate` **sí se publica**.
- Baseline medido: **174 547** con el texto `"USD"` (18 811 · 13 815 · 20 492 · 35 533 · 26 065 ·
  30 859 · 23 902 · 5 070 de 2019 a 2026, suma exacta) y `enquiry_deadline` en **0 de 1 470 321**.
- **El presupuesto es recuperable en el grueso**: Régimen Especial, que es donde la fuente no
  publica monto, son solo **6 859 de 174 547 (3,9%)**.
- **La descarga masiva quedó descartada con evidencia**: `/api/records` ignora el filtro por año y
  fija `per_page` en 15, o sea 184 930 peticiones y ~95 GB. Peor que ir uno por uno.
- `/api/admin/fix-budget` **no sirve para esto**: mueve `budget_currency` a `budget_amount`, y en
  estas filas `budget_currency` es NULL. Es la tarjeta «Reparar budget_amount» del panel, la misma
  que la trampa 2 advierte no pulsar por error. Hoy además es inofensiva porque no encuentra nada.

### CC-01 verificada por ejecución del motor (cerrado)

**103 procesos reales, 0 discrepancias**, con `server/verificar-lote.mjs`. Cubre **69 de los 129
disparos (53,5%)** y **los 6 años** en que la bandera dispara, con el contexto de concentración
completo de cada comprador (712 filas de `concentration_index`). Tres controles para que el cero
signifique algo: el motor **produce** los 69 (no es que ambas puntas omitan); topando
`infima_count` en 4 el motor **pierde los 69**; y saboteando tres procesos el arnés los delató y
salió con código 1. En Ministerio del Ambiente 2019 y GAD Cotaló se compararon **todos** sus
procesos, no solo los que ya tenían CC-01, así que ahí también está descartado el falso negativo.
Queda sin cubrir: 60 disparos en 9 pares comprador-año, y los falsos negativos fuera de esos dos
barridos completos.

### La tabla del Art. 96, verificada en fuente primaria (cerrado)

Registro Oficial **Noveno Suplemento 153 de 28-oct-2025, página 69**, extraída del PDF oficial y
contrastada con una copia independiente y con Lexis:

| Presupuesto referencial (USD) | Término mínimo |
|---|---|
| Superior a 10.000 hasta 100.000 | No menor a 2 días |
| Superior a 100.000 hasta 500.000 | No menor a 4 días |
| Superior 500.000 a 1.000.000 | No menor a 6 días |
| 1´000.000 en adelante | No menor a 10 días |

Son **términos**, o sea días hábiles. La tabla **empieza en «superior a 10.000»**: los
procedimientos de 10.000 o menos no tienen término asignado. El **Decreto Ejecutivo 461**
(R.O. 3S 337, 30-jul-2026) **no reformó el Art. 96**, ni lo hicieron la fe de erratas (R.O. 7S 155)
ni los decretos 295 y 356; sí tocaron artículos vecinos, lo que hace más significativo que a este
lo dejaran intacto.

### El problema abierto de IT-01: el término legal NO es reproducible con los datos abiertos

El Art. 96 cuenta el término «a partir de fenecer la fecha límite para contestar respuestas y
aclaraciones». Medido contra la fuente:

- Esa fecha **no se publica**. La API da `tender.enquiryPeriod.endDate`, que es la fecha límite
  para PREGUNTAR, no para responder. Entre una y otra median de 2 a 6 días (Art. 91).
- El otro extremo tampoco: `tender.tenderPeriod.endDate` **viene vacío en el 93%** de los procesos
  (204 165 de 219 185 en 2024).
- Por eso IT-01 solo puede evaluar **106 249 de 1 470 321 procesos (7,2%)**, y dentro de ese
  universo marca **58 541, el 55,1%**, con mínimos de 9/13/17 días que no salen de ninguna norma.

Está en curso la búsqueda del cronograma público del SERCOP, que sí publica «fecha límite de
respuestas y aclaraciones» y «fecha límite de entrega de ofertas». **Decisión pendiente de Oscar**
hasta saber si esas fechas se pueden obtener de forma automatizable.

### El rendimiento de la fuente, medido, y el defecto que apareció al paralelizar

`record?ocid=` da **0,08-0,13 peticiones por segundo en serie** (p50 7-12 s, máximo 18 s), no las 3
que suponía el traspaso: a ese ritmo son ~15-25 días, no 17 horas. **Y esa lentitud NO es límite de
tasa**: tras 12 minutos de reposo sigue igual y devuelve cero 429. Es latencia por petición, así que
**la concurrencia la multiplica**: 3 hilos → 0,25 req/s; 12 hilos → 0,78; 20 hilos → 0,9, siempre
con cero 429. El barrido corre ahora con 20 hilos, o sea **unas 54 horas** para los 174 547.

Al paralelizar apareció un defecto que habría hecho que bloqueen la IP de Oscar, que es la única
desde la que este proyecto puede leer la fuente. El limitador era
`gap = 350 - (ahora - ultima); if (gap>0) esperar; ultima = ahora`: correcto en serie y roto en
paralelo, porque los N hilos leen la MISMA `ultima`, duermen lo mismo y despiertan juntos. Medido
con la reproducción literal del código viejo: **12 emisiones en 50 ms (~240/s)**, donde el correcto
tarda 449 ms. Y ~8 por segundo es justo el ritmo que produjo 21 respuestas 429 con `Retry-After: 24`.
Ahora el turno se **reserva** en vez de consultarse, vive en `server/limitador.ts` con sus pruebas, y
un 429 frena a **todos** los hilos.

### La vía masiva: 54 horas pasan a 20 minutos

**El SERCOP publica volcados por año que su propia documentación no menciona.** Los documenta solo
el código de su página de datos abiertos:

```
https://datosabiertos.compraspublicas.gob.ec/PLATAFORMA/download?type=json&year=YYYY&month=0&method=all
https://datosabiertos.compraspublicas.gob.ec/PLATAFORMA/get-totals?year=YYYY&month=0&method=all
```

| | Uno por uno (`record?ocid=`) | Por volcados |
|---|---|---|
| Los 174 547 | ~54 h y 174 547 peticiones | **~20 min y 8 peticiones** (989 MB) |
| Corpus completo | ~131 días | ~20 min y 12 peticiones (1,42 GB) |

Y esa ruta **no devolvió un solo 429**, a diferencia de `/PLATAFORMA/api/*`, que tiene un cupo de 60
por minuto **compartido entre clientes**: ahí no se puede planificar un ritmo desde nuestro lado.

**Leer esos ficheros costó tres defectos, cada uno con su prueba**, y los tres son del tipo que pasa
inadvertido:

1. **Al llegar un trozo nuevo se recontaban las llaves ya contadas**, así que no salía ni un objeto.
2. **`toString('utf8')` por trozo corrompe el texto**: los trozos cortan por bytes, no por
   caracteres, y con 111 MB de castellano una tilde partida se vuelve el carácter de reemplazo.
   Basta con que rompa una comilla para que todo se descuadre. Mató la corrida de 2019.
3. **El volcado de 2020 trae una comilla SIN ESCAPAR**, o sea JSON inválido de origen. Contar
   llaves no sobrevive: una vez desincronizado se come el año entero.
4. **Y no todos los años vienen con formato bonito**: algunos traen el array en una sola línea, así
   que delimitar por líneas revienta la memoria.

La forma que sobrevive a todo es **contar llaves con resincronización por salto de línea**,
apoyándose en una garantía del propio JSON: un salto de línea crudo no puede estar dentro de una
cadena. Verificado contra los ficheros reales: **2019 dio 275 055 leídos contra 275 055 declarados
y 2020 dio 160 676 contra 160 676. Diferencia cero en ambos.**

### El Art. 96, resuelto: las dos fechas SÍ son públicas

La ficha de impresión del SOCE las trae, en un solo GET, sin sesión y sin captcha:
`https://www.compraspublicas.gob.ec/ProcesoContratacion/compras/PC/ImprimirIPC2.cpe?id=<idSoliCompra>`

| OCDS | Rótulo del portal |
|---|---|
| `tender.enquiryPeriod.endDate` | Fecha Límite de **Preguntas** |
| *(no existe en OCDS)* | **Fecha Límite de Respuestas** ← inicio del término |
| `tender.tenderPeriod.endDate` (vacío en el 93%) | **Fecha Límite entrega Ofertas** ← fin del término |

**El enganche era el problema, no la lectura.** El ocid NO contiene el id interno del proceso: su
número final es el de la **entidad**. Por eso el índice se construye al revés, recorriendo los id
del portal y cruzando por el CÓDIGO de cada ficha. Y **el cruce se valida**: solo se acepta si la
fecha límite de preguntas del portal coincide con la que ya tenemos de los datos abiertos. Sin ese
testigo, un código repetido entre entidades publicaría fechas de otro proceso en una ficha con
nombre y apellido.

**Decisiones de Oscar del 12-ago-2026**: (a) hacer el barrido completo del índice, que de paso
rellena la fecha límite de ofertas que falta en el 93%; (b) en Régimen Especial, la «Audiencia de
Preguntas y Aclaraciones» **sí cuenta** como el hito del Art. 96, y el motor guarda de qué rótulo
salió para poder declararlo.

**IT-01 ya está implementado con dos regímenes y se activa solo** según el índice se llena:
(A) el término legal del Art. 96 cuando hay las dos fechas y el proceso es del 28-oct-2025 en
adelante, contado desde el día hábil siguiente (COA Art. 158) y sin feriados (Art. 159); (B) el
referencial en el resto, cuyo detalle **ahora dice que es referencial y que no reproduce el
Art. 96**. Desplegarlo no movió ningún score porque `answer_deadline` está vacío: lo único que
cambió es el texto.

### EL RELLENADO TERMINÓ, y está verificado por los datos

**27,7 minutos.** 1 520 444 releases recorridos, 198 652 de la lista encontrados, **173 250
reparados**, 25 402 sin cambio. Los ocho años cuadran contra lo que declara la fuente
(las diferencias de 1 y de 22 son del propio contador del SERCOP, que ya se le vieron al medir):

| Año | Leídos | Declarados | De la lista |
|---|---|---|---|
| 2019 | 275 055 | 275 055 | 0 |
| 2020 | 160 676 | 160 676 | 775 |
| 2021 | 167 058 | 167 058 | 20 412 |
| 2022 | 212 324 | 212 324 | 35 139 |
| 2023 | 217 913 | 217 914 | 25 899 |
| 2024 | 219 185 | 219 186 | 30 600 |
| 2025 | 187 988 | 187 988 | 40 927 |
| 2026 | 80 245 | 80 267 | 44 900 |

**Estado final, medido:**

| | Antes | Ahora |
|---|---|---|
| Con el TEXTO `"USD"` | 174 547 | **0 en los ocho años** |
| Con `enquiry_deadline` | 0 | **154 682** |
| Sin presupuesto porque la fuente no lo publica | 3 233 | 13 128 |
| Falta `enquiry_deadline` en la ventana del Art. 96 | 68 104 | 51 707 |

Los 13 128 sin presupuesto **son la verdad, no un fallo**: son procesos donde el SERCOP no lo
publica, casi todos porque en el corte del volcado seguían en fase de planificación. Antes esos
mismos figuraban con la palabra «USD» como si fuera un monto, y **eso hacía que TR-01 no los
marcara como información incompleta**. Ahora sí.

**El reflag cambió 92 506 procesos.** Cifras nuevas, con el invariante exacto
(10 079 + 46 618 + 1 332 879 + 80 745 = 1 470 321):

| Indicador | Antes | Ahora | Por qué |
|---|---|---|---|
| TR-03 | 45 969 | **48 617** | con el presupuesto conocido, más procesos superan el umbral |
| IP-01 | 16 140 | **16 417** | ídem, caen en la banda del 85 al 100% |
| TR-01 | 52 940 | **52 915** | los que ya tienen valor conocido dejan de marcarse por ese motivo |
| IP-02 | 5 | **5** | *ver abajo* |

**IP-02 sigue en 5, y eso es el resultado, no un fallo.** Se esperaba que subiera, pero el
indicador exige `award_amount > 0` y la inmensa mayoría de los procesos reparados están en fase de
oferta, sin adjudicado. Donde sí hay ambos, adjudicar por encima del referencial sigue siendo casi
inexistente en estos datos, que es justo lo que la metodología ya declaraba.

**Cadena completa verificada en un proceso con nombre**, `ocds-5wno2w-SIE-CELECEP-2024-04422-238940`:
presupuesto **536 037,63** (era el texto «USD», y coincide al centavo con lo que se comprobó contra
la API al empezar la sesión), `enquiry_deadline` puesta, régimen corregido de `LOIP` a
`LOSNCP_COEFICIENTES`, y el detalle de TR-01 pasó de «Faltan: **valor**, proveedor» a «Faltan:
proveedor».

### Cómo quedó el rellenado corriendo

Validado con lote chico contra producción antes de soltarlo: **119 pedidos, 119 reparados, 0
fallos**, y verificado por los datos (en el tramo procesado no queda ni un `"USD"`: 500 numéricos y
3 nulos, que son los que la fuente de verdad no publica). El reflag movió 22 procesos en 49 s.

Corre por la tarea de Windows **«OICP Rellenado presupuestos»**, diaria a las 21:00, con las cuatro
protecciones verificadas en el objeto de la tarea (despertar el equipo, tolerar batería, no
detenerse al pasar a batería, 4 reintentos) y límite de 11 h. Es reanudable: cursor en
`.sync-repair-cursor.json`, y al terminar un criterio el cursor **vuelve al inicio** para que un
proceso que entre mañana con el defecto no quede por detrás y se pierda.

**Cómo verificar el avance sin ejecutar nada:** abrir con sesión iniciada
`https://oicp-production.up.railway.app/api/admin/avance-reparacion?fresco=1` y ver bajar
`con_texto_usd` desde 174 547 hacia 0. O leer `rellenado.log`. La página de Metodología publica la
misma cifra, medida al cargar.

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

### El recálculo SE APLICÓ el 11-ago-2026 y quedó verificado

Corrido desde `/admin/auditoria` → «Re-normalizar banderas». Duró unos 11 minutos; el proxy cortó
con el `upstream error` de los 300 s, como está documentado, y el trabajo siguió bien. Verificado
por los datos, no por la respuesta HTTP.

| Indicador | Antes | Después | Delta |
|---|---|---|---|
| IC-02 | 109 642 | **44 064** | −65 578, las órdenes de catálogo |
| IP-02 | 10 849 | **5** | −10 844 falsos positivos |
| IT-02 | 2 237 | **1 712** | −525, exactamente la cifra corregida |
| TR-03 | 46 050 | 45 969 | −81, por el umbral de julio |
| IP-01 | 16 081 | 16 140 | +59, por el umbral de julio |
| CC-05 | 1 709 | 1 734 | +25, por el umbral de julio |

Riesgo: crítico 13 259 → **12 618**, alto 47 738 → **43 997**, moderado 144 856 → **78 020**,
bajo 1 264 468 → **1 335 686**. Los cuatro suman 1 470 321, el total exacto.

Invariantes comprobados después: los **5** IP-02 que quedan tienen todos el adjudicado por encima
del presupuesto (cero incorrectos); de los 44 064 IC-02 **ninguno** es catálogo electrónico; la
ficha `ocds-5wno2w-MCB-EPMMM--2024-002-452218` (presupuesto $21 655,48, adjudicado $659,67) ya no
lleva IP-02; y la portada, el MCP y los agregados dan las mismas cifras.

### Verificación posterior: 100 procesos reales contra el motor real

Se levantó un arnés, `server/verificar-lote.mjs`, que re-ejecuta el motor de producción contra
procesos reales y compara bandera por bandera. Cinco lotes de 20 procesos de estratos distintos
(riesgo crítico 2024, catálogo 2023, la ventana jul-oct 2025, presupuesto+adjudicado 2022, riesgo
bajo 2019): **100 procesos, 0 discrepancias**. Más las 10 herramientas del MCP, los invariantes
por año, y las nueve pantallas probadas en caliente.

Un revisor crítico encontró dos fallas en esa misma verificación, y las dos se corrigieron:

- **El arnés no normalizaba `budget_amount`** como sí hace `updater.ts:427` con
  `Number(...) || 0`, así que podía reportar discrepancias FALSAS en TR-01. Corregido, con prueba.
- **Las banderas CC-\*** no se habían ejecutado con contexto de concentración. Se verificó CC-05
  contra `concentration_index`: los 10 pares de la muestra de 2024 cumplen la condición exacta
  (`infima_count >= 2` y `infima_total_value > 6 658,78`), cero falsos positivos.

### Segunda tanda del 11-ago: correlación, días hábiles y rankings

**El descuento por correlación estaba mal puesto y se replanteó midiendo.** El par que la
plataforma declaraba, IC-01 + IC-02, tiene **cero** co-ocurrencias en los ocho años y no puede
tenerlas: IC-01 exige método competitivo e IC-02 exige `direct`, son excluyentes por construcción.
Se retiró. El que faltaba, **IC-02 + TR-03, co-ocurre en 42 321 de los 44 064 disparos de IC-02
(96,0%)** y no tenía descuento: 30 + 18 = 48 de los 100 puntos posibles por una sola observación.
Ahora descuenta.

**`businessDays()` dependía de la hora del servidor.** Medido: de los procesos con exactamente un
día calendario entre publicación y adjudicación, **311 reportaban «1 día hábil» y 460 «2»**. Ahora
se cuenta sobre la fecha calendario en cadena ISO y de forma aritmética. Efecto: los procesos con
dos días calendario pasan a contar 3 hábiles y **dejan de disparar IT-02**, porque la regla
publicada es «menos de 3». Eran unos 397, y no es una pérdida: es la regla aplicándose bien.

**Los rankings tienen piso de volumen.** 10 procesos del comprador, el mismo mínimo que CC-02, más
2 contratos del par en el ranking de pares. Antes los encabezaban entidades con un solo proceso y
un par de $53,95 salía quinto.

### Tercera tanda del 11-ago: los feriados del Art. 65

**Los días hábiles ya descuentan los feriados.** El calendario es el del **Art. 65 del Código del
Trabajo**, verificado textualmente en Lexis sobre el texto vigente (Codificación 17, R.O.S 167 de
16-dic-2005, reformado por la Ley de R.O.S 906 de 20-dic-2016), con sus reglas de traslado y las
tres fiestas móviles calculadas desde la Pascua.

Se contrastó contra lo que Ecuador observó de verdad, y esas comprobaciones quedaron como pruebas:
1-may-2024 (miércoles) → viernes 3; 1-may-2025 (jueves) → viernes 2; 10-ago-2024 (sábado) →
viernes 9; 9-oct-2024 (miércoles) → viernes 11; 2 y 3-nov-2024 (sábado y domingo) → viernes 1 y
lunes 4; 24-may-2025 (sábado) → viernes 23. Carnaval 2024 el 12-13 de febrero y 2025 el 3-4 de
marzo; viernes santo 2024 el 29 de marzo y 2025 el 18 de abril. **Los diez casos dan exacto.**

Dos advertencias declaradas en la metodología publicada: el decreto ejecutivo anual puede apartarse
del Código en un año concreto, sobre todo al armar puentes; y la excepción del 1-ene, 25-dic y
martes de carnaval se lee aplicable solo al traslado de martes, miércoles y jueves, no al de fin
de semana.

**Verificado sobre los datos tras el recálculo.** IT-01 pasa de 55 501 a **58 541** e IT-02 de
1 206 a **1 223**: suben, que es la dirección correcta, porque al no contar los feriados hay menos
días hábiles y más procesos caen bajo el mínimo. Los cuatro niveles de riesgo suman 1 470 321
exacto. Se comprobaron a mano siete procesos que solo disparan por el descuento de feriados, y los
siete cuadran al día:

| Proceso | Ventana | Feriado que se descuenta | Hábiles |
|---|---|---|---|
| `RE-GADMT-083-2019` | jue 31-oct → mar 5-nov 2019 | 2-nov sábado → vie 1; 3-nov domingo → lun 4 | 4 − 2 = 2 |
| `RE-MS-1-2019` | vie 1 → mié 6 mar 2019 | carnaval lun 4 y mar 5 (Pascua 21-abr) | 4 − 2 = 2 |
| `CDC-CBV-001-2021` | jue 4 → lun 8 nov 2021 | 3-nov miércoles → vie 5 | 3 − 1 = 2 |
| `RE-002-GADRSJCH-2021` | jue 7 → lun 11 oct 2021 | 9-oct sábado → vie 8 | 3 − 1 = 2 |
| `RE-001-GADPRIB-2022` | vie 29-abr → mar 3-may 2022 | 1-may domingo → lun 2 | 3 − 1 = 2 |
| `RE-GADMH-2022-002` | vie 20 → mar 24 may 2022 | 24-may martes → lun 23 | 3 − 1 = 2 |
| `RE-OACL-GADPRSMH-2023-002` | vie 22 → mar 26 dic 2023 | 25-dic lunes, sin traslado | 3 − 1 = 2 |

Las cinco variantes de traslado quedan ejercitadas con datos reales: sábado→viernes,
domingo→lunes, martes→lunes, miércoles→viernes y el caso sin traslado.

### Lo que sigue pendiente, y por qué

1. **El día inicial del cómputo (COA Art. 158).** El artículo manda contar «a partir del día hábil
   siguiente» y aquí se cuenta el día inicial. **No se cambió a propósito**: mueve el significado
   de los mínimos de IT-01, que están pendientes del punto 2. Las dos cosas se resuelven juntas o
   el indicador queda a medio camino. Declarado en la metodología.
2. **Los mínimos de plazo de IT-01** (9/13/17). Corresponden al tramo publicación→adjudicación y el
   indicador mide publicación→límite de ofertas, cuyos mínimos son 6/10/14/18; y esos mínimos
   escalonados no existían antes del 28-oct-2025. Es **decisión de Oscar**: o se aplican solo desde
   esa fecha, o el indicador se declara referencial para los años anteriores.
3. **El presupuesto de los 174 547 procesos SÍ es recuperable, y era un defecto nuestro.**
   Se había dado por perdido. Falso. La ingesta leía el presupuesto de `tender.value`, que el
   SERCOP publica **vacío** en esos procesos, cuando el monto vive en **`tender.lots[].value`**.
   Comprobado contra la API de la fuente en cinco procesos de esa bolsa, y en los cinco
   `tender.value` venía vacío y los lotes traían el monto: $40.105,69 · $536.037,63 · $26.057,94
   · $18.033,59 · $16.812,60.

   **La lectura ya está corregida** (`server/ocds-valor.ts`, una sola definición para los dos
   caminos de ingesta, con pruebas). Todo lo que entre o se actualice desde ahora trae su
   presupuesto. **Falta el rellenado de los 174 547 anteriores**, que exige volver a pedirlos a la
   API del SERCOP: son ~174 mil peticiones con el límite de 3 por segundo y respeto del 429, o sea
   unas 16 horas de trabajo de fondo. Hay que correrlo como job resumible, no en una sesión.

   Se aprovechó el mismo arreglo para empezar a guardar **`tender.enquiryPeriod.endDate`** en la
   columna nueva `enquiry_deadline`: es la fecha desde la que corre el término del Art. 96 y sin
   ella IT-01 no puede reproducir el plazo legal. También la publica el SERCOP y tampoco se leía.
4. **El respaldo.** Sigue sin poder correr por espacio, y ampliar el volumen cuesta dinero: es
   decisión de Oscar.
2. ~~Las citas a la guía de la OCP.~~ **Resuelto el mismo 11-ago.** De las 13, solo 3 eran
   correctas. Tres se corrigieron a su código real (IP-02 de R059 a **R031**, CC-02 de R051 a
   **R050**, CC-05 de R011 a **R055**), cinco se retiraron por no tener equivalente (IC-02, CC-04,
   TR-01, TR-02, TR-03) y dos quedan como adaptaciones declaradas en la página (IT-02/R061 e
   IP-01/R011). Verificado contra el PDF oficial de la edición 2024, código por código, no contra
   el resumen de nadie. La política se publica en la propia metodología y una prueba fija el mapa
   entero. Se corrigió además un defecto de la rehidratación: quitar una cita del catálogo no la
   borraba de las fichas ya guardadas.

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
