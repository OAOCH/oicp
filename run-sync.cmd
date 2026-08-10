@echo off
cd /d C:\Users\oscar\oicp-work\oicp
call npx tsx server/local-sync.ts >> sync.log 2>&1
