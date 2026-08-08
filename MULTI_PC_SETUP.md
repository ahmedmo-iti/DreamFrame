# DreamFrame Multi-PC Render Setup

DreamFrame can distribute Shot Editor scenes across several ComfyUI PCs on the same trusted local network. The main DreamFrame workstation acts as the coordinator; the render PCs only need compatible ComfyUI installations.

## 1. Prepare every render PC

Every PC should have:

- the same WAN 2.2 workflow models;
- the same custom-node versions used by the supplied workflow;
- enough local disk space for ComfyUI input, temp, and output files;
- a unique LAN IP address that does not change during the render session.

Start ComfyUI so it listens on the LAN rather than only on localhost. Standard ComfyUI supports the `--listen` and `--port` arguments. Common launch examples are:

```bat
python main.py --listen 0.0.0.0 --port 8188
```

For the Windows portable package, the equivalent command commonly uses its embedded Python executable:

```bat
python_embeded\python.exe -s ComfyUI\main.py --listen 0.0.0.0 --port 8188
```

Keep this restricted to a trusted private network. Do not expose an unauthenticated ComfyUI port directly to the public internet.

## 2. Allow the Windows firewall rule

On each render PC, allow inbound TCP traffic for the selected ComfyUI port, normally `8188`, on the **Private network** profile only.

From the main PC, verify each render PC in a browser:

```text
http://RENDER_PC_IP:8188/system_stats
```

A JSON response means the main PC can reach that worker.

## 3. Configure DreamFrame

Edit `dreamframe-workers.json` in the DreamFrame project folder:

```json
{
  "workers": [
    {
      "id": "main-pc",
      "name": "Main PC",
      "url": "http://127.0.0.1:8188",
      "enabled": true
    },
    {
      "id": "render-pc-02",
      "name": "Render PC 02",
      "url": "http://192.168.1.52:8188",
      "enabled": true
    },
    {
      "id": "render-pc-03",
      "name": "Render PC 03",
      "url": "http://192.168.1.53:8188",
      "enabled": true
    }
  ]
}
```

Use the actual LAN IP address of each PC. Restart DreamFrame after changing this file.

## 4. Render across PCs

1. Open **Cinematic Shot Editor**.
2. Select **Multiple PCs** under Render Devices.
3. Press **Refresh PCs** and confirm at least two machines show **Online**.
4. Assign a render PC to each shot.
5. Add a separate reference image to any shots that should start immediately in parallel.
6. Start the queue.
7. Use **Run Shot**, **Run All Ready**, or **Cancel** for each shot.

## Continuity behavior

- Shot 1 can start from the main opening image.
- Any later shot with its own reference image can start immediately on another PC.
- A shot without its own reference waits for the previous shot's final frame, preserving continuity but preventing that dependent shot from starting at the same time.
- Independent shot chains can still render concurrently on separate machines.

## Troubleshooting

### PC shows Offline

- Confirm ComfyUI is running with LAN listening enabled.
- Confirm the IP and port in `dreamframe-workers.json`.
- Confirm Windows Firewall permits the port on the Private profile.
- Confirm both machines are on the same LAN or reachable VPN.

### Preflight fails on only one PC

That worker is missing a model, node, or compatible selection required by the WAN workflow. Match its ComfyUI installation to the working machine, restart ComfyUI, and refresh the devices.

### Output opens on one PC but not in DreamFrame

Keep the remote ComfyUI process running. DreamFrame output URLs are proxied through the main DreamFrame server to the PC that produced the file.
