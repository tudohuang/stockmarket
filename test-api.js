const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance();

async function test() {
    try {
        console.log("Testing search...");
        const results = await yahooFinance.search('AAPL');
        console.log("Search success:", results.quotes.length);

        console.log("Testing quote...");
        const quote = await yahooFinance.quote('AAPL');
        console.log("Quote price:", quote.regularMarketPrice);
    } catch (e) {
        console.error("Error:", e);
    }
}
test();
