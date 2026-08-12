@echo off
REM ── RELLENADO DEL OICP DESDE LA FUENTE ──────────────────────────────────────
REM Vuelve a pedirle al SERCOP los procesos cuyo presupuesto se guardo mal (el texto
REM "USD" en vez de la cifra) y los que no tienen la fecha de cierre de preguntas.
REM
REM Corre en esta PC porque el SERCOP bloquea las IP de datacenter: desde Railway falla.
REM Es REANUDABLE: guarda el cursor en .sync-repair-cursor.json. Si se corta por lo que sea,
REM la siguiente corrida sigue exactamente donde se quedo. Se puede cerrar sin miedo.
REM
REM Presupuesto de 600 minutos (10 horas) por corrida.
REM
REM --conc 20: la fuente tarda de 7 a 18 s por peticion y eso NO es limite de tasa, es latencia,
REM asi que el paralelismo multiplica el rendimiento. Medido: en serie 0,08 proc/s; con 12 hilos
REM 0,66 proc/s y cero fallos. El techo de emision lo sigue imponiendo el limitador (una peticion
REM cada 350 ms como maximo, pase lo que pase), y una respuesta 429 frena a TODOS los hilos.
cd /d C:\Users\oscar\oicp-work\oicp
echo. >> rellenado.log
echo ======== inicio %DATE% %TIME% ======== >> rellenado.log
call npx tsx server/local-sync.ts --reparar --budget-min 600 --conc 20 >> rellenado.log 2>&1
echo ======== fin %DATE% %TIME% (codigo %ERRORLEVEL%) ======== >> rellenado.log
