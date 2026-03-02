const express = require('express');
const cors = require('cors');
const path = require('path');
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Suppress yahoo-finance2 logs (handled in constructor)

// --- API Routes ---

// Search stocks
app.get('/api/search', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) return res.json([]);

        const results = await yahooFinance.search(q, { newsCount: 0 });
        const quotes = (results.quotes || [])
            .filter(q => q.quoteType === 'EQUITY')
            .map(q => ({
                symbol: q.symbol,
                name: q.shortname || q.longname || q.symbol,
                exchange: q.exchange,
                type: q.quoteType
            }));

        res.json(quotes);
    } catch (error) {
        console.error('Search error:', error.message);
        res.json([]);
    }
});

// Get quote (real-time price)
app.get('/api/quote/:symbol', async (req, res) => {
    try {
        const { symbol } = req.params;
        const quote = await yahooFinance.quote(symbol);

        let profile = {};
        try {
            // Some symbols (like crypto or futures) might not have a summaryProfile
            const modules = await yahooFinance.quoteSummary(symbol, { modules: ['summaryProfile'] });
            if (modules && modules.summaryProfile) {
                profile = modules.summaryProfile;
            }
        } catch (e) {
            console.log(`No summary profile for ${symbol}`);
        }

        res.json({
            symbol: quote.symbol,
            name: quote.shortName || quote.longName || quote.symbol,
            price: quote.regularMarketPrice,
            change: quote.regularMarketChange,
            changePercent: quote.regularMarketChangePercent,
            previousClose: quote.regularMarketPreviousClose,
            open: quote.regularMarketOpen,
            dayHigh: quote.regularMarketDayHigh,
            dayLow: quote.regularMarketDayLow,
            volume: quote.regularMarketVolume,
            marketCap: quote.marketCap,
            fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh,
            fiftyTwoWeekLow: quote.fiftyTwoWeekLow,
            currency: quote.currency,
            exchange: quote.fullExchangeName || quote.exchange,
            marketState: quote.marketState,
            sector: profile.sector || 'N/A',
            industry: profile.industry || 'N/A',
            summary: profile.longBusinessSummary || '',
            website: profile.website || ''
        });
    } catch (error) {
        console.error('Quote error:', error.message);
        res.status(500).json({ error: 'Failed to fetch quote' });
    }
});

// Get multiple quotes
app.get('/api/quotes', async (req, res) => {
    try {
        const symbols = req.query.symbols ? req.query.symbols.split(',') : [];
        if (symbols.length === 0) return res.json([]);

        const quotes = await Promise.all(
            symbols.map(async (symbol) => {
                try {
                    const quote = await yahooFinance.quote(symbol.trim());
                    return {
                        symbol: quote.symbol,
                        name: quote.shortName || quote.longName || quote.symbol,
                        price: quote.regularMarketPrice,
                        change: quote.regularMarketChange,
                        changePercent: quote.regularMarketChangePercent,
                        previousClose: quote.regularMarketPreviousClose,
                        volume: quote.regularMarketVolume,
                        currency: quote.currency,
                        exchange: quote.fullExchangeName || quote.exchange,
                        marketState: quote.marketState
                    };
                } catch (e) {
                    return null;
                }
            })
        );

        res.json(quotes.filter(Boolean));
    } catch (error) {
        console.error('Quotes error:', error.message);
        res.status(500).json({ error: 'Failed to fetch quotes' });
    }
});

// Get historical data for charts
app.get('/api/history/:symbol', async (req, res) => {
    try {
        const { symbol } = req.params;
        const { range = '1mo' } = req.query;

        // Map range to period and interval
        const rangeMap = {
            '1d': { period1: daysAgo(1), interval: '5m' },
            '5d': { period1: daysAgo(5), interval: '15m' },
            '1mo': { period1: daysAgo(30), interval: '1d' },
            '3mo': { period1: daysAgo(90), interval: '1d' },
            '6mo': { period1: daysAgo(180), interval: '1d' },
            '1y': { period1: daysAgo(365), interval: '1wk' },
            '5y': { period1: daysAgo(1825), interval: '1mo' }
        };

        const config = rangeMap[range] || rangeMap['1mo'];

        const result = await yahooFinance.chart(symbol, {
            period1: config.period1,
            interval: config.interval
        });

        const data = (result.quotes || []).map(q => ({
            date: q.date,
            open: q.open,
            high: q.high,
            low: q.low,
            close: q.close,
            volume: q.volume
        })).filter(q => q.close !== null);

        res.json(data);
    } catch (error) {
        console.error('History error:', error.message);
        res.status(500).json({ error: 'Failed to fetch history' });
    }
});

