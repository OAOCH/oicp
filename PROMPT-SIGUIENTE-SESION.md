# Prompt para la siguiente sesión del OICP

> Copia TODO lo que está debajo de la línea y pégalo como primer mensaje de una sesión nueva
> abierta en `C:\Users\oscar\oicp-work\oicp`. Está escrito para ser autosuficiente: no necesita
> preguntarle nada a la sesión anterior.

---

Retomo el OICP (Observatorio de Integridad de Contratación Pública del Ecuador). Soy Oscar,
abogado, no técnico: resuelve lo técnico tú y explícame en lenguaje llano.

**El objetivo de esta sesión es que la plataforma quede lista para venderse.** Va a ser auditada
por un equipo de expertos en desarrollo, datos, metodología, seguridad jurídica y UX. Quiero que
cuando entren a revisar el código, los datos y la arquitectura, la conclusión sea que la
plataforma vale lo que dice valer. No quiero "casi listo": quiero cada criterio con su respaldo
citable, cada cifra verificada contra producción, y cada pantalla probada en caliente.

## Lee esto primero, en este orden, y no asumas nada que no esté ahí

1. `CLAUDE.md` — lo estable: stack, estructura, cómo desplegar, las 13 reglas invariantes, qué no
   tocar nunca.
2. `ESTADO.md` — lo cambiante: qué está listo, qué quedó a medias, decisiones tomadas con su
   alternativa descartada, errores conocidos y cómo se resolvieron.
3. `server/flag-engine.ts` — el motor de los 15 indicadores. Es la fuente de verdad de la
   metodología. Todo lo que se publica tiene que coincidir con él (regla 10).

## Accesos que tienes disponibles

- **Repo**: `C:\Users\oscar\oicp-work\oicp`, rama `main`, `github.com/OAOCH/oicp`. El push está
  autenticado y funciona sin pedir credenciales.
- **Producción**: https://oicp-production.up.railway.app — desplegar es `git push origin main`.
  Railway observa el repo. Verifica con `/api/version` que el commit desplegado sea el tuyo.
- **Conector MCP "oicp"**: 10 herramientas de solo lectura sobre producción. Úsalo para consultar
  datos reales. Si aparece desconectado, dime y lo reconecto.
- **Mi navegador Chrome con mi sesión activa** (herramientas `mcp__claude-in-chrome__*`). Con eso
  puedes: entrar al panel de administración, ver cualquier pantalla como la ve un usuario, y
  consultar rutas de la API que exigen sesión. Úsalo para probar en caliente.
- **Mi cuenta de Lexis Ecuador**: https://app.lexis.com.ec/sistema/inicio — sesión activa en ese
  Chrome. **Todo criterio que dependa de norma debes verificarlo ahí, vigente a hoy.** No te
  conformes con búsqueda web para normativa ecuatoriana.
- **Endpoint de diagnóstico**: `GET /api/admin/db-size` (y `?detalle=1` para el desglose por tabla,
  que bloquea unos segundos). Mide antes de decidir.

## Estado exacto al cerrar la sesión anterior

Producción en `commit 109cd90`, corte de datos 2026-08-07, 1 470 321 procesos, **123 pruebas en
verde**, typecheck y build limpios. Todas las rutas responden entre 196 y 400 ms.

Se corrigieron y desplegaron, en dos días de trabajo: los vectores por los que una sola consulta
congelaba la plataforma; la revocación de acceso de administración; las cifras de dinero
(web y MCP daban totales distintos); la calibración de las banderas de concentración, que marcaban
con el porcentaje de un año distinto al del proceso; el respaldo, que podía producir copias
incompletas en silencio; y una docena de defectos de interfaz. `ESTADO.md` tiene el inventario
completo con archivo y línea.

## Lo que falta, y es exactamente tu trabajo

### 1. Aplicar el recálculo pendiente (bloqueante, hazlo primero)

Hay **cuatro correcciones de metodología desplegadas en el código pero NO aplicadas a los datos**,
porque cambian las banderas de 1,47 M procesos y requieren un recálculo:

- IC-02 ahora excluye el catálogo electrónico (eran 65 497 de sus 109 642 disparos).
- IT-02 evalúa la exclusión de ínfima por monto (antes no excluía nada; 23% de sus disparos).
- IP-02 estaba **invertido** y ahora solo marca el exceso sobre el presupuesto.
- El umbral de ínfima salta a USD 10 000 el **7 de julio** de 2025, no el 7 de octubre.

