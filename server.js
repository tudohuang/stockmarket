const app = require('./api/index');
const PORT = process.env.PORT || 3000;

// This file is used for local development
// On Vercel, it uses api/index.js directly as a Serverless Function

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`\n🚀 Stock Market Simulator running at http://localhost:${PORT}\n`);
    });
}
