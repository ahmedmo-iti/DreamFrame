import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';

interface WorkerConfig {
  id: string;
  name: string;
  url: string;
  enabled?: boolean;
}

function safeWorkerId(value: string, fallback: string): string {
  return (value || fallback).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || fallback;
}

function loadWorkers(comfyTarget: string, workersFilename = 'dreamframe-workers.json'): WorkerConfig[] {
  const filename = path.resolve(process.cwd(), workersFilename);
  try {
    if (fs.existsSync(filename)) {
      const parsed = JSON.parse(fs.readFileSync(filename, 'utf8'));
      const list = Array.isArray(parsed) ? parsed : parsed?.workers;
      if (Array.isArray(list)) {
        return list
          .filter((item) => item?.enabled !== false && item?.url)
          .map((item, index) => ({
            id: safeWorkerId(String(item.id || ''), `pc-${index + 1}`),
            name: String(item.name || `Render PC ${index + 1}`),
            url: new URL(item.url).origin,
            enabled: true,
          }));
      }
    }
  } catch {
    // Development falls back to the local Comfy target.
  }
  return [{ id: 'local', name: 'Main PC', url: new URL(comfyTarget).origin, enabled: true }];
}

function workerListPlugin(workers: WorkerConfig[]): Plugin {
  const handler = (request: any, response: any, next: () => void) => {
    if (!request.url?.startsWith('/dreamframe/workers')) {
      next();
      return;
    }
    response.statusCode = 200;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.end(JSON.stringify({
      workers: workers.map((worker) => ({
        id: worker.id,
        name: worker.name,
        apiBase: `/worker/${encodeURIComponent(worker.id)}/comfy`,
        isLocal: worker.url.includes('127.0.0.1') || worker.url.includes('localhost'),
      })),
      configFile: 'dreamframe-workers.json',
    }));
  };
  return {
    name: 'dreamframe-worker-list',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const comfyTarget = env.COMFY_URL || 'http://127.0.0.1:8188';
  const workers = loadWorkers(comfyTarget, env.DREAMFRAME_WORKERS_FILE || 'dreamframe-workers.json');
  const proxy: Record<string, any> = {
    '/comfy': {
      target: comfyTarget,
      changeOrigin: false,
      ws: true,
      rewrite: (requestPath: string) => requestPath.replace(/^\/comfy/, ''),
    },
  };

  for (const worker of workers) {
    const prefix = `/worker/${worker.id}/comfy`;
    proxy[prefix] = {
      target: worker.url,
      changeOrigin: false,
      ws: true,
      rewrite: (requestPath: string) => requestPath.replace(prefix, ''),
    };
  }

  return {
    plugins: [react(), tailwindcss(), workerListPlugin(workers)],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      host: '127.0.0.1',
      port: 3000,
      strictPort: true,
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      proxy,
    },
    preview: {
      host: '127.0.0.1',
      port: 3000,
      strictPort: true,
      proxy,
    },
  };
});
