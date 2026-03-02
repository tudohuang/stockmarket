/* ============================================
   StockSim Pro - Main Application Logic
   ============================================ */

// ============================================
// State Management
// ============================================

const INITIAL_CASH = 1_000_000;

const state = {
    cash: INITIAL_CASH,
    exchangeRate: 32.0, // USD to TWD
    portfolio: {},      // { symbol: { name, qty, avgPrice, currency, leverage } }
    transactions: [],   // [{ date, type, symbol, name, qty, price, total, currency }]
    leaderboard: [],    // [{ date, returnPct, totalAssets }]
    currentStock: null, // { symbol, name, price, ... }
    currentAction: 'buy',
    currentMarket: 'us',
    chartData: [],
    chartRange: '1mo',
    currentLeverage: 1,
};

// Load from localStorage
function loadState() {
    try {
        const saved = localStorage.getItem('stocksim_state');
        if (saved) {
            const parsed = JSON.parse(saved);
            state.cash = parsed.cash ?? INITIAL_CASH;
            state.portfolio = parsed.portfolio ?? {};
            state.transactions = parsed.transactions ?? [];
            state.leaderboard = parsed.leaderboard ?? [];
        }
    } catch (e) {
        console.warn('Failed to load state:', e);
    }
}

function saveState() {
    try {
        localStorage.setItem('stocksim_state', JSON.stringify({
            cash: state.cash,
            portfolio: state.portfolio,
            transactions: state.transactions,
            leaderboard: state.leaderboard,
        }));
    } catch (e) {
        console.warn('Failed to save state:', e);
    }
}

// ============================================
// Utilities
// ============================================

function formatCurrency(value, currency = 'TWD') {
    if (currency === 'TWD') {
        return 'NT$' + Number(value).toLocaleString('zh-TW', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        });
    }
    return '$' + Number(value).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function convertToBase(amount, currency) {
    if (currency === 'USD') return amount * (state.exchangeRate || 32.0);
    return amount;
}

function formatNumber(value) {
    if (value >= 1e12) return (value / 1e12).toFixed(2) + 'T';
    if (value >= 1e9) return (value / 1e9).toFixed(2) + 'B';
    if (value >= 1e6) return (value / 1e6).toFixed(2) + 'M';
    if (value >= 1e3) return (value / 1e3).toFixed(1) + 'K';
    return value?.toLocaleString() ?? '—';
}

function formatPercent(value) {
    if (value == null) return '—';
    const sign = value >= 0 ? '+' : '';
    return sign + value.toFixed(2) + '%';
}

function formatChange(value) {
    if (value == null) return '—';
    const sign = value >= 0 ? '+' : '';
    return sign + value.toFixed(2);
}

function getChangeClass(value) {
    if (value > 0) return 'change-up';
    if (value < 0) return 'change-down';
    return 'change-neutral';
}

function formatDate(date) {
    const d = new Date(date);
    return d.toLocaleDateString('zh-TW', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
    });
}

function debounce(fn, ms) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}

// ============================================
// UI Helpers
// ============================================

function updateValWithFlash(elId, newText, newClass) {
    const el = document.getElementById(elId);
    if (!el) return;

    // Only flash if text changed OR class changed (e.g. up to down)
    if (el.textContent !== newText || (newClass && !el.classList.contains(newClass))) {
        let isUp = false;
        let isDown = false;

        const oldVal = parseFloat(el.textContent.replace(/[^0-9.-]+/g, ""));
        const newVal = parseFloat(newText.replace(/[^0-9.-]+/g, ""));

        if (!isNaN(oldVal) && !isNaN(newVal)) {
            if (newVal > oldVal) isUp = true;
            else if (newVal < oldVal) isDown = true;
        }

        el.textContent = newText;
        if (newClass) {
            el.className = newClass;
        }

        el.classList.remove('flash-up', 'flash-down');
        void el.offsetWidth; // trigger reflow

        if (isUp) el.classList.add('flash-up');
        else if (isDown) el.classList.add('flash-down');
        else el.classList.add('flash-up');
    }
}

// ============================================
// Toast Notifications
// ============================================

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span class="toast-icon">${icons[type]}</span><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast-out');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ============================================
// Navigation
// ============================================

const pageTitles = {
    dashboard: '市場總覽',
    trade: '股票交易',
    portfolio: '我的持倉',
    history: '交易紀錄',
    leaderboard: '績效排行'
};

function navigateTo(page) {
    // Update nav buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.page === page);
    });

    // Update pages
    document.querySelectorAll('.page').forEach(p => {
        p.classList.toggle('active', p.id === `page-${page}`);
    });

    // Update title
    document.getElementById('page-title').textContent = pageTitles[page] || '';

    // Refresh page-specific data
    if (page === 'portfolio') refreshPortfolio();
    if (page === 'history') refreshHistory();
    if (page === 'leaderboard') refreshLeaderboard();
    if (page === 'dashboard') {
        refreshDashboardStats();
    }

    // Close sidebar on mobile
    document.getElementById('sidebar').classList.remove('open');
}

// ============================================
// Search
// ============================================

const searchInput = document.getElementById('global-search');
const searchResults = document.getElementById('search-results');

const performSearch = debounce(async (query) => {
    if (!query || query.length < 1) {
        searchResults.classList.remove('show');
        return;
    }

    try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();

        if (data.length === 0) {
            searchResults.innerHTML = '<div class="search-result-item" style="justify-content:center;color:var(--text-muted)">無搜尋結果</div>';
        } else {
            searchResults.innerHTML = data.slice(0, 8).map(item => `
        <div class="search-result-item" data-symbol="${item.symbol}">
          <div class="search-result-info">
            <span class="search-result-symbol">${item.symbol}</span>
            <span class="search-result-name">${item.name}</span>
          </div>
          <span class="search-result-exchange">${item.exchange || ''}</span>
        </div>
      `).join('');

            searchResults.querySelectorAll('.search-result-item[data-symbol]').forEach(el => {
                el.addEventListener('click', () => {
                    selectStock(el.dataset.symbol);
                    searchResults.classList.remove('show');
                    searchInput.value = '';
                });
            });
        }

        searchResults.classList.add('show');
    } catch (e) {
        console.error('Search error:', e);
    }
}, 350);

searchInput.addEventListener('input', (e) => performSearch(e.target.value));
searchInput.addEventListener('focus', () => {
    if (searchInput.value) performSearch(searchInput.value);
});
document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-container')) {
        searchResults.classList.remove('show');
    }
});

