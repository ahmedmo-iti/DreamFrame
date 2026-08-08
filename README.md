# DreamFrame

A local-first, browser-based production interface for [ComfyUI](https://github.com/comfyanonymous/ComfyUI).
Build cinematic shots with a visual WAN 2.2 image-to-video editor, generate 3D models and
Gaussian splats with TRELLIS, keep a persistent local library of everything you make, and
distribute renders across multiple GPUs on your LAN.

Everything runs on your own machine. DreamFrame is a static front end plus a thin Node proxy;
ComfyUI does all the generation. The server binds to `127.0.0.1` — nothing leaves your network
except the render traffic you send to your own worker PCs.

## What it does

- **Cinematic shot editor** — upload an opening frame, lay out up to 12 scenes on a timeline,
  and set each scene's direction, negative direction, duration, camera move, and lens. Scenes
  can inherit the previous scene's final frame for continuity, or use their own reference image.
- **Workflow tab** — post arbitrary API-format ComfyUI graphs and read the queue/history back.
- **3D + splats** — TRELLIS image-to-3D workflows export textured and untextured GLB meshes;
  a built-in viewer previews Gaussian `.ply` splats.
- **Persistent local library** — projects and generated assets are stored in the browser
  (IndexedDB, with a localStorage fallback) and survive reloads.
- **Multi-PC rendering** — assign each scene to a render PC and dispatch shots to several
  ComfyUI machines at once. See [MULTI_PC_SETUP.md](MULTI_PC_SETUP.md).
- **Per-shot run/cancel** — start, watch, and stop individual shots from the render queue.

## Requirements

- [Node.js](https://nodejs.org) 18+ (to run the dev server or build the production bundle)
- A running [ComfyUI](https://github.com/comfyanonymous/ComfyUI) instance at
  `http://127.0.0.1:8188` (configurable), with the custom nodes and models required by the
  workflows you intend to use (WAN 2.2 for video, TRELLIS2 for 3D, etc.)

## Quick start (development)

```bash
npm install
npm run dev
```

Then open <http://127.0.0.1:3000>. The dev server proxies `/comfy` to your ComfyUI instance.

## Production build

```bash
npm run build   # outputs static files to dist/
npm run start   # serves dist/ and proxies ComfyUI via server.mjs on port 3000
```

On Windows you can double-click **Start DreamFrame.bat**, which installs dependencies, builds,
and launches the production server in one step. **Build DreamFrame.bat** just runs the checks
and build.

## Configuration

Copy `.env.example` to `.env.local` and adjust as needed:

| Variable | Default | Purpose |
|---|---|---|
| `COMFY_URL` | `http://127.0.0.1:8188` | Local ComfyUI origin the server proxies to |
| `DREAMFRAME_HOST` | `127.0.0.1` | Host the production server binds to |
| `PORT` | `3000` | Production server port |
| `DREAMFRAME_WORKERS_FILE` | `dreamframe-workers.json` | Multi-PC worker list |

Render PCs are listed in `dreamframe-workers.json` (copy from `dreamframe-workers.example.json`).
Run **Configure Render PCs.bat** to edit it, or see [MULTI_PC_SETUP.md](MULTI_PC_SETUP.md).

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Vite dev server on `127.0.0.1:3000` |
| `npm run build` | Type-check-free production build to `dist/` |
| `npm run start` | Serve the built app + ComfyUI proxy (`server.mjs`) |
| `npm run lint` | `tsc --noEmit` type check |
| `npm test` | Vitest unit tests |
| `npm run check` | lint + test + build |

## Project layout

```
src/            React + TypeScript app (components, lib, hooks)
  lib/          ComfyUI client, graph builders, queue, storage
public/         static assets and ComfyUI workflow templates
tests/          Vitest unit tests
server.mjs      production static server + ComfyUI/worker proxy
vite.config.ts  dev server, proxy, and worker-list plugin
```

The ComfyUI graphs are built programmatically in `src/lib/` (`editGraphs.ts`,
`workflowGraph.ts`) and dispatched through the `/comfy` proxy, so recipes run against your
live server rather than shipping as frozen workflow JSON.

## License

MIT — see [LICENSE](LICENSE).
