#!/bin/bash

# --- StockSim Pro - 模擬股市交易啟動腳本 ---

echo -e "\033[1;36m##################################################\033[0m"
echo -e "\033[1;36m#                                                #\033[0m"
echo -e "\033[1;36m#   StockSim Pro - 模擬股市交易啟動腳本           #\033[0m"
echo -e "\033[1;36m#                                                #\033[0m"
echo -e "\033[1;36m##################################################\033[0m"
echo ""

# 1. 檢查 Node.js 是否安裝
if ! command -v node &> /dev/null
then
    echo -e "\033[1;31m[錯誤] 找不到 Node.js！請從 https://nodejs.org/ 安裝。\033[0m"
    exit 1
fi

echo -e "\033[1;32m[1/3] 正在檢查依賴元件...\033[0m"
if [ ! -d "node_modules" ]; then
    echo -e "\033[0;33m[提示] 第一次執行，正在執行 npm install 準備環境...\033[0m"
    npm install
else
    echo -e "\033[0;33m[提示] 依賴元件已就緒。\033[0m"
fi

echo ""
echo -e "\033[1;32m[2/3] 正在啟動伺服器...\033[0m"
echo -e "\033[0;33m[提示] 伺服器將運行在 http://localhost:3000\033[0m"
echo ""

# 3. 在背景啟動並嘗試打開瀏覽器 (等候 2 秒)
npm start &
sleep 2

# 根據作業系統打開瀏覽器 (Linux/macOS)
if command -v open &> /dev/null; then
    open http://localhost:3000
elif command -v xdg-open &> /dev/null; then
    xdg-open http://localhost:3000
fi

echo -e "\033[1;32m[3/3] 啟動成功！請查看瀏覽器視窗。\033[0m"
echo ""
echo "按下 [Ctrl+C] 可停止並結束程式。"
echo ""

# 讓背景進程跑到最後
wait