// ============================================
// Stock Selection & Detail
// ============================================

async function selectStock(symbol) {
    // Navigate to trade page
    navigateTo('trade');

    const headerCard = document.getElementById('stock-header-card');
    headerCard.innerHTML = '<div class="stock-header-placeholder"><p>載入中...</p></div>';

    try {
        const res = await fetch(`/api/quote/${encodeURIComponent(symbol)}`);
        const data = await res.json();

        if (data.error) {
            headerCard.innerHTML = '<div class="stock-header-placeholder"><p>無法取得股票資訊</p></div>';
            return;
        }

        state.currentStock = data;
        state.currentLeverage = 1;

        // Reset leverage buttons UI
        document.querySelectorAll('.leverage-btn').forEach(b => {
            b.classList.toggle('active', parseInt(b.dataset.lever) === 1);
        });

        // Try to update company info if available
        const compPanel = document.getElementById('company-panel');
        if (data.sector || data.summary) {
            compPanel.style.display = 'block';
            document.getElementById('comp-sector').textContent = data.sector || '--';
            document.getElementById('comp-industry').textContent = data.industry || '--';
            document.getElementById('comp-summary').textContent = data.summary || '暫無資訊';

            const webBtn = document.getElementById('comp-website');
            if (data.website) {
                webBtn.href = data.website;
                webBtn.style.display = 'inline-block';
            } else {
                webBtn.style.display = 'none';
            }
        } else {
            compPanel.style.display = 'none';
        }

        // Setup stock header
        const changeClass = data.changePercent >= 0 ? 'change-up' : 'change-down';
        const changeArrow = data.changePercent >= 0 ? '▲' : '▼';

        headerCard.innerHTML = `
      <div class="stock-info-row">
        <div class="stock-main-info">
          <div class="stock-detail-symbol">${data.symbol}</div>
          <div class="stock-detail-name">${data.name}</div>
          <div class="stock-detail-exchange">${data.exchange} · ${data.currency} · ${data.marketState === 'REGULAR' ? '🟢 交易中' : '🔴 休市'}</div>
        </div>
        <div class="stock-price-info">
          <div class="stock-detail-price">${formatCurrency(data.price, data.currency)}</div>
          <div class="stock-detail-change ${changeClass}">
            ${changeArrow} ${formatChange(data.change)} (${formatPercent(data.changePercent)})
          </div>
        </div>
      </div>
      <div class="stock-stats-grid">
        <div class="stock-stat">
          <span class="stock-stat-label">開盤</span>
          <span class="stock-stat-value">${data.open?.toFixed(2) ?? '—'}</span>
        </div>
        <div class="stock-stat">
          <span class="stock-stat-label">最高</span>
          <span class="stock-stat-value">${data.dayHigh?.toFixed(2) ?? '—'}</span>
        </div>
        <div class="stock-stat">
          <span class="stock-stat-label">最低</span>
          <span class="stock-stat-value">${data.dayLow?.toFixed(2) ?? '—'}</span>
        </div>
        <div class="stock-stat">
          <span class="stock-stat-label">前收</span>
          <span class="stock-stat-value">${data.previousClose?.toFixed(2) ?? '—'}</span>
        </div>
        <div class="stock-stat">
          <span class="stock-stat-label">成交量</span>
          <span class="stock-stat-value">${formatNumber(data.volume)}</span>
        </div>
        <div class="stock-stat">
          <span class="stock-stat-label">市值</span>
          <span class="stock-stat-value">${formatNumber(data.marketCap)}</span>
        </div>
        <div class="stock-stat">
          <span class="stock-stat-label">52週高</span>
          <span class="stock-stat-value">${data.fiftyTwoWeekHigh?.toFixed(2) ?? '—'}</span>
        </div>
        <div class="stock-stat">
          <span class="stock-stat-label">52週低</span>
          <span class="stock-stat-value">${data.fiftyTwoWeekLow?.toFixed(2) ?? '—'}</span>
        </div>
      </div>
    `;

        // Show chart & order panel
        document.getElementById('chart-container').style.display = 'block';
        document.getElementById('order-panel').style.display = 'block';

        // Update order panel
        updateOrderPanel();

        // Load chart
        loadChart(symbol, state.chartRange);

    } catch (e) {
        console.error('Select stock error:', e);
        headerCard.innerHTML = '<div class="stock-header-placeholder"><p>載入失敗，請重試</p></div>';
    }
}

// ============================================
// Technical Analysis Tool
// ============================================

function updateTechnicalAnalysis(data) {
    const panel = document.getElementById('analysis-panel');
    if (!data || data.length < 2) {
        if (panel) panel.style.display = 'none';
        return;
    }
    if (panel) panel.style.display = 'block';

    const prices = data.map(d => d.close);
    const lastPrice = prices[prices.length - 1];

    let trendText = '橫盤整理';
    let trendClass = 'change-neutral';
    let ma20 = null;
    if (prices.length >= 20) {
        const sum20 = prices.slice(-20).reduce((a, b) => a + b, 0);
        ma20 = sum20 / 20;
        if (lastPrice > ma20 * 1.01) {
            trendText = '多頭向上 ↑ (大於20日線)';
            trendClass = 'change-up';
        } else if (lastPrice < ma20 * 0.99) {
            trendText = '空頭向下 ↓ (小於20日線)';
            trendClass = 'change-down';
        }
    } else {
        trendText = '資料不足20筆';
    }

    let rsi = null;
    let rsiText = '中性';
    let rsiClass = 'change-neutral';
    if (prices.length >= 15) {
        let gains = 0, losses = 0;
        for (let i = prices.length - 14; i < prices.length; i++) {
            const diff = prices[i] - prices[i - 1];
            if (diff > 0) gains += diff;
            else losses -= diff;
        }
        const avgGain = gains / 14;
        const avgLoss = losses / 14;
        if (avgLoss === 0) rsi = 100;
        else rsi = 100 - (100 / (1 + (avgGain / avgLoss)));

        if (rsi > 70) { rsiText = `過熱超買 (${rsi.toFixed(1)})`; rsiClass = 'change-down'; }
        else if (rsi < 30) { rsiText = `超跌反彈 (${rsi.toFixed(1)})`; rsiClass = 'change-up'; }
        else { rsiText = `中性 (${rsi.toFixed(1)})`; }
    } else {
        rsiText = '資料不足14筆';
    }

    let tip = '';
    if (rsi > 70) tip = '當 RSI 超過 70 時，代表短期漲勢過熱，潛在獲利了結賣壓較大。';
    else if (rsi < 30) tip = '當 RSI 低於 30 時，代表短期跌幅較深，可留意是否出現跌深反彈。';
    else if (ma20 && lastPrice > ma20) tip = '股價站上20日均線，表示中期趨勢偏多，若有回檔且不破均線可尋找買點。';
    else if (ma20 && lastPrice <= ma20) tip = '股價跌破20日均線，趨勢轉弱，交易風險較高，建議多觀察少操作。';
    else tip = '結合均線(確認大方向)與RSI(尋找進出場時機)能有效提高勝率。';

    const trendEl = document.getElementById('analysis-trend');
    const rsiEl = document.getElementById('analysis-rsi');
    const tipEl = document.getElementById('analysis-tip');

    if (trendEl) trendEl.innerHTML = `<span class="${trendClass}">${trendText}</span>`;
    if (rsiEl) rsiEl.innerHTML = `<span class="${rsiClass}">${rsiText}</span>`;
    if (tipEl) tipEl.textContent = tip;
}

