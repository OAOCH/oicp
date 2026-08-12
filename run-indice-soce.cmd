@echo off
REM ── INDICE DEL SOCE: las dos fechas del Art. 96 ─────────────────────────────
REM El Art. 96 del Reglamento cuenta el termino para entregar ofertas desde que fenece la fecha
REM limite para CONTESTAR preguntas. Esa fecha NO esta en los datos abiertos del SERCOP (la API
REM publica la de PREGUNTAR, que va de 2 a 6 dias antes), y la fecha limite de ofertas viene vacia
REM en el 93% de los procesos. Las dos si estan en la ficha publica del portal.
REM
REM El enganche no es directo: el ocid NO contiene el id interno del proceso (su numero final es
REM el de la ENTIDAD). Por eso se recorren los id del portal, se lee el CODIGO de cada ficha y se
REM cruza por ahi. Y el cruce solo se acepta si la fecha limite de PREGUNTAS del portal coincide
REM con la que ya tenemos de los datos abiertos: sin ese testigo, un codigo repetido entre
REM entidades publicaria fechas de otro proceso en una ficha con nombre y apellido.
REM
REM Va de MAYOR A MENOR: los id crecen con el tiempo, asi que se cubren primero los procesos
REM recientes, que son a los que les aplica la tabla del Art. 96 (vigente desde el 28-oct-2025).
REM Si el barrido se corta a medias, lo cubierto es lo util.
REM
REM Ritmo ~1,6 peticiones por segundo, de persona navegando. Reanudable: cursor en
REM .soce-cursor.json. Se puede cerrar sin miedo.
cd /d C:\Users\oscar\oicp-work\oicp
echo. >> indice-soce.log
echo ======== inicio %DATE% %TIME% ======== >> indice-soce.log
call npx tsx server/local-sync.ts --indice-soce --budget-min 600 >> indice-soce.log 2>&1
echo ======== fin %DATE% %TIME% (codigo %ERRORLEVEL%) ======== >> indice-soce.log
