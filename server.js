/**
 * Antigravity 2.0 Context Budget Dashboard Server
 * File: server.js
 * 
 * Native Node.js HTTP server.
 * Binds strictly to 127.0.0.1:3456 for local security.
 * Zero external npm dependencies.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { getDetailedMetrics } = require('./src/analyzer');

/**
 * Exécute `rtk gain` et parse la sortie texte en objet JSON structuré.
 * @returns {Promise<Object>}
 */
function getRtkGain() {
  return new Promise((resolve, reject) => {
    execFile('/opt/homebrew/bin/rtk', ['gain'], {
      timeout: 10_000,
      shell: false,
      env: { ...process.env, PATH: (process.env.PATH || '') + ':/opt/homebrew/bin:/usr/local/bin' },
    }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(stderr || err.message));
      }
      const text = stdout;

      // Parser les métriques globales
      const totalCommands = Number((text.match(/Total commands:\s+(\d+)/) || [])[1] ?? 0);
      const inputTokens   = Number((text.match(/Input tokens:\s+([\d,]+)/)  || [])[1]?.replace(/,/g, '') ?? 0);
      const outputTokens  = Number((text.match(/Output tokens:\s+([\d,]+)/) || [])[1]?.replace(/,/g, '') ?? 0);
      const savedMatch    = text.match(/Tokens saved:\s+([\d,]+)\s+\(([\d.]+)%\)/);
      const tokensSaved   = Number((savedMatch?.[1] ?? '0').replace(/,/g, ''));
      const savingsPct    = parseFloat(savedMatch?.[2] ?? '0');
      const execTimeMatch = text.match(/Total exec time:\s+(\d+)ms\s+\(avg\s+(\d+)ms\)/);
      const totalExecMs   = Number(execTimeMatch?.[1] ?? 0);
      const avgExecMs     = Number(execTimeMatch?.[2] ?? 0);

      // Parser le tableau "By Command"
      const commands = [];
      const tableLines = text.split('\n').filter(l => /^\s+\d+\./.test(l));
      for (const line of tableLines) {
        // Format:  1.  rtk ls /path      1    110   80.9%     9ms  ██████████
        const m = line.match(/^\s+(\d+)\.\s+(.+?)\s{2,}(\d+)\s+([\d,]+)\s+([\d.]+)%\s+(\d+)ms/);
        if (m) {
          commands.push({
            rank:    Number(m[1]),
            command: m[2].trim(),
            count:   Number(m[3]),
            saved:   Number(m[4].replace(/,/g, '')),
            avgPct:  parseFloat(m[5]),
            timeMs:  Number(m[6]),
          });
        }
      }

      resolve({ totalCommands, inputTokens, outputTokens, tokensSaved, savingsPct, totalExecMs, avgExecMs, commands, raw: text });
    });
  });
}

const PORT = parseInt(process.env.PORT || '3456', 10);
const HOST = '127.0.0.1'; // Sécurité stricte : localhost uniquement

const PUBLIC_DIR = path.join(__dirname, 'public');

// Headers de sécurité Shift-Left
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || HOST}`);
  const pathname = url.pathname;

  // Appliquer les headers de sécurité sur chaque requête
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(key, value);
  }

  // Route 1 : API Métriques
  if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/api/metrics') {
    try {
      const data = getDetailedMetrics();
      if (!data) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(req.method === 'HEAD' ? null : JSON.stringify({ error: 'Aucune session Antigravity active disponible' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(req.method === 'HEAD' ? null : JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(req.method === 'HEAD' ? null : JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Route 1b : RTK Gain – économies de tokens RTK
  if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/api/rtk-gain') {
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(null);
      return;
    }
    getRtkGain()
      .then(data => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(data));
      })
      .catch(err => {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
      });
    return;
  }


  // Route 2 : Healthcheck
  if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(req.method === 'HEAD' ? null : JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    return;
  }

  // Route 3 : Page HTML Dashboard
  if ((req.method === 'GET' || req.method === 'HEAD') && (pathname === '/' || pathname === '/index.html')) {
    const filePath = path.join(PUBLIC_DIR, 'index.html');
    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Dashboard HTML non trouvé');
      return;
    }
    const html = fs.readFileSync(filePath, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(req.method === 'HEAD' ? null : html);
    return;
  }

  // Route 4 : Favicon (SVG & fallback ICO)
  if ((req.method === 'GET' || req.method === 'HEAD') && (pathname === '/favicon.svg' || pathname === '/favicon.ico')) {
    const faviconPath = path.join(PUBLIC_DIR, 'favicon.svg');
    if (!fs.existsSync(faviconPath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Favicon non trouvé');
      return;
    }
    const svg = fs.readFileSync(faviconPath);
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' });
    res.end(req.method === 'HEAD' ? null : svg);
    return;
  }

  // 404 par défaut
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, HOST, () => {
  console.log(`🚀 Dashboard Antigravity Context démarré sur http://${HOST}:${PORT}`);
});

process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());