// ============================================
// Chart (Canvas-based)
// ============================================

async function loadChart(symbol, range) {
    state.chartRange = range;

    // Update range button active state
    document.querySelectorAll('.range-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.range === range);
    });

    try {
        const res = await fetch(`/api/history/${encodeURIComponent(symbol)}?range=${range}`);
        const data = await res.json();

        if (data.error || data.length === 0) {
            showToast('無法載入圖表數據', 'error');
            return;
        }

        state.chartData = data;
        drawChart(data);
        updateTechnicalAnalysis(data);
    } catch (e) {
        console.error('Chart error:', e);
    }
}

function drawChart(data) {
    const canvas = document.getElementById('price-chart');
    const ctx = canvas.getContext('2d');

    // Handle DPI
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    const width = rect.width - 40; // padding
    const height = 350;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.scale(dpr, dpr);

    // Clear
    ctx.clearRect(0, 0, width, height);

    if (data.length < 2) return;

    const prices = data.map(d => d.close);
    const minPrice = Math.min(...prices) * 0.998;
    const maxPrice = Math.max(...prices) * 1.002;
    const priceRange = maxPrice - minPrice || 1;

    const padding = { top: 20, right: 60, bottom: 40, left: 10 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    const isUp = prices[prices.length - 1] >= prices[0];
    const lineColor = isUp ? '#10b981' : '#ef4444';
    const gradientTop = isUp ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)';
    const gradientBottom = 'rgba(0, 0, 0, 0)';

    // Grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    const gridLines = 5;
    for (let i = 0; i <= gridLines; i++) {
        const y = padding.top + (chartHeight / gridLines) * i;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();

        // Price labels
        const price = maxPrice - (priceRange / gridLines) * i;
        ctx.fillStyle = '#64748b';
        ctx.font = '11px JetBrains Mono, monospace';
        ctx.textAlign = 'right';
        ctx.fillText(price.toFixed(2), width - 5, y + 4);
    }

    // Draw area gradient
    const gradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
    gradient.addColorStop(0, gradientTop);
    gradient.addColorStop(1, gradientBottom);

    ctx.beginPath();
    data.forEach((d, i) => {
        const x = padding.left + (i / (data.length - 1)) * chartWidth;
        const y = padding.top + (1 - (d.close - minPrice) / priceRange) * chartHeight;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });

    // Close the area
    ctx.lineTo(padding.left + chartWidth, height - padding.bottom);
    ctx.lineTo(padding.left, height - padding.bottom);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Draw line
    ctx.beginPath();
    data.forEach((d, i) => {
        const x = padding.left + (i / (data.length - 1)) * chartWidth;
        const y = padding.top + (1 - (d.close - minPrice) / priceRange) * chartHeight;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Draw last point dot
    const lastX = padding.left + chartWidth;
    const lastY = padding.top + (1 - (prices[prices.length - 1] - minPrice) / priceRange) * chartHeight;

    ctx.beginPath();
    ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
    ctx.fillStyle = lineColor;
    ctx.fill();

    // Glow
    ctx.beginPath();
    ctx.arc(lastX, lastY, 8, 0, Math.PI * 2);
    ctx.fillStyle = isUp ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)';
    ctx.fill();

    // Date labels at bottom
    ctx.fillStyle = '#64748b';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    const labelCount = Math.min(6, data.length);
    for (let i = 0; i < labelCount; i++) {
        const idx = Math.floor((i / (labelCount - 1)) * (data.length - 1));
        const x = padding.left + (idx / (data.length - 1)) * chartWidth;
        const d = new Date(data[idx].date);
        const label = (state.chartRange === '1d' || state.chartRange === '5d')
            ? d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })
            : d.toLocaleDateString('zh-TW', { month: 'short', day: 'numeric' });
        ctx.fillText(label, x, height - 8);
    }
}

// Chart range buttons
document.querySelectorAll('.range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        if (state.currentStock) {
            loadChart(state.currentStock.symbol, btn.dataset.range);
        }
    });
});

// Resize handler
window.addEventListener('resize', debounce(() => {
    if (state.chartData.length > 0) drawChart(state.chartData);
}, 200));

// ============================================
// Order Panel
// ============================================

function updateOrderPanel() {
    const stock = state.currentStock;
    if (!stock) return;

    document.getElementById('order-symbol').value = stock.symbol;
    document.getElementById('order-price').value = formatCurrency(stock.price, stock.currency);
    document.getElementById('order-cash').textContent = formatCurrency(state.cash);

    const holding = state.portfolio[stock.symbol];
    const holdingField = document.getElementById('order-holding-field');
    if (holding && state.currentAction === 'sell') {
        holdingField.style.display = 'flex';
        document.getElementById('order-holding').textContent = holding.qty + ' 股';
    } else {
        holdingField.style.display = 'none';
    }

    updateOrderEstimate();
}