// Get USD to TWD Exchange Rate
app.get('/api/exchange-rate', async (req, res) => {
    try {
        const quote = await yahooFinance.quote('TWD=X');
        res.json({ rate: quote.regularMarketPrice });
    } catch (error) {
        console.error('Exchange rate error:', error.message);
        res.json({ rate: 32.0 }); // Fallback
    }
});

// Get market overview (major indices)
app.get('/api/market-overview', async (req, res) => {
    try {
        const indices = [
            '^GSPC',    // S&P 500
            '^DJI',     // Dow Jones
            '^IXIC',    // NASDAQ
            '^TWII',    // Taiwan Weighted Index
            '^N225',    // Nikkei 225
            '^SOX',     // Philadelphia Semiconductor
        ];

        const quotes = await Promise.all(
            indices.map(async (symbol) => {
                try {
                    const quote = await yahooFinance.quote(symbol);
                    return {
                        symbol: quote.symbol,
                        name: quote.shortName || quote.longName || symbol,
                        price: quote.regularMarketPrice,
                        change: quote.regularMarketChange,
                        changePercent: quote.regularMarketChangePercent,
                        marketState: quote.marketState
                    };
                } catch (e) {
                    return null;
                }
            })
        );

        res.json(quotes.filter(Boolean));
    } catch (error) {
        console.error('Market overview error:', error.message);
        res.json([]);
    }
});

// Get trending / popular stocks
app.get('/api/popular', async (req, res) => {
    try {
        const { market = 'us' } = req.query;

        let popularStocks = [];
        if (market === 'tw') {
            popularStocks = ['2330.TW', '2317.TW', '2454.TW', '2382.TW', '2881.TW', '2891.TW', '2303.TW', '3711.TW', '2412.TW', '1301.TW'];
        } else if (market === 'jp') {
            // Toyota, Sony, Nintendo, SoftBank, MUFG, Keyence, Tokyo Electron, Fast Retailing, Honda, Hitachi
            popularStocks = ['7203.T', '6758.T', '7974.T', '9984.T', '8306.T', '6861.T', '8035.T', '9983.T', '7267.T', '6501.T'];
        } else if (market === 'crypto') {
            popularStocks = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'BNB-USD', 'XRP-USD', 'DOGE-USD', 'ADA-USD'];
        } else if (market === 'etf') {
            popularStocks = ['SPY', 'QQQ', 'VOO', 'VTI', 'ARKK', 'TQQQ', '0050.TW', '0056.TW'];
        } else if (market === 'futures') {
            popularStocks = ['GC=F', 'SI=F', 'CL=F', 'NG=F', 'ES=F', 'NQ=F', 'ZC=F'];
        } else {
            popularStocks = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA', 'TSM', 'AVGO', 'AMD'];
        }

        const quotes = await Promise.all(
            popularStocks.map(async (symbol) => {
                try {
                    const quote = await yahooFinance.quote(symbol);
                    return {
                        symbol: quote.symbol,
                        name: quote.shortName || quote.longName || symbol,
                        price: quote.regularMarketPrice,
                        change: quote.regularMarketChange,
                        changePercent: quote.regularMarketChangePercent,
                        volume: quote.regularMarketVolume,
                        currency: quote.currency,
                        exchange: quote.fullExchangeName || quote.exchange
                    };
                } catch (e) {
                    return null;
                }
            })
        );

        res.json(quotes.filter(Boolean));
    } catch (error) {
        console.error('Popular error:', error.message);
        res.json([]);
    }
});

function daysAgo(days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d;
}

// Catch-all: serve index.html for SPA routing
app.get('/{*path}', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`\n🚀 Stock Market Simulator running at http://localhost:${PORT}\n`);
});
