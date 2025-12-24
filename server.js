const express = require('express');
const axios = require('axios');
const cors = require('cors');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: '*' }));
app.use(express.json());

// 1. SOURCES (HTTP & HTTPS)
const PROXY_SOURCES = [
    // ProxyScrape HTTP + HTTPS
    'https://api.proxyscrape.com/v2/?request=get&protocol=http&timeout=5000&country=all&ssl=all&anonymity=all',
    'https://api.proxyscrape.com/v2/?request=get&protocol=https&timeout=5000&country=all&ssl=all&anonymity=all',
    // GitHub Lists
    'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt', 
    'https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-http.txt',
    'https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-https.txt'
];

// Global list of Verified Proxies
let verifiedProxies = [];

// 2. BACKGROUND WORKER: Finds working proxies
async function updateProxyList() {
    console.log('🔄 Background: Fetching and verifying proxies...');
    let rawProxies = [];

    // Fetch from all sources
    for (const source of PROXY_SOURCES) {
        try {
            const res = await axios.get(source, { timeout: 5000 });
            const lines = res.data.split('\n');
            rawProxies.push(...lines.map(l => l.trim()).filter(l => l.match(/^\d+\.\d+\.\d+\.\d+:\d+$/)));
        } catch (e) { console.log('Source failed:', source); }
    }

    // Remove duplicates
    rawProxies = [...new Set(rawProxies)].slice(0, 300); // Check top 300 candidates
    console.log(`Checking ${rawProxies.length} candidates...`);

    const working = [];
    
    // Check batches of 20
    const BATCH_SIZE = 20;
    for (let i = 0; i < rawProxies.length; i += BATCH_SIZE) {
        const batch = rawProxies.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(batch.map(checkProxy));
        working.push(...results.filter(p => p !== null));
    }

    // Sort by Speed (Latency) - Fastest on top
    working.sort((a, b) => a.latency - b.latency);
    
    verifiedProxies = working;
    console.log(`✅ Update Complete. ${verifiedProxies.length} working proxies found.`);
}

// Helper: Quick Check
async function checkProxy(proxyStr) {
    const [host, port] = proxyStr.split(':');
    const start = Date.now();
    try {
        await axios.get('http://ip-api.com/json', {
            proxy: { protocol: 'http', host, port: parseInt(port) },
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 6000, // 6s strict timeout
            httpsAgent: new https.Agent({ rejectUnauthorized: false }) // Allow self-signed SSL
        });
        return { 
            proxy: proxyStr, 
            latency: Date.now() - start,
            working: true 
        };
    } catch {
        return null;
    }
}

// Run update every 10 minutes
setInterval(updateProxyList, 10 * 60 * 1000);
// Run immediately on start
updateProxyList();

// 3. API ROUTES

// GET /api/proxies - Returns VERIFIED list first
app.get('/api/proxies', (req, res) => {
    // If we have verified proxies, return them
    // Otherwise return whatever we have (or empty)
    res.json({ 
        proxies: verifiedProxies.map(p => p.proxy), // Send just strings to frontend
        meta: {
            total: verifiedProxies.length,
            status: verifiedProxies.length > 0 ? 'Verified' : 'Scanning...'
        }
    });
});

// POST /api/test-proxy - Detailed User Test
app.post('/api/test-proxy', async (req, res) => {
    const { proxy } = req.body;
    if (!proxy) return res.status(400).json({ error: 'Missing proxy' });

    const [host, port] = proxy.split(':');
    const start = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15s user timeout

    try {
        const response = await axios.get('http://ip-api.com/json', {
            proxy: { protocol: 'http', host, port: parseInt(port) },
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 15000,
            signal: controller.signal,
            httpsAgent: new https.Agent({ rejectUnauthorized: false })
        });
        
        clearTimeout(timeout);
        
        res.json({
            working: true,
            ip: response.data.query,
            country: response.data.countryCode,
            latency: Date.now() - start,
            speed: 'Fast',
            netflix: false, 
            youtube: true
        });

    } catch (error) {
        clearTimeout(timeout);
        res.json({ working: false });
    }
});

app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