function updateOrderEstimate() {
    const stock = state.currentStock;
    if (!stock) return;

    const qty = parseInt(document.getElementById('order-qty').value) || 0;
    const total = qty * stock.price;
    const marginRatio = 1 / state.currentLeverage;
    const marginRequired = total * marginRatio;

    document.getElementById('order-estimate').textContent = formatCurrency(total, stock.currency);

    const marginField = document.getElementById('order-margin-field');
    if (state.currentLeverage > 1 && state.currentAction === 'buy') {
        marginField.style.display = 'flex';
        document.getElementById('order-margin-estimate').textContent = formatCurrency(marginRequired, stock.currency);
    } else {
        marginField.style.display = 'none';
    }
}

// Leverage buttons
document.querySelectorAll('.leverage-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        if (state.currentAction !== 'buy') return; // Cannot change leverage on sell tab conceptually right now
        document.querySelectorAll('.leverage-btn').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        state.currentLeverage = parseInt(btn.dataset.lever) || 1;
        updateOrderEstimate();
    });
});

// Order tabs (buy/sell)
document.querySelectorAll('.order-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.order-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        state.currentAction = tab.dataset.action;
        const submitBtn = document.getElementById('submit-order');

        if (state.currentAction === 'buy') {
            submitBtn.textContent = '確認買入';
            submitBtn.className = 'submit-order-btn buy-btn';

            // Enable leverage btns
            document.querySelectorAll('.leverage-btn').forEach(b => {
                b.style.opacity = '1';
                b.style.pointerEvents = 'auto';
            });
        } else {
            submitBtn.textContent = '確認賣出';
            submitBtn.className = 'submit-order-btn sell-btn';

            // Disable leverage btns
            document.querySelectorAll('.leverage-btn').forEach(b => {
                b.style.opacity = '0.5';
                b.style.pointerEvents = 'none';
            });
        }

        updateOrderPanel();
    });
});

// Qty buttons
document.getElementById('qty-minus').addEventListener('click', () => {
    const input = document.getElementById('order-qty');
    const val = parseInt(input.value) || 1;
    input.value = Math.max(1, val - 1);
    updateOrderEstimate();
});

document.getElementById('qty-plus').addEventListener('click', () => {
    const input = document.getElementById('order-qty');
    const val = parseInt(input.value) || 0;
    input.value = val + 1;
    updateOrderEstimate();
});

document.getElementById('order-qty').addEventListener('input', updateOrderEstimate);

// Quick qty buttons
document.querySelectorAll('.quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const stock = state.currentStock;
        if (!stock) return;

        const pct = parseInt(btn.dataset.pct) / 100;

        if (state.currentAction === 'buy') {
            const marginRatio = 1 / state.currentLeverage;
            // cash = total * marginRatio => total = cash / marginRatio
            const maxBuyableValueBase = state.cash / marginRatio;
            // convert maxBuyableValue back to stock currency
            const maxBuyableValue = stock.currency === 'USD' ? (maxBuyableValueBase / (state.exchangeRate || 32.0)) : maxBuyableValueBase;
            const maxQty = Math.floor((maxBuyableValue * pct) / stock.price);
            document.getElementById('order-qty').value = Math.max(1, maxQty);
        } else {
            const holding = state.portfolio[stock.symbol];
            if (holding) {
                document.getElementById('order-qty').value = Math.max(1, Math.floor(holding.qty * pct));
            }
        }

        updateOrderEstimate();
    });
});

// Submit order
document.getElementById('submit-order').addEventListener('click', () => {
    const stock = state.currentStock;
    if (!stock) return;

    const qty = parseInt(document.getElementById('order-qty').value);
    if (!qty || qty <= 0) {
        showToast('請輸入有效數量', 'error');
        return;
    }

    const total = qty * stock.price;
    const marginRatio = 1 / state.currentLeverage;
    const marginRequired = total * marginRatio;
    const marginRequiredBase = convertToBase(marginRequired, stock.currency);

    // Validation
    if (state.currentAction === 'buy') {
        if (marginRequiredBase > state.cash) {
            showToast('保證金不足！', 'error');
            return;
        }
    } else {
        const holding = state.portfolio[stock.symbol];
        if (!holding || holding.qty < qty) {
            showToast('持股數量不足！', 'error');
            return;
        }
        // Force sell leverage to match holding leverage
        if (holding) {
            state.currentLeverage = holding.leverage || 1;
        }
    }

    // Show confirmation modal
    showTradeModal(stock, qty, total, marginRequired, marginRequiredBase);
});

// ============================================
// Trade Modal
// ============================================

function showTradeModal(stock, qty, total, marginRequired, marginRequiredBase) {
    const modal = document.getElementById('modal-overlay');
    const title = document.getElementById('modal-title');
    const body = document.getElementById('modal-body');
    const confirmBtn = document.getElementById('modal-confirm');

    const isBuy = state.currentAction === 'buy';
    title.textContent = isBuy ? '確認買入' : '確認賣出';

    body.innerHTML = `
    <div class="modal-detail-row">
      <span class="modal-detail-label">股票</span>
      <span class="modal-detail-value">${stock.symbol} - ${stock.name}</span>
    </div>
    <div class="modal-detail-row">
      <span class="modal-detail-label">操作</span>
      <span class="modal-detail-value" style="color:${isBuy ? 'var(--green)' : 'var(--red)'}">${isBuy ? '買入' : '賣出'}</span>
    </div>
    <div class="modal-detail-row">
      <span class="modal-detail-label">價格</span>
      <span class="modal-detail-value">${formatCurrency(stock.price, stock.currency)}</span>
    </div>
    <div class="modal-detail-row">
      <span class="modal-detail-label">總數量</span>
      <span class="modal-detail-value">${qty} 股</span>
    </div>
    <div class="modal-detail-row">
      <span class="modal-detail-label">總面值金額</span>
      <span class="modal-detail-value">${formatCurrency(total, stock.currency)}</span>
    </div>
    <div class="modal-detail-row" style="border-top: 1px dashed rgba(255,255,255,0.1); padding-top:12px; margin-top:12px;">
      <span class="modal-detail-label">使用槓桿</span>
      <span class="modal-detail-value" style="color:var(--accent-primary)">${state.currentLeverage}x</span>
    </div>
    <div class="modal-detail-row">
      <span class="modal-detail-label" style="color:var(--yellow)">匯率 (USD/TWD)</span>
      <span class="modal-detail-value" style="color:var(--yellow)">${stock.currency === 'USD' ? state.exchangeRate.toFixed(2) : '1.00'}</span>
    </div>
    <div class="modal-detail-row">
      <span class="modal-detail-label" style="color:var(--yellow)">實際扣除本金 (約 TWD)</span>
      <span class="modal-detail-value" style="font-size:1.1rem; color:var(--yellow)">${formatCurrency(isBuy ? marginRequiredBase : 0, 'TWD')}</span>
    </div>
  `;

    confirmBtn.className = `modal-btn confirm ${isBuy ? 'confirm-buy' : 'confirm-sell'}`;
    confirmBtn.textContent = isBuy ? '確認買入' : '確認賣出';

    // Store pending trade
    modal._pendingTrade = { stock, qty, total, marginRequired, marginRequiredBase, action: state.currentAction, leverage: state.currentLeverage };
    modal.classList.add('show');
}

