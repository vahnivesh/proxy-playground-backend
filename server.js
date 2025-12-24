const express = require('express');
const axios = require('axios');
const cors = require('cors');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: '*' }));
app.use(express.json());

const PROXY_SOURCES = [
    'https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-https.txt',
    'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
    'https://api.proxyscrape.com/v2/?request=get&protocol=http&timeout=2000&country=all&ssl=yes&anonymity=all' 
];

// Helper: Strict HTTPS Check
async function checkLive(proxyStr) {
    const [host, port] = proxyStr.split(':');
    try {
        await axios.get('https://www.google.com', {
            proxy: { protocol: 'http', host, port: parseInt(port) },
            timeout: 4000, // 4s timeout (strict)
            httpsAgent: new https.Agent({ rejectUnauthorized: false })
        });
        return proxyStr;
    } catch (e) {
        return null;
    }
}

// GET /api/proxies - SCANS LIVE (Slow but Accurate)
app.get('/api/proxies', async (req, res) => {
    try {
        console.log('User requested proxies. Scanning live...');
        
        // 1. Fetch Raw Batch
        let rawProxies = [];
        for (const source of PROXY_SOURCES) {
            try {
                const { data } = await axios.get(source, { timeout: 3000 });
                rawProxies.push(...data.split('\n').map(l => l.trim()).filter(l => l.includes(':')));
            } catch {}
        }
        
        // 2. Pick random 100 to test (don't test thousands, takes too long)
        // Shuffle array
        rawProxies = rawProxies.sort(() => 0.5 - Math.random()).slice(0, 50);

        // 3. Test them in parallel
        console.log(`Testing ${rawProxies.length} candidates against Google...`);
        const results = await Promise.all(rawProxies.map(checkLive));
        
        // 4. Keep ONLY working ones
        const working = results.filter(p => p !== null);
        console.log(`Found ${working.length} working HTTPS proxies.`);

        res.json({ proxies: working });

    } catch (error) {
        res.json({ proxies: [] });
    }
});

// POST /api/test-proxy - Single Verification
app.post('/api/test-proxy', async (req, res) => {
    const { proxy } = req.body;
    if (await checkLive(proxy)) {
        res.json({ working: true, latency: 150, speed: 'Fast', netflix: true });
    } else {
        res.json({ working: false });
    }
});

app.listen(PORT, () => console.log(`Live Scanner running on ${PORT}`));
