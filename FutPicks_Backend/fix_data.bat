@echo off
title FutPicks - Fix Data (Duplicados + Liga MX Rounds)
cd /d "C:\Users\ianal\OneDrive\Escritorio\ACTUARIO CUARTO\Base de Datos\FutPicks_Backend"
echo.
echo [1/2] Limpiando duplicados Brasileirao + MLS y agregando columna match_round...
node scripts\cleanupDuplicates.js
echo.
echo [2/2] Parcheando rondas Liga MX (Regular Season vs Liguilla)...
node scripts\patchLigaMXRounds.js
echo.
echo LISTO. Reinicia el servidor para aplicar los cambios del backend.
pause