document.getElementById('modal-confirm').addEventListener('click', () => {
    const modal = document.getElementById('modal-overlay');
    const trade = modal._pendingTrade;
    if (!trade) return;

    executeTrade(trade);
    modal.classList.remove('show');
});

document.getElementById('modal-cancel').addEventListener('click', () => {
    document.getElementById('modal-overlay').classList.remove('show');
});

document.getElementById('modal-close').addEventListener('click', () => {
    document.getElementById('modal-overlay').classList.remove('show');
});

document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
        e.currentTarget.classList.remove('show');
    }
});

// ============================================
// Execute Trade
// ============================================

function executeTrade({ stock, qty, total, marginRequired, marginRequiredBase, action, leverage }) {
    if (action === 'buy') {
        state.cash -= marginRequiredBase;

        if (state.portfolio[stock.symbol]) {
            const existing = state.portfolio[stock.symbol];
            if (existing.leverage !== leverage) {
                // Simplified handle: For courses, we average out or enforce one leverage per symbol
                showToast(`已持有不同的槓桿倍數，已為您整合為平均成本`, 'info');
            }
            const newQty = existing.qty + qty;
            const newAvg = (existing.avgPrice * existing.qty + stock.price * qty) / newQty;
            const newMargin = existing.marginUsed + marginRequired;
            const newMarginBase = (existing.marginUsedBase !== undefined ? existing.marginUsedBase : existing.marginUsed) + marginRequiredBase;

            existing.qty = newQty;
            existing.avgPrice = newAvg;
            existing.marginUsed = newMargin;
            existing.marginUsedBase = newMarginBase;
            // Weighted leverage is complex, we just store the latest for UI simplicity or keep max
            existing.leverage = leverage;
        } else {
            state.portfolio[stock.symbol] = {
                name: stock.name,
                qty: qty,
                avgPrice: stock.price,
                currency: stock.currency,
                leverage: leverage,
                marginUsed: marginRequired,
                marginUsedBase: marginRequiredBase
            };
        }

        showToast(`成功開倉 ${qty} 股 ${stock.symbol} (${leverage}x)`, 'success');
    } else {
        const holding = state.portfolio[stock.symbol];

        // Calculate freed margin and realized PnL
        const proportion = qty / holding.qty;
        const freedMarginBase = (holding.marginUsedBase !== undefined ? holding.marginUsedBase : holding.marginUsed) * proportion;
        const pnl = (stock.price - holding.avgPrice) * qty;
        const pnlBase = convertToBase(pnl, stock.currency);

        // Return freed margin + PnL
        state.cash += (freedMarginBase + pnlBase);

        holding.qty -= qty;
        holding.marginUsed -= holding.marginUsed * proportion;
        holding.marginUsedBase = (holding.marginUsedBase !== undefined ? holding.marginUsedBase : holding.marginUsed) - freedMarginBase;

        if (holding.qty <= 0) {
            delete state.portfolio[stock.symbol];
        }

        showToast(`成功平倉 ${qty} 股 ${stock.symbol}`, 'success');
    }

    // Record transaction
    state.transactions.unshift({
        date: new Date().toISOString(),
        type: action,
        symbol: stock.symbol,
        name: stock.name,
        qty: qty,
        price: stock.price,
        total: total,
        leverage: leverage,
        currency: stock.currency
    });

    saveState();
    updateHeaderStats();
    updateOrderPanel();
    refreshDashboardStats();
}

// ============================================
// Dashboard
// ============================================

async function loadMarketOverview() {
    try {
        const res = await fetch('/api/market-overview');
        const data = await res.json();

        const grid = document.getElementById('indices-grid');

        if (data.length === 0) {
            grid.innerHTML = '<div class="index-card"><div class="index-name">無法載入指數</div></div>';
            return;
        }

        const nameMap = {
            '^GSPC': 'S&P 500',
            '^DJI': '道瓊工業',
            '^IXIC': 'NASDAQ',
            '^TWII': '台灣加權',
            '^N225': '日經 225',
            '^SOX': '費城半導體'
        };

        const isFullRender = grid.querySelector('.skeleton-card') || grid.children.length !== data.length;

        if (isFullRender) {
            grid.innerHTML = data.map(idx => {
                const isUp = idx.changePercent >= 0;
                const safeId = idx.symbol.replace(/[^a-zA-Z0-9]/g, '');
                return `
            <div class="index-card" id="idx-${safeId}">
              <div class="index-name">${nameMap[idx.symbol] || idx.name}</div>
              <div class="index-price" id="idx-price-${safeId}">${idx.price?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? '—'}</div>
              <div class="index-change ${isUp ? 'up' : 'down'}" id="idx-change-${safeId}">
                <span class="arrow">${isUp ? '▲' : '▼'}</span>
                <span class="change-val">${formatChange(idx.change)}</span>
                <span class="change-pct">(${formatPercent(idx.changePercent)})</span>
              </div>
            </div>
          `;
            }).join('');
        } else {
            // Soft update
            data.forEach(idx => {
                const safeId = idx.symbol.replace(/[^a-zA-Z0-9]/g, '');
                const isUp = idx.changePercent >= 0;
                updateValWithFlash(`idx-price-${safeId}`, idx.price?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? '—');

                const changeEl = document.getElementById(`idx-change-${safeId}`);
                if (changeEl) {
                    changeEl.className = `index-change ${isUp ? 'up' : 'down'}`;
                    changeEl.querySelector('.arrow').textContent = isUp ? '▲' : '▼';
                    changeEl.querySelector('.change-val').textContent = formatChange(idx.change);
                    changeEl.querySelector('.change-pct').textContent = `(${formatPercent(idx.changePercent)})`;
                }
            });
        }

    } catch (e) {
        console.error('Market overview error:', e);
    }
}

