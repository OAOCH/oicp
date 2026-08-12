@echo off
REM ── RELLENADO DEL OICP DESDE LA FUENTE ──────────────────────────────────────
REM Repara los procesos cuyo presupuesto se guardo mal (el texto "USD" en vez de la cifra) y los
REM que no tienen la fecha de cierre de preguntas.
REM
REM Corre en esta PC porque el SERCOP bloquea las IP de datacenter: desde Railway falla.
REM Es REANUDABLE. Se puede cerrar sin miedo.
REM
REM DOS PASADAS, en este orden:
REM
REM 1. MASIVA. El SERCOP publica volcados por anio que su documentacion no menciona. Medido:
REM    releer 174.547 procesos uno por uno son ~54 horas y 174.547 peticiones; por volcados son
REM    unos 20 minutos y 8 peticiones. Cubre practicamente todo.
REM
REM 2. UNO POR UNO, con presupuesto de 90 minutos, solo para lo que los volcados no traigan
REM    (procesos que en el corte del volcado seguian en fase de planificacion). Reanudable por
REM    cursor, asi que avanza por tandas dia a dia hasta agotarlos.
cd /d C:\Users\oscar\oicp-work\oicp
echo. >> rellenado.log
echo ======== inicio %DATE% %TIME% ======== >> rellenado.log
echo -------- pasada masiva -------- >> rellenado.log
call npx tsx server/local-sync.ts --reparar-masivo >> rellenado.log 2>&1
echo -------- pasada uno por uno (lo que el volcado no trajo) -------- >> rellenado.log
call npx tsx server/local-sync.ts --reparar --budget-min 90 --conc 20 >> rellenado.log 2>&1
echo ======== fin %DATE% %TIME% (codigo %ERRORLEVEL%) ======== >> rellenado.log