Para aplicarlo: `/admin/auditoria` → botón "Re-normalizar banderas", desde mi Chrome con mi sesión.
Tarda 10-15 min y el proxy corta con un 502 a los 300 s aunque el trabajo siga bien: verifica por
los datos, no por la respuesta HTTP. La memoria y el WAL ya están acotados, así que es seguro.

**Verifica después, en producción, con evidencia:**
- Un proceso de catálogo electrónico con monto alto ya no debe tener IC-02.
- `SELECT COUNT(*) FROM procedures WHERE source_year=2024 AND flags LIKE '%IP-02%'` debe bajar
  drásticamente desde 1 704, y los que queden deben tener `award_amount > budget_amount`.
- Los disparos de IC-02 deben bajar cerca de un 60%.

### 2. Arreglar las citas a la metodología OCP (el riesgo de credibilidad más alto)

La plataforma cita **13 referencias** a la *Red Flags in Public Procurement Guide 2024* de la Open
Contracting Partnership (R018, R055, R003, R061, R011, R059, R069, R051, R070, R011, R001, R013,
R039). Una investigación previa concluyó que **8 de las 13 apuntan a una bandera que mide otra
cosa**, y dos sin ningún parecido conceptual. Además la URL publicada en `Methodology.tsx`
devuelve **404** y el pie mezcla el título de la edición 2016 con el año 2024.

