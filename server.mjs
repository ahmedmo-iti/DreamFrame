import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');
const port = Number(process.env.PORT || 3000);
const host = process.env.DREAMFRAME_HOST || '127.0.0.1';

function readEnvFile(filename) {
  const values = {};
  if (!fs.existsSync(filename)) return values;
  for (const rawLine of fs.readFileSync(filename, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const index = line.indexOf('=');
    values[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return values;
}

const env = { ...readEnvFile(path.join(root, '.env.local')), ...process.env };
const localComfyUrl = new URL(env.COMFY_URL || 'http://127.0.0.1:8188');
const workersFile = path.resolve(root, env.DREAMFRAME_WORKERS_FILE || 'dreamframe-workers.json');

function safeWorkerId(value, fallback) {
  const normalized = String(value || fallback || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-');
  return normalized || `worker-${Date.now()}`;
}

function loadWorkers() {
  const configured = [];
  if (fs.existsSync(workersFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(workersFile, 'utf8'));
      const list = Array.isArray(parsed) ? parsed : parsed?.workers;
      if (Array.isArray(list)) configured.push(...list);
    } catch (error) {
      console.warn(`Could not read ${workersFile}: ${error.message}`);
    }
  }

  const rawWorkers = configured.length > 0
    ? configured
    : [{ id: 'local', name: 'Main PC', url: localComfyUrl.origin, enabled: true }];

  const seen = new Set();
  const workers = [];
  for (let index = 0; index < rawWorkers.length; index += 1) {
    const raw = rawWorkers[index];
    if (raw?.enabled === false) continue;
    try {
      const url = new URL(raw?.url || (index === 0 ? localComfyUrl.origin : ''));
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      let id = safeWorkerId(raw?.id, `pc-${index + 1}`);
      while (seen.has(id)) id = `${id}-${index + 1}`;
      seen.add(id);
      workers.push({
        id,
        name: String(raw?.name || `Render PC ${index + 1}`),
        url,
        enabled: true,
        isLocal: url.origin === localComfyUrl.origin,
      });
    } catch {
      // Ignore malformed worker entries instead of crashing the checkpoint build.
    }
  }

  if (workers.length === 0) {
    workers.push({ id: 'local', name: 'Main PC', url: localComfyUrl, enabled: true, isLocal: true });
  }
  return workers;
}

const workers = loadWorkers();
const localProxyWorker = { id: 'local-comfy', name: 'Local ComfyUI', url: localComfyUrl, enabled: true, isLocal: true };
const workerMap = new Map(workers.map((worker) => [worker.id, worker]));

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function resolveProxyTarget(requestUrl = '') {
  if (requestUrl.startsWith('/comfy')) {
    return { worker: localProxyWorker, prefix: '/comfy' };
  }
  const match = requestUrl.match(/^\/worker\/([^/]+)\/comfy(?:\/|\?|$)/);
  if (!match) return null;
  const worker = workerMap.get(decodeURIComponent(match[1]));
  return worker ? { worker, prefix: `/worker/${match[1]}/comfy` } : null;
}

function proxyToWorker(request, response, resolved) {
  const { worker, prefix } = resolved;
  const targetPath = request.url.replace(prefix, '') || '/';
  const requestModule = worker.url.protocol === 'https:' ? https : http;
  const proxy = requestModule.request({
    protocol: worker.url.protocol,
    hostname: worker.url.hostname,
    port: worker.url.port || (worker.url.protocol === 'https:' ? 443 : 80),
    method: request.method,
    path: targetPath,
    headers: { ...request.headers, host: request.headers.host || `${host}:${port}` },
  }, (upstream) => {
    response.writeHead(upstream.statusCode || 502, upstream.headers);
    upstream.pipe(response);
  });
  proxy.on('error', (error) => {
    if (!response.headersSent) response.writeHead(502, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      error: `Could not reach ${worker.name}`,
      workerId: worker.id,
      target: worker.url.origin,
      detail: error.message,
    }));
  });
  request.pipe(proxy);
}

function serveWorkerList(response) {
  response.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify({
    workers: workers.map((worker) => ({
      id: worker.id,
      name: worker.name,
      apiBase: `/worker/${encodeURIComponent(worker.id)}/comfy`,
      isLocal: worker.isLocal,
    })),
    configFile: path.basename(workersFile),
  }));
}

function serveStatic(request, response) {
  const requestPath = decodeURIComponent(new URL(request.url, `http://${host}:${port}`).pathname);
  const candidate = requestPath === '/' ? path.join(dist, 'index.html') : path.join(dist, requestPath);
  const safeCandidate = path.normalize(candidate);
  const filePath = safeCandidate.startsWith(dist) && fs.existsSync(safeCandidate) && fs.statSync(safeCandidate).isFile()
    ? safeCandidate
    : path.join(dist, 'index.html');
  if (!fs.existsSync(filePath)) {
    response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('DreamFrame has not been built yet. Run npm run build first.');
    return;
  }
  response.writeHead(200, {
    'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer((request, response) => {
  if (request.url === '/dreamframe/workers' || request.url?.startsWith('/dreamframe/workers?')) {
    serveWorkerList(response);
    return;
  }
  const resolved = resolveProxyTarget(request.url);
  if (resolved) proxyToWorker(request, response, resolved);
  else serveStatic(request, response);
});

server.on('upgrade', (request, socket, head) => {
  const resolved = resolveProxyTarget(request.url);
  if (!resolved || !request.url?.includes('/ws')) {
    socket.destroy();
    return;
  }

  const { worker, prefix } = resolved;
  const targetPath = request.url.replace(prefix, '') || '/ws';
  const targetPort = Number(worker.url.port || (worker.url.protocol === 'https:' ? 443 : 80));
  const connectOptions = { host: worker.url.hostname, port: targetPort };
  const upstream = worker.url.protocol === 'https:'
    ? tls.connect({ ...connectOptions, servername: worker.url.hostname })
    : net.connect(connectOptions);

  upstream.once('connect', () => {
    const headers = { ...request.headers, host: request.headers.host || `${host}:${port}` };
    const headerLines = Object.entries(headers)
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(', ') : value}`)
      .join('\r\n');
    upstream.write(`${request.method || 'GET'} ${targetPath} HTTP/${request.httpVersion}\r\n${headerLines}\r\n\r\n`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });

  const closeWithError = () => {
    if (!socket.destroyed) socket.destroy();
    if (!upstream.destroyed) upstream.destroy();
  };
  upstream.on('error', closeWithError);
  socket.on('error', closeWithError);
});

server.listen(port, host, () => {
  console.log(`DreamFrame production server: http://${host}:${port}`);
  console.log(`Configured render workers: ${workers.map((worker) => `${worker.name} (${worker.url.origin})`).join(', ')}`);
  console.log(`Worker configuration file: ${workersFile}`);
});
