@echo off
setlocal enabledelayedexpansion

echo ##################################################
echo #                                                #
echo #   StockSim Pro - 模擬股市交易啟動腳本           #
echo #                                                #
echo ##################################################
echo.

:: 1. 檢查 Node.js 是否安裝
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [錯誤] 找不到 Node.js！請先安裝 Node.js (https://nodejs.org/)
    pause
    exit /b
)

echo [1/3] 正在檢查環境與依賴...
if not exist "node_modules\" (
    echo [提示] 第一次執行，正在安裝必要的 Node.js 依賴 (npm install)...
    call npm install
) else (
    echo [提示] 依賴已安裝，略過安裝步驟。
)

echo.
echo [2/3] 正在啟動伺服器...
echo [提示] 伺服器將運行在 http://localhost:3000
echo.

:: 3. 啟動伺服器並嘗試打開瀏覽器 (等候 2 秒)
start /b cmd /c "npm start"
timeout /t 2 /nobreak >nul
start http://localhost:3000

echo [3/3] 系統已啟動！
echo.
echo * 若要停止遊戲，請直接關閉此視窗，或按下 Ctrl+C。
echo * 資料已保存於瀏覽器 localStorage 中。
echo.

:: 讓視窗保持開啟，直到使用者按下 Ctrl+C
echo 正在監控伺服器輸出：
echo --------------------------------------------------
pause