**No des por buena esa conclusión: verifícala tú.** Abre el PDF de la guía
(https://www.open-contracting.org/wp-content/uploads/2024/12/OCP2024-RedFlagProcurement-1.pdf),
localiza cada código y compáralo con lo que hace el indicador en `flag-engine.ts`. Corrige las que
estén mal, quita la cita de las que no tengan equivalente en la guía, y arregla la URL y el título.
Una cita falsa es peor que ninguna cita: un auditor la comprueba en treinta segundos.

### 3. Cerrar el cómputo de días hábiles con norma citada

`businessDays()` en `flag-engine.ts` tiene tres defectos, y la norma ya está verificada:

- **Cuenta el día inicial y no debe.** El COA Art. 158 es expreso: los términos se computan "a
  partir del día hábil siguiente". Hoy, publicar y adjudicar el mismo día devuelve 1 en vez de 0,
  así que "menos de 3 días hábiles" equivale en la práctica a menos de 2 días transcurridos.
- **No descuenta feriados y debe.** COA Art. 159: "Se excluyen del cómputo de términos los días
  sábados, domingos y los declarados feriados". Y el COGEP Art. 78 añade que rige también el
  **traslado** de feriados, no la fecha nominal.
- **Depende de la hora del servidor.** Usa `getDay()`/`setDate()` sin truncar a medianoche,
  mientras las fechas del SERCOP traen offset `-05:00`. Medido: con el mismo intervalo de un día
  calendario, 395 procesos reportan "1 día hábil" y 616 reportan "2".

Los feriados nacionales son los del **Código del Trabajo Art. 65** (texto vigente reformado por la
Ley de R.O. Suplemento 906 de 20-dic-2016): 1 de enero, lunes y martes de Carnaval, Viernes Santo,
1 y 24 de mayo, 10 de agosto, 9 de octubre, 2 y 3 de noviembre, 25 de diciembre. Tres son móviles
(atados a la Pascua). Traslada a lunes si cae martes, a viernes si cae miércoles o jueves, y en
fines de semana al viernes anterior o lunes posterior, **excepto** 1 de enero, 25 de diciembre y
martes de Carnaval. **Verifica ese artículo en Lexis** y contrasta el calendario generado contra el
calendario oficial de cada año antes de usarlo, porque el Código no resuelve los solapamientos.

### 4. Decidir y arreglar los mínimos de plazo de IT-01

Los 9/13/17 días que usa IT-01 **corresponden al tramo publicación→adjudicación** (suma de los
mínimos de los Arts. 91, 96 y 111 del Reglamento vigente), pero IT-01 mide
**publicación→límite de ofertas**, y para ese tramo los mínimos son **6/10/14/18**. Falta además el
cuarto tramo (más de USD 1 000 000).

Y hay un problema mayor: **esos mínimos escalonados no existían antes del 28 de octubre de 2025**.
El Reglamento anterior remitía a los pliegos. Aplicarlos a procesos de 2019 a 2025 es un
anacronismo normativo que un auditor va a marcar. Verifica las tablas en Lexis (Reglamento vigente,
Decreto 193, R.O. 9.º Suplemento 153 de 28-oct-2025, Arts. 91, 96 y 111) y propóndeme dos opciones
con su consecuencia antes de tocar nada.

### 5. Corregir la cita legal del fraccionamiento

CC-05 cita el **Art. 50 de la LOSNCP**. Eso ya no es correcto: hoy la prohibición general está en
la **Disposición General Tercera** (agregada el 7-oct-2025) y antes estaba en la Disposición General
Segunda. El Art. 50 era "Procedimiento de Cotización" y no hablaba de fraccionamiento. Verifícalo
en Lexis y corrige la cita en las tres superficies.

### 6. Usar el mandato de IA como respaldo normativo

El **Decreto Ejecutivo 461** (R.O. 3.º Suplemento 337 de 30-jul-2026) agregó los Arts. 426 y 426.1
al Reglamento, que ordenan al SERCOP usar inteligencia artificial y minería de datos para detectar
riesgos, y enumeran criterios objetivos: "identificación de vinculaciones, inhabilidades, indicios
de colusión o subdivisión de contratos" y "análisis de patrones históricos y recurrencia".
El Art. 426.1 exige además "evidencia objetiva y verificable, prescindiendo de valoraciones
subjetivas", que es exactamente lo que hace un motor de reglas deterministas.

**Lee el texto completo en Lexis** y úsalo para respaldar los indicadores que hoy no tienen fuente.
Cambia mi posición: no soy un tercero opinando sobre entidades públicas, soy un observatorio que
aplica los criterios que la norma manda aplicar al regulador.

### 7. Documentar la trazabilidad de cada indicador

Este es el entregable que convence a un auditor de metodología. Cada uno de los 15 indicadores debe
declarar de dónde viene su criterio y su umbral, con tres orígenes posibles y bien distinguidos:

- **Derivado de norma ecuatoriana** (el más fuerte): cita artículo y Registro Oficial.
- **Tomado de un estándar reconocido**: cita documento, página y código.
- **Calibrado sobre los datos**: legítimo, pero **hay que declararlo como tal** y explicar el
  criterio de calibración.

Hoy la plataforma mezcla los tres sin distinguirlos, y ese es el hueco real, más que cualquier
umbral concreto. Varios umbrales no tienen fuente declarada: el 40% de CC-02, los 5 años de CC-03,
los 30 caracteres de TR-02, el 15% de IP-02, los 3 días de IT-02, los 2 consorcios de CC-04. Y la
escala de pesos 3/8/18/30 y los cortes de riesgo 0-10/11-30/31-60/61-100 tampoco.

### 8. Resolver el respaldo (pendiente operativo)

El volumen está al **54%** (4,69 GB totales, 2,16 GB libres; la base pesa 2,51 GB y no tiene
páginas libres, así que un VACUUM no recuperaría nada). El respaldo no puede correr porque un
snapshot completo pesaría lo mismo que la base y no cabe. Tres salidas, mi orden de preferencia:
respaldo lógico comprimido al vuelo sin archivo intermedio; ampliar el volumen a 10 GB (toca mi
tope de $20/mes, decisión mía); o dejarlo. **Quiero el respaldo funcionando y una copia en mi
Google Drive.** No tengo Google Drive de escritorio instalado, así que usa mi Chrome para subirla.

### 9. Pendientes menores ya inventariados

- El tope de 300 páginas por término en `local-sync.ts` deja huecos de datos silenciosos.
- `railway.toml` con `ON_FAILURE` no recupera un proceso vivo pero colgado.
- Tras una corrupción, la app arranca con base vacía y el healthcheck queda en verde.
- El descuento por correlación que se publica está mal puesto: IC-01 e IC-02 **co-ocurren cero
  veces**, así que el 50% de ese par nunca se aplica, mientras IC-02 y TR-03 co-ocurren en el 99,8%
  de los casos sumando 48 puntos por el mismo hecho **sin** descuento. Verifícalo con datos y
  replantéalo.

## Cómo quiero que trabajes

**Usa subagentes para el trabajo pesado y sé tú el verificador.** Funciona así:

- `Agent` para tareas acotadas: inventariar todos los puntos donde el código lee algo, investigar
  una norma, revisar un archivo grande. Pasa `run_in_background: false` cuando necesites el
  resultado para seguir. Fija `model` explícito en cada agente, porque heredar el modelo de la
  sesión ha causado choques con límites de crédito.
- `Workflow` para investigaciones o revisiones en paralelo con varias líneas y una síntesis. En los
  scripts, `parallel()` espera **funciones**, no promesas: envuelve cada llamada como
  `() => agent(...)`. Usa `schema` para que devuelvan datos estructurados en vez de prosa.
- **Nunca tomes el resultado de un subagente como verdad.** En esta sesión un informe de
  metodología acertó en lo esencial pero traía una cifra desactualizada, y una revisión de código
  anterior fue parcialmente injusta con una función. Verifica las afirmaciones que vayan a cambiar
  código o datos, leyendo el código o consultando producción. **Un resultado de verificación vacío
  nunca es una aprobación.**
- Si un agente reporta un hallazgo, pon otro a **refutarlo** antes de actuar. Ese patrón encontró
  30 defectos reales y descartó 6 falsos positivos.

**Skills que te van a servir**, invócalas cuando apliquen: `anthropic-skills:esfuerzo-maximo` para
elevar el estándar de verificación; `anthropic-skills:seguridad` si tocas autenticación o datos
personales; `anthropic-skills:verificar-logica` cuando generes cálculos o clasificaciones que
dependan de norma; `data:validate-data` antes de presentarme cualquier cifra;
`superpowers:verification-before-completion` antes de decirme que algo está listo. Y si vas a
investigar norma, la disciplina es la de un investigador jurídico: cita artículo, Registro Oficial y
fecha, y lo que no puedas confirmar va a una lista de "no confirmado" en vez de suponerse.

## Reglas que no quiero repetirte

1. **Typecheck, tests y build limpios ANTES de cada push, y verificación en producción después.**
   Encadena los comandos de forma que **aborten si una compuerta falla**: en la sesión anterior un
   comando encadenado subió un commit con un import faltante porque el typecheck falló y el push se
   ejecutó igual. Eso rompió la portada unos minutos.
2. **Hay un usuario externo real** usando la plataforma. Nada puede romperse para él.
3. **Ninguna cifra sin verificar.** En la sesión anterior se me estimó el uso del volumen en 93%
   cuando era 54%, y el peso de una columna diez veces por encima. Ambas se corrigieron midiendo.
   Mide antes de afirmar.
4. **Escribe pruebas de cada corrección**, sobre todo de las que fallan en silencio. Las pruebas de
   esta plataforma han atrapado defectos reales durante el propio desarrollo, incluido uno donde el
   orden de un spread hacía lo contrario de lo buscado.
5. **Actualiza `ESTADO.md`** con lo que hagas: es el mecanismo de continuidad entre sesiones.
6. **Regla 10**: si cambias una regla, un umbral o un peso en `flag-engine.ts`, actualiza en el
   MISMO commit `client/src/pages/Methodology.tsx` y el objeto `METHODOLOGY` de `mcp-server.ts`.
7. **Regla 11**: una sola definición de monto. `MONTO_SQL` y `montoPlausible()` deben ser
   equivalentes; web y MCP nunca pueden dar cifras distintas.
8. **No me pases tareas de terminal.** Yo solo doy el OK inicial y las decisiones de negocio.
   Si algo requiere una acción mía (aprobar un permiso, decidir precios o accesos), pídemelo en una
   línea y explícame por qué solo yo puedo hacerlo.
9. **Prueba en caliente cada pantalla** con mi Chrome: portada, búsqueda con sus filtros y
   ordenamientos, ficha de proceso, perfiles de comprador y proveedor, rankings con sus tres
   pestañas, metodología, y las tres pantallas de administración. Y las 10 herramientas del MCP.

## Decisiones mías que están pendientes

- Los mínimos de plazo de IT-01 (punto 4): dame las dos opciones con su consecuencia.
- Si excluimos o mantenemos algo más del catálogo electrónico en otros indicadores.
- El modelo de cobro de la plataforma.
- Ampliar el volumen de Railway (cuesta dinero).
- `xgonzalez14@hotmail.com` tiene acceso `viewer` y nunca ha ingresado. Déjalo, ya lo decidí.
- La rama `feat/auth-hardening` en el remoto no tiene ningún commit que no esté en `main` y va 27
  commits atrasada: se puede borrar sin perder nada.

Empieza leyendo los tres archivos, dime en pocas líneas qué encontraste y cuál es tu plan, y
arranca por el recálculo del punto 1.