async function loadPopularStocks(market = 'us') {
    state.currentMarket = market;
    const body = document.getElementById('popular-stocks-body');
    body.innerHTML = '<tr><td colspan="7" class="loading-cell">載入中...</td></tr>';

    try {
        const res = await fetch(`/api/popular?market=${market}`);
        const data = await res.json();

        if (data.length === 0) {
            body.innerHTML = '<tr><td colspan="7" class="empty-cell">無法載入股票列表</td></tr>';
            return;
        }

        const isFullRender = body.querySelector('.loading-cell') || body.querySelector('.empty-cell') || body.children.length !== data.length;

        if (isFullRender) {
            body.innerHTML = data.map(stock => {
                const changeClass = getChangeClass(stock.changePercent);
                const safeId = stock.symbol.replace(/[^a-zA-Z0-9]/g, '');
                return `
            <tr id="pop-row-${safeId}">
              <td><span class="stock-symbol" data-symbol="${stock.symbol}">${stock.symbol}</span></td>
              <td><span class="stock-name">${stock.name}</span></td>
              <td class="text-right price-cell" id="pop-price-${safeId}">${stock.price?.toFixed(2) ?? '—'}</td>
              <td class="text-right ${changeClass}" id="pop-change-${safeId}">${formatChange(stock.change)}</td>
              <td class="text-right ${changeClass}" id="pop-pct-${safeId}">${formatPercent(stock.changePercent)}</td>
              <td class="text-right volume-cell" id="pop-vol-${safeId}">${formatNumber(stock.volume)}</td>
              <td class="text-center">
                <button class="trade-btn-sm buy-btn-sm" data-symbol="${stock.symbol}">交易</button>
              </td>
            </tr>
          `;
            }).join('');

            // Event listeners
            body.querySelectorAll('.stock-symbol').forEach(el => {
                el.addEventListener('click', () => selectStock(el.dataset.symbol));
            });
            body.querySelectorAll('.trade-btn-sm').forEach(el => {
                el.addEventListener('click', () => selectStock(el.dataset.symbol));
            });
        } else {
            // Soft update
            data.forEach(stock => {
                const safeId = stock.symbol.replace(/[^a-zA-Z0-9]/g, '');
                const changeClass = getChangeClass(stock.changePercent);
                updateValWithFlash(`pop-price-${safeId}`, stock.price?.toFixed(2) ?? '—');
                updateValWithFlash(`pop-change-${safeId}`, formatChange(stock.change), `text-right ${changeClass}`);
                updateValWithFlash(`pop-pct-${safeId}`, formatPercent(stock.changePercent), `text-right ${changeClass}`);
                updateValWithFlash(`pop-vol-${safeId}`, formatNumber(stock.volume));
            });
        }

    } catch (e) {
        console.error('Popular stocks error:', e);
        body.innerHTML = '<tr><td colspan="7" class="empty-cell">載入失敗</td></tr>';
    }
}

// Market tabs
document.querySelectorAll('.tab-btn[data-market]').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn[data-market]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('popular-stocks-body').innerHTML = '<tr><td colspan="7" class="loading-cell">載入中...</td></tr>';
        loadPopularStocks(btn.dataset.market);
    });
});

// ============================================
// Dashboard Stats
// ============================================

async function refreshDashboardStats() {
    let holdingsValue = 0;
    let unrealizedPnl = 0;

    const symbols = Object.keys(state.portfolio);

    if (symbols.length > 0) {
        try {
            const res = await fetch(`/api/quotes?symbols=${symbols.join(',')}`);
            const quotes = await res.json();

            quotes.forEach(q => {
                const holding = state.portfolio[q.symbol];
                if (holding) {
                    const currentPrice = q.price;
                    const pnlBase = convertToBase((currentPrice - holding.avgPrice) * holding.qty, holding.currency);
                    const marginValue = holding.marginUsed !== undefined ? holding.marginUsed : (holding.avgPrice * holding.qty);
                    const marginBase = holding.marginUsedBase !== undefined ? holding.marginUsedBase : marginValue;

                    holdingsValue += (marginBase + pnlBase); // Net value of this holding (Margin + PnL)
                    unrealizedPnl += pnlBase;
                }
            });
        } catch (e) {
            // Fallback: use avg price
            for (const sym of symbols) {
                const h = state.portfolio[sym];
                // if we fallback, net equity is just the margin used since PNL is 0
                const marginValue = h.marginUsed !== undefined ? h.marginUsed : (h.avgPrice * h.qty);
                const marginBase = h.marginUsedBase !== undefined ? h.marginUsedBase : marginValue;
                holdingsValue += marginBase;
            }
        }
    }

    const totalAssets = state.cash + holdingsValue;
    const totalPnl = totalAssets - INITIAL_CASH;
    const returnPct = ((totalAssets - INITIAL_CASH) / INITIAL_CASH) * 100;

    updateValWithFlash('dash-cash', formatCurrency(state.cash));
    updateValWithFlash('dash-holdings', formatCurrency(holdingsValue)); // Now represents Net Equity of holdings
    updateValWithFlash('dash-pnl', formatCurrency(totalPnl));
    document.getElementById('dash-pnl').style.color = totalPnl >= 0 ? 'var(--green)' : 'var(--red)';
    updateValWithFlash('dash-return', formatPercent(returnPct));
    document.getElementById('dash-return').style.color = returnPct >= 0 ? 'var(--green)' : 'var(--red)';

    updateHeaderStats(totalAssets, totalPnl);
}

function updateHeaderStats(totalAssets, totalPnl) {
    if (totalAssets !== undefined) {
        updateValWithFlash('header-total-assets', formatCurrency(totalAssets));
        updateValWithFlash('header-total-pnl', formatCurrency(totalPnl));
        document.getElementById('header-total-pnl').style.color = totalPnl >= 0 ? 'var(--green)' : 'var(--red)';
    }

    updateValWithFlash('sidebar-balance', formatCurrency(state.cash));
    updateValWithFlash('order-cash', formatCurrency(state.cash));
}

// ============================================
// Portfolio Page
// ============================================

