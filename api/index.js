const express = require('express');
const cors = require('cors');
const path = require('path');
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

// --- Setup Yahoo Finance for Serverless ---
// Disable disk-based caching which fails on Vercel's read-only file system
yahooFinance.setGlobalConfig({
    queue: { concurrency: 4 },
    // Validation is optional but can sometimes cause issues in older Node environments
    validation: { logErrors: false }
});

const app = express();

app.use(cors());
app.use(express.json());

// API Routes
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

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
        console.error('Search error:', error);
        res.json([]);
    }
});

// Get quote
app.get('/api/quote/:symbol', async (req, res) => {
    try {
        const { symbol } = req.params;
        const quote = await yahooFinance.quote(symbol);
        let profile = {};
        try {
            const modules = await yahooFinance.quoteSummary(symbol, { modules: ['summaryProfile'] });
            if (modules && modules.summaryProfile) profile = modules.summaryProfile;
        } catch (e) { }
        res.json({
            symbol: quote.symbol,
            name: quote.shortName || quote.longName || quote.symbol,
            price: quote.regularMarketPrice,
            change: quote.regularMarketChange,
            changePercent: quote.regularMarketChangePercent,
            currency: quote.currency,
            exchange: quote.fullExchangeName || quote.exchange,
            sector: profile.sector || 'N/A',
            industry: profile.industry || 'N/A',
            summary: profile.longBusinessSummary || '',
            website: profile.website || ''
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
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
                    const q = await yahooFinance.quote(symbol.trim());
                    return {
                        symbol: q.symbol,
                        price: q.regularMarketPrice,
                        currency: q.currency
                    };
                } catch (e) { return null; }
            })
        );
        res.json(quotes.filter(Boolean));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get exchange rate
app.get('/api/exchange-rate', async (req, res) => {
    try {
        const quote = await yahooFinance.quote('TWD=X');
        res.json({ rate: quote.regularMarketPrice });
    } catch (error) {
        res.json({ rate: 32.0 });
    }
});

// Get market overview
app.get('/api/market-overview', async (req, res) => {
    try {
        const indices = ['^GSPC', '^DJI', '^IXIC', '^TWII', '^N225', '^SOX'];
        const quotes = await Promise.all(indices.map(async (s) => {
            try {
                const q = await yahooFinance.quote(s);
                return {
                    symbol: q.symbol,
                    name: q.shortName || q.longName,
                    price: q.regularMarketPrice,
                    change: q.regularMarketChange,
                    changePercent: q.regularMarketChangePercent
                };
            } catch (e) { return null; }
        }));
        res.json(quotes.filter(Boolean));
    } catch (error) {
        res.json([]);
    }
});

// Popular stocks
app.get('/api/popular', async (req, res) => {
    // ... existing popular logic ...
    try {
        const { market = 'us' } = req.query;
        let popular = market === 'tw' ? ['2330.TW', '2317.TW', '2454.TW'] : ['AAPL', 'MSFT', 'NVDA', 'TSLA'];
        const quotes = await Promise.all(popular.map(async (s) => {
            try {
                const q = await yahooFinance.quote(s);
                return {
                    symbol: q.symbol,
                    name: q.shortName || q.longName,
                    price: q.regularMarketPrice,
                    change: q.regularMarketChange,
                    changePercent: q.regularMarketChangePercent,
                    currency: q.currency
                };
            } catch (e) { return null; }
        }));
        res.json(quotes.filter(Boolean));
    } catch (error) {
        res.json([]);
    }
});

module.exports = app;
