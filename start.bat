@echo off
title DuoSync Server
echo ========================================================
echo   Starting DuoSync Collaborative Server...
echo ========================================================
echo.

:: Check if agy-node or node is in path
where agy-node >nul 2>&1
if %errorlevel% equ 0 (
    echo Running with agy-node...
    agy-node server.js
    goto :end
)

where node >nul 2>&1
if %errorlevel% equ 0 (
    echo Running with node...
    node server.js
    goto :end
)

echo [ERROR] Neither 'agy-node' nor 'node' was found in PATH.
echo Trying installed Node.js paths...
if exist "C:\Users\PRO\AppData\Local\Programs\nodejs\node.exe" (
    "C:\Users\PRO\AppData\Local\Programs\nodejs\node.exe" server.js
    goto :end
)
if exist "C:\Users\PRO\AppData\Roaming\Antigravity\bin\agy-node.cmd" (
    "C:\Users\PRO\AppData\Roaming\Antigravity\bin\agy-node.cmd" server.js
    goto :end
)

pause

:end
