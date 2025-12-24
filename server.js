const express = require('express');
const axios = require('axios');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { RateLimiterMemory } = require('rate-limiter-flexible');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Rate limiting
const rateLimiter = new RateLimiterMemory({
  points: 100, duration: 60 * 60 // 100 requests/hour/IP
});
const middleware = (req, res, next) => {
  rateLimiter.consume(req.ip)
    .then(() => next())
    .catch(() => res.status(429).json({ error: 'Too many requests' }));
};

// Proxy sources
const PROXY_SOURCES = [
  'https://api.proxyscrape.com/v2/?request=get&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all',
  'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
  'https://api.openproxylist.xyz/http.txt',
  'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt'
];

// Test endpoints
async function testProxy(proxy) {
  const tests = [];
  
  // Speed test
  try {
    const start = Date.now();
    const response = await axios.get('http://httpbin.org/ip', {
      proxy: { host: proxy.split(':')[0], port: parseInt(proxy.split(':')[1]), protocol: 'http' },
      timeout: 5000,
      headers: { 'User-Agent': 'ProxyPlayground/1.0' }
    });
    tests.push({
      name: 'Speed Test',
      passed: true,
      ip: response.data.origin,
      latency: Date.now() - start,
      details: response.data
    });
  } catch {}

  // Netflix geo test
  try {
    const response = await axios.get('https://httpbin.org/ip', {
      proxy: { host: proxy.split(':')[0], port: parseInt(proxy.split(':')[1]), protocol: 'http' },
      timeout: 5000
    });
    tests.push({ name: 'Geo Test', passed: true, ip: response.data.origin });
  } catch {}

  return {
    proxy,
    working: tests.length > 0,
    tests,
    latency: tests[0]?.latency || null,
    score: tests.filter(t => t.passed).length / tests.length * 100
  };
}

// Routes
app.get('/api/proxies', middleware, async (req, res) => {
  try {
    const proxies = [];
    for (const source of PROXY_SOURCES) {
      try {
        const response = await axios.get(source, { timeout: 10000 });
        const lines = response.data.split('\n')
          .filter(line => line.includes(':') && line.trim())
          .slice(0, 25);
        proxies.push(...lines);
      } catch {}
    }
    
    // Test first 20 for live status
    const liveProxies = [];
    for (const proxy of proxies.slice(0, 20)) {
      try {
        const result = await testProxy(proxy);
        if (result.working) liveProxies.push(result);
        if (liveProxies.length >= 10) break;
      } catch {}
    }
    
    res.json({
      proxies: liveProxies.slice(0, 50),
      total: proxies.length,
      timestamp: new Date().toISOString()
    });
  } catch {
    res.json({ proxies: [], error: 'Failed to fetch proxies' });
  }
});

app.post('/api/test-proxy', middleware, async (req, res) => {
  const { proxy } = req.body;
  if (!proxy || !proxy.includes(':')) {
    return res.status(400).json({ error: 'Invalid proxy format' });
  }
  
  try {
    const result = await testProxy(proxy);
    res.json(result);
  } catch {
    res.json({ proxy, working: false, error: 'Test failed' });
  }
});

app.listen(PORT, () => {
  console.log(`Proxy Playground Backend running on port ${PORT}`);
});