async function refreshPortfolio() {
    const body = document.getElementById('portfolio-body');
    const symbols = Object.keys(state.portfolio);

    if (symbols.length === 0) {
        body.innerHTML = '<tr><td colspan="9" class="empty-cell">尚無持股，快去交易吧！</td></tr>';

        updateValWithFlash('port-total', formatCurrency(state.cash));
        updateValWithFlash('port-market-value', formatCurrency(0));
        updateValWithFlash('port-cash', formatCurrency(state.cash));
        updateValWithFlash('port-unrealized', formatCurrency(0));
        updateValWithFlash('port-realized', formatCurrency(0));
        return;
    }

    if (!body.querySelector(`tr[id^="port-row"]`) || body.children.length !== symbols.length) {
        body.innerHTML = '<tr><td colspan="9" class="loading-cell">更新市值中...</td></tr>';
    }

    try {
        const res = await fetch(`/api/quotes?symbols=${symbols.join(',')}`);
        const quotes = await res.json();

        const quoteMap = {};
        quotes.forEach(q => { quoteMap[q.symbol] = q; });

        let totalMarketValue = 0;
        let totalUnrealized = 0;

        const isFullRender = body.querySelector('.loading-cell') || body.children.length !== symbols.length;

        if (isFullRender) {
            const rows = symbols.map(sym => {
                const holding = state.portfolio[sym];
                const quote = quoteMap[sym];
                const currentPrice = quote?.price ?? holding.avgPrice;
                const marketValue = currentPrice * holding.qty;
                const pnl = (currentPrice - holding.avgPrice) * holding.qty;
                const pnlPct = ((currentPrice - holding.avgPrice) / holding.avgPrice) * 100;

                // Defaults for backward compatibility
                const marginValue = holding.marginUsed !== undefined ? holding.marginUsed : (holding.avgPrice * holding.qty);
                const marginBase = holding.marginUsedBase !== undefined ? holding.marginUsedBase : marginValue;
                const pnlBase = convertToBase(pnl, holding.currency);
                const lev = holding.leverage || 1;

                const netValueBase = marginBase + pnlBase;

                totalMarketValue += netValueBase; // Net equity value
                totalUnrealized += pnlBase;

                const changeClass = getChangeClass(pnlBase);
                const safeId = sym.replace(/[^a-zA-Z0-9]/g, '');

                return `
            <tr id="port-row-${safeId}">
              <td>
                <span class="stock-symbol" data-symbol="${sym}">${sym}</span>
                ${lev > 1 ? `<span style="font-size:0.75rem; background:rgba(255,180,0,0.2); color:var(--yellow); padding: 2px 4px; border-radius: 4px; margin-left: 4px;">${lev}x</span>` : ''}
              </td>
              <td><span class="stock-name">${holding.name}</span></td>
              <td class="text-right price-cell">${holding.qty}</td>
              <td class="text-right price-cell">${holding.avgPrice.toFixed(2)}</td>
              <td class="text-right price-cell" id="port-price-${safeId}">${currentPrice.toFixed(2)}</td>
              <td class="text-right price-cell" id="port-mv-${safeId}">${formatCurrency(marketValue, holding.currency)}</td>
              <td class="text-right ${changeClass}" id="port-pnl-${safeId}">${formatCurrency(pnl, holding.currency)}</td>
              <td class="text-right ${changeClass}" id="port-pct-${safeId}">${formatPercent(pnlPct)}</td>
              <td class="text-center">
                <button class="trade-btn-sm sell-btn-sm" data-symbol="${sym}">賣出</button>
              </td>
            </tr>
          `;
            });
            body.innerHTML = rows.join('');

            // Event listeners
            body.querySelectorAll('.stock-symbol').forEach(el => {
                el.addEventListener('click', () => selectStock(el.dataset.symbol));
            });
            body.querySelectorAll('.sell-btn-sm').forEach(el => {
                el.addEventListener('click', () => {
                    selectStock(el.dataset.symbol);
                    setTimeout(() => {
                        document.querySelector('.order-tab[data-action="sell"]').click();
                    }, 500);
                });
            });
        } else {
            // Soft update
            symbols.forEach(sym => {
                const holding = state.portfolio[sym];
                const quote = quoteMap[sym];
                const currentPrice = quote?.price ?? holding.avgPrice;
                const marketValue = currentPrice * holding.qty;
                const pnl = (currentPrice - holding.avgPrice) * holding.qty;
                const pnlPct = ((currentPrice - holding.avgPrice) / holding.avgPrice) * 100;

                // Defaults for backward compatibility
                const marginValue = holding.marginUsed !== undefined ? holding.marginUsed : (holding.avgPrice * holding.qty);
                const marginBase = holding.marginUsedBase !== undefined ? holding.marginUsedBase : marginValue;
                const pnlBase = convertToBase(pnl, holding.currency);
                const netValueBase = marginBase + pnlBase;

                totalMarketValue += netValueBase; // Net equity value
                totalUnrealized += pnlBase;

                const changeClass = getChangeClass(pnlBase);
                const safeId = sym.replace(/[^a-zA-Z0-9]/g, '');

                updateValWithFlash(`port-price-${safeId}`, currentPrice.toFixed(2));
                // We keep the Gross Market Value in the table so users understand what size they're controlling
                updateValWithFlash(`port-mv-${safeId}`, formatCurrency(marketValue, holding.currency));
                updateValWithFlash(`port-pnl-${safeId}`, formatCurrency(pnl, holding.currency), `text-right ${changeClass}`);
                updateValWithFlash(`port-pct-${safeId}`, formatPercent(pnlPct), `text-right ${changeClass}`);
            });
        }

        const totalAssets = state.cash + totalMarketValue; // Total market value is now Net Equity

        updateValWithFlash('port-total', formatCurrency(totalAssets));
        updateValWithFlash('port-market-value', formatCurrency(totalMarketValue)); // Now represents total Net Equity
        updateValWithFlash('port-cash', formatCurrency(state.cash));
        updateValWithFlash('port-unrealized', formatCurrency(totalUnrealized));
        document.getElementById('port-unrealized').style.color = totalUnrealized >= 0 ? 'var(--green)' : 'var(--red)';
        updateValWithFlash('port-realized', formatCurrency(totalAssets - INITIAL_CASH - totalUnrealized));

    } catch (e) {
        console.error('Portfolio refresh error:', e);
        if (!body.querySelector(`tr[id^="port-row"]`)) {
            body.innerHTML = '<tr><td colspan="9" class="empty-cell">更新失敗</td></tr>';
        }
    }
}

// ============================================
// History Page
// ============================================

