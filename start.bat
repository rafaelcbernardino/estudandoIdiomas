@echo off
title Estudando Idiomas — Servidor Local
chcp 65001 >nul

echo.
echo  =====================================================
echo    Estudando Idiomas  ^|  Servidor Local
echo  =====================================================
echo.
echo  Iniciando o servidor...
echo.

:: Verifica se node_modules existe
if not exist "%~dp0node_modules\" (
    echo  Instalando dependencias pela primeira vez...
    cd /d "%~dp0"
    call npm install
    echo.
)

:: Mata qualquer processo anterior na porta 3000
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING 2^>nul') do (
    taskkill /F /PID %%a >nul 2>&1
)

:: Inicia o servidor em background e abre o navegador
cd /d "%~dp0"
start "" /b node server.js

:: Aguarda o servidor subir
echo  Aguardando servidor subir...
timeout /t 2 /nobreak >nul

:: Abre o navegador
start "" "http://localhost:3000"

echo  Servidor rodando em: http://localhost:3000
echo.
echo  Pressione CTRL+C ou feche esta janela para parar o servidor.
echo.

:: Mantem a janela aberta e mostra os logs
node server.js
