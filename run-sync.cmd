@echo off
cd /d C:\Users\oscar\oicp-work\oicp
npx tsx server/local-sync.ts >> sync.log 2>&1