function refreshHistory() {
    const body = document.getElementById('history-body');

    if (state.transactions.length === 0) {
        body.innerHTML = '<tr><td colspan="7" class="empty-cell">尚無交易紀錄</td></tr>';
        document.getElementById('history-count').textContent = '共 0 筆交易';
        return;
    }

    document.getElementById('history-count').textContent = `共 ${state.transactions.length} 筆交易`;

    body.innerHTML = state.transactions.map(t => `
    <tr>
      <td>${formatDate(t.date)}</td>
      <td><span class="type-badge ${t.type === 'buy' ? 'type-buy' : 'type-sell'}">${t.type === 'buy' ? '買入' : '賣出'}</span></td>
      <td><span class="stock-symbol" data-symbol="${t.symbol}">${t.symbol}</span></td>
      <td><span class="stock-name">${t.name}</span></td>
      <td class="text-right price-cell">${t.qty}</td>
      <td class="text-right price-cell">${t.price.toFixed(2)}</td>
      <td class="text-right price-cell">${formatCurrency(t.total, t.currency)}</td>
    </tr>
  `).join('');

    body.querySelectorAll('.stock-symbol').forEach(el => {
        el.addEventListener('click', () => selectStock(el.dataset.symbol));
    });
}

// ============================================
// Leaderboard
// ============================================

function refreshLeaderboard() {
    const records = document.getElementById('past-records');

    if (state.leaderboard.length === 0) {
        document.getElementById('lb-name-1').textContent = '尚無紀錄';
        document.getElementById('lb-return-1').textContent = '—';
        records.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px">完成一輪遊戲後會出現在這裡</p>';
        return;
    }

    // Best record
    const best = [...state.leaderboard].sort((a, b) => b.returnPct - a.returnPct)[0];
    document.getElementById('lb-name-1').textContent = `最佳成績`;
    document.getElementById('lb-return-1').textContent = formatPercent(best.returnPct);
    document.getElementById('lb-return-1').style.color = best.returnPct >= 0 ? 'var(--green)' : 'var(--red)';

    records.innerHTML = state.leaderboard.map((r, i) => {
        const returnClass = r.returnPct >= 0 ? 'change-up' : 'change-down';
        return `
      <div class="record-item">
        <span class="record-rank">#${i + 1}</span>
        <span class="record-date">${new Date(r.date).toLocaleDateString('zh-TW')}</span>
        <span class="record-return ${returnClass}">${formatPercent(r.returnPct)}</span>
      </div>
    `;
    }).join('');
}

// ============================================
// Reset Game
// ============================================

document.getElementById('reset-game').addEventListener('click', async () => {
    if (!confirm('確定要重新開始嗎？\n本次遊戲的績效將被記錄到排行榜。')) return;

    // Calculate current performance
    let holdingsValue = 0;
    const symbols = Object.keys(state.portfolio);

    if (symbols.length > 0) {
        try {
            const res = await fetch(`/api/quotes?symbols=${symbols.join(',')}`);
            const quotes = await res.json();
            quotes.forEach(q => {
                const holding = state.portfolio[q.symbol];
                if (holding) {
                    const marginValue = holding.marginUsed !== undefined ? holding.marginUsed : (holding.avgPrice * holding.qty);
                    const marginBase = holding.marginUsedBase !== undefined ? holding.marginUsedBase : marginValue;
                    const pnlBase = convertToBase((q.price - holding.avgPrice) * holding.qty, holding.currency);
                    holdingsValue += (marginBase + pnlBase);
                }
            });
        } catch (e) {
            for (const sym of symbols) {
                const h = state.portfolio[sym];
                const marginValue = h.marginUsed !== undefined ? h.marginUsed : (h.avgPrice * h.qty);
                const marginBase = h.marginUsedBase !== undefined ? h.marginUsedBase : marginValue;
                holdingsValue += marginBase;
            }
        }
    }

    const totalAssets = state.cash + holdingsValue;
    const returnPct = ((totalAssets - INITIAL_CASH) / INITIAL_CASH) * 100;

    // Record to leaderboard
    if (state.transactions.length > 0) {
        state.leaderboard.push({
            date: new Date().toISOString(),
            returnPct: returnPct,
            totalAssets: totalAssets
        });
    }

    // Reset
    state.cash = INITIAL_CASH;
    state.portfolio = {};
    state.transactions = [];
    state.currentStock = null;

    saveState();

    // Reset UI
    navigateTo('dashboard');
    refreshDashboardStats();
    updateHeaderStats(INITIAL_CASH, 0);

    showToast('遊戲已重新開始！初始資金 NT$1,000,000', 'success');
});

// ============================================
// Navigation Event Listeners
// ============================================

document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
});

// Menu toggle (mobile)
document.getElementById('menu-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
});

// ============================================
// Initialization
// ============================================

async function init() {
    loadState();

    // Fetch real exchange rate
    try {
        const res = await fetch('/api/exchange-rate');
        const data = await res.json();
        state.exchangeRate = data.rate || 32.0;
    } catch (e) {
        state.exchangeRate = 32.0;
    }

    // Update displayed values from saved state
    updateHeaderStats(state.cash, 0);

    // Show app after loading animation
    setTimeout(() => {
        document.getElementById('loading-screen').classList.add('fade-out');
        document.getElementById('app').classList.remove('hidden');

        // Load market data
        loadMarketOverview();
        loadPopularStocks('us');
        refreshDashboardStats();

        // Setup Auto Refresh (15 seconds for more proactive class testing)
        setupAutoRefresh();
    }, 2000);
}

function setupAutoRefresh() {
    setInterval(async () => {
        const activePage = document.querySelector('.page.active')?.id;

        if (activePage === 'page-dashboard') {
            loadMarketOverview();
            loadPopularStocks(state.currentMarket);
            refreshDashboardStats();
        } else if (activePage === 'page-portfolio') {
            refreshPortfolio();
        } else if (activePage === 'page-trade' && state.currentStock) {
            try {
                const res = await fetch(`/api/quote/${encodeURIComponent(state.currentStock.symbol)}`);
                const data = await res.json();
                if (!data.error) {
                    state.currentStock = data;
                    updateOrderPanel();
                }
                loadChart(state.currentStock.symbol, state.chartRange);
            } catch (e) {
                console.error('Auto refresh error:', e);
            }
        }
    }, 15000); // 15 seconds
}

init();
