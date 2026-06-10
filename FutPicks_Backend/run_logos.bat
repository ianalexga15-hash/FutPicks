@echo off
title FutPicks - Patch Logos Faltantes
cd /d "C:\Users\ianal\OneDrive\Escritorio\ACTUARIO CUARTO\Base de Datos\FutPicks_Backend"
echo.
echo ===================================================
echo  FUTPICKS - Patch Logos (equipos historicos)
echo ===================================================
echo.
node scripts\patchMissingLogos.js
echo.
echo Presiona cualquier tecla para cerrar...
pause > nul
