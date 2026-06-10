@echo off
title FutPicks - Logos Brasileirao
cd /d "C:\Users\ianal\OneDrive\Escritorio\ACTUARIO CUARTO\Base de Datos\FutPicks_Backend"
echo Descargando logos faltantes via ESPN API...
node scripts\downloadLogos.js
echo.
pause
