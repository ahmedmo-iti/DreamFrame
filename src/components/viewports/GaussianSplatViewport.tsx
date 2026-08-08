import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { AlertTriangle, Eye, Grid, Loader2, Pause, Play, RotateCcw } from 'lucide-react';
import type { ParsedGaussianCloud } from '../../lib/gaussianPly';

type CameraPreset = 'orbit' | 'flythrough' | 'dolly';

interface GaussianSplatViewportProps {
  plyUrl?: string;
  filename?: string;
  interactive?: boolean;
}


function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatCount(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

function parseGaussianPlyInWorker(buffer: ArrayBuffer, maxSplats: number, signal: AbortSignal): Promise<ParsedGaussianCloud> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./gaussianParser.worker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => {
      signal.removeEventListener('abort', handleAbort);
      worker.terminate();
    };
    const handleAbort = () => {
      cleanup();
      reject(new DOMException('Gaussian parsing cancelled', 'AbortError'));
    };
    signal.addEventListener('abort', handleAbort, { once: true });
    worker.onmessage = (event: MessageEvent<{ ok: boolean; parsed?: ParsedGaussianCloud; error?: string }>) => {
      cleanup();
      if (event.data.ok && event.data.parsed) resolve(event.data.parsed);
      else reject(new Error(event.data.error || 'Gaussian parsing failed.'));
    };
    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || 'Gaussian parser worker failed.'));
    };
    worker.postMessage({ buffer, maxSplats }, [buffer]);
  });
}

async function fetchArrayBuffer(url: string, signal: AbortSignal, onProgress: (percent: number) => void) {
  const response = await fetch(url, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not load the Gaussian PLY (${response.status}).`);
  const total = Number(response.headers.get('content-length') || 0);
  const reader = response.body?.getReader();
  if (!reader) return response.arrayBuffer();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    loaded += value.byteLength;
    if (total) onProgress(Math.min(90, Math.round((loaded / total) * 90)));
  }
  const merged = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged.buffer;
}

function bucketDepthSort(positions: Float32Array, viewMatrix: THREE.Matrix4) {
  const count = positions.length / 3;
  const elements = viewMatrix.elements;
  const depths = new Float32Array(count);
  let min = Infinity;
  let max = -Infinity;
  for (let index = 0; index < count; index++) {
    const x = positions[index * 3];
    const y = positions[index * 3 + 1];
    const z = positions[index * 3 + 2];
    const depth = -(elements[2] * x + elements[6] * y + elements[10] * z + elements[14]);
    depths[index] = depth;
    min = Math.min(min, depth);
    max = Math.max(max, depth);
  }

  const bucketCount = 512;
  const counts = new Uint32Array(bucketCount);
  const buckets = new Uint16Array(count);
  const range = Math.max(0.00001, max - min);
  for (let index = 0; index < count; index++) {
    const normalized = (depths[index] - min) / range;
    const bucket = bucketCount - 1 - Math.min(bucketCount - 1, Math.floor(normalized * (bucketCount - 1)));
    buckets[index] = bucket;
    counts[bucket] += 1;
  }
  const offsets = new Uint32Array(bucketCount);
  for (let bucket = 1; bucket < bucketCount; bucket++) offsets[bucket] = offsets[bucket - 1] + counts[bucket - 1];
  const cursors = offsets.slice();
  const order = new Uint32Array(count);
  for (let index = 0; index < count; index++) order[cursors[buckets[index]]++] = index;
  return order;
}

function createMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uViewport: { value: new THREE.Vector2(1, 1) },
      uExposure: { value: 1 },
    },
    vertexShader: `
      attribute vec2 aCorner;
      attribute vec3 aCenter;
      attribute vec3 aColor;
      attribute float aOpacity;
      attribute vec3 aScale;
      attribute vec4 aRotation;
      uniform vec2 uViewport;
      uniform float uExposure;
      varying vec2 vLocal;
      varying vec3 vColor;
      varying float vOpacity;

      mat3 quaternionToMatrix(vec4 q) {
        float x = q.x; float y = q.y; float z = q.z; float w = q.w;
        float x2 = x + x; float y2 = y + y; float z2 = z + z;
        float xx = x * x2; float xy = x * y2; float xz = x * z2;
        float yy = y * y2; float yz = y * z2; float zz = z * z2;
        float wx = w * x2; float wy = w * y2; float wz = w * z2;
        return mat3(
          1.0 - (yy + zz), xy + wz, xz - wy,
          xy - wz, 1.0 - (xx + zz), yz + wx,
          xz + wy, yz - wx, 1.0 - (xx + yy)
        );
      }

      vec2 projectAxis(vec3 axis, vec3 centerView, float fx, float fy, float depth) {
        float depth2 = depth * depth;
        return vec2(
          fx * (axis.x * depth + centerView.x * axis.z) / depth2,
          fy * (axis.y * depth + centerView.y * axis.z) / depth2
        );
      }

      void main() {
        vec3 centerView = (modelViewMatrix * vec4(aCenter, 1.0)).xyz;
        float depth = max(0.01, -centerView.z);
        mat3 rotation = quaternionToMatrix(aRotation);
        mat3 viewRotation = mat3(modelViewMatrix);
        vec3 axis0 = viewRotation * (rotation[0] * aScale.x);
        vec3 axis1 = viewRotation * (rotation[1] * aScale.y);
        vec3 axis2 = viewRotation * (rotation[2] * aScale.z);
        float fx = projectionMatrix[0][0] * uViewport.x * 0.5;
        float fy = projectionMatrix[1][1] * uViewport.y * 0.5;
        vec2 p0 = projectAxis(axis0, centerView, fx, fy, depth);
        vec2 p1 = projectAxis(axis1, centerView, fx, fy, depth);
        vec2 p2 = projectAxis(axis2, centerView, fx, fy, depth);
        float covarianceA = dot(vec3(p0.x, p1.x, p2.x), vec3(p0.x, p1.x, p2.x)) + 0.35;
        float covarianceB = dot(vec3(p0.x, p1.x, p2.x), vec3(p0.y, p1.y, p2.y));
        float covarianceD = dot(vec3(p0.y, p1.y, p2.y), vec3(p0.y, p1.y, p2.y)) + 0.35;
        float trace = covarianceA + covarianceD;
        float discriminant = sqrt(max(0.0, (covarianceA - covarianceD) * (covarianceA - covarianceD) + 4.0 * covarianceB * covarianceB));
        float lambda1 = clamp(0.5 * (trace + discriminant), 0.35, 180000.0);
        float lambda2 = clamp(0.5 * (trace - discriminant), 0.35, 180000.0);
        vec2 eigen1 = abs(covarianceB) > 0.00001 ? normalize(vec2(lambda1 - covarianceD, covarianceB)) : vec2(1.0, 0.0);
        vec2 eigen2 = vec2(-eigen1.y, eigen1.x);
        vec2 offsetPixels = eigen1 * sqrt(lambda1) * aCorner.x + eigen2 * sqrt(lambda2) * aCorner.y;
        vec4 clip = projectionMatrix * vec4(centerView, 1.0);
        clip.xy += (offsetPixels * 2.0 / uViewport) * clip.w;
        gl_Position = clip;
        vLocal = aCorner;
        vColor = aColor * uExposure;
        vOpacity = aOpacity;
      }
    `,
    fragmentShader: `
      varying vec2 vLocal;
      varying vec3 vColor;
      varying float vOpacity;
      void main() {
        float exponent = -0.5 * dot(vLocal, vLocal);
        float alpha = exp(exponent) * vOpacity;
        if (alpha < 0.008) discard;
        gl_FragColor = vec4(vColor, alpha);
      }
    `,
  });
}

export const GaussianSplatViewport: React.FC<GaussianSplatViewportProps> = ({ plyUrl, filename, interactive = true }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const resetRef = useRef<() => void>(() => undefined);
  const keyboardActionRef = useRef<(key: string) => void>(() => undefined);
  const [loading, setLoading] = useState(Boolean(plyUrl));
  const [loadingPercent, setLoadingPercent] = useState(0);
  const [error, setError] = useState(plyUrl ? '' : 'No Gaussian PLY output was reported by ComfyUI.');
  const [stats, setStats] = useState<{ source: number; rendered: number } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [exposure, setExposure] = useState(1);
  const [preset, setPreset] = useState<CameraPreset>('orbit');
  const [reloadKey, setReloadKey] = useState(0);
  const stateRef = useRef({ isPlaying, showGrid, exposure, preset });

  useEffect(() => {
    stateRef.current = { isPlaying, showGrid, exposure, preset };
  }, [exposure, isPlaying, preset, showGrid]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !plyUrl) return;
    let disposed = false;
    let animationFrame = 0;
    let lastAutoSort = 0;
    const controller = new AbortController();
    setLoading(true);
    setLoadingPercent(0);
    setError('');
    setStats(null);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050507);
    const camera = new THREE.PerspectiveCamera(58, Math.max(1, mount.clientWidth) / Math.max(1, mount.clientHeight), 0.01, 100);
    const defaultPosition = new THREE.Vector3(3.7, 2.1, 4.8);
    camera.position.copy(defaultPosition);
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setSize(Math.max(1, mount.clientWidth), Math.max(1, mount.clientHeight));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x050507, 1);
    renderer.sortObjects = false;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enabled = interactive;
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 0.25;
    controls.maxDistance = 20;
    controls.target.set(0, 0, 0);
    controls.update();

    const grid = new THREE.GridHelper(8, 40, 0x343842, 0x151820);
    grid.position.y = -2;
    scene.add(grid);

    let mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial> | null = null;
    let cloud: ParsedGaussianCloud | null = null;
    let sortedCenters: Float32Array | null = null;
    let sortedColors: Float32Array | null = null;
    let sortedScales: Float32Array | null = null;
    let sortedRotations: Float32Array | null = null;
    let sortedOpacities: Float32Array | null = null;

    const applySort = () => {
      if (!mesh || !cloud || !sortedCenters || !sortedColors || !sortedScales || !sortedRotations || !sortedOpacities) return;
      camera.updateMatrixWorld();
      const order = bucketDepthSort(cloud.positions, camera.matrixWorldInverse);
      for (let outputIndex = 0; outputIndex < order.length; outputIndex++) {
        const inputIndex = order[outputIndex];
        sortedCenters.set(cloud.positions.subarray(inputIndex * 3, inputIndex * 3 + 3), outputIndex * 3);
        sortedColors.set(cloud.colors.subarray(inputIndex * 3, inputIndex * 3 + 3), outputIndex * 3);
        sortedScales.set(cloud.scales.subarray(inputIndex * 3, inputIndex * 3 + 3), outputIndex * 3);
        sortedRotations.set(cloud.rotations.subarray(inputIndex * 4, inputIndex * 4 + 4), outputIndex * 4);
        sortedOpacities[outputIndex] = cloud.opacities[inputIndex];
      }
      for (const name of ['aCenter', 'aColor', 'aScale', 'aRotation', 'aOpacity']) {
        const attribute = mesh.geometry.getAttribute(name) as THREE.InstancedBufferAttribute;
        attribute.needsUpdate = true;
      }
    };

    controls.addEventListener('end', applySort);
    resetRef.current = () => {
      camera.position.copy(defaultPosition);
      controls.target.set(0, 0, 0);
      controls.update();
      applySort();
    };
    keyboardActionRef.current = (key: string) => {
      const offset = camera.position.clone().sub(controls.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      if (key === 'ArrowLeft') spherical.theta -= 0.12;
      if (key === 'ArrowRight') spherical.theta += 0.12;
      if (key === 'ArrowUp') spherical.phi = clamp(spherical.phi - 0.1, 0.15, Math.PI - 0.15);
      if (key === 'ArrowDown') spherical.phi = clamp(spherical.phi + 0.1, 0.15, Math.PI - 0.15);
      if (key === '+' || key === '=') spherical.radius = Math.max(0.3, spherical.radius * 0.88);
      if (key === '-' || key === '_') spherical.radius = Math.min(20, spherical.radius * 1.12);
      camera.position.copy(controls.target.clone().add(new THREE.Vector3().setFromSpherical(spherical)));
      controls.update();
      applySort();
    };

    const installCloud = (parsed: ParsedGaussianCloud) => {
      cloud = parsed;
      const count = parsed.renderedCount;
      const geometry = new THREE.InstancedBufferGeometry();
      geometry.setAttribute('aCorner', new THREE.Float32BufferAttribute([-3, -3, 3, -3, 3, 3, -3, 3], 2));
      geometry.setIndex([0, 1, 2, 0, 2, 3]);
      sortedCenters = new Float32Array(count * 3);
      sortedColors = new Float32Array(count * 3);
      sortedScales = new Float32Array(count * 3);
      sortedRotations = new Float32Array(count * 4);
      sortedOpacities = new Float32Array(count);
      geometry.setAttribute('aCenter', new THREE.InstancedBufferAttribute(sortedCenters, 3));
      geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(sortedColors, 3));
      geometry.setAttribute('aScale', new THREE.InstancedBufferAttribute(sortedScales, 3));
      geometry.setAttribute('aRotation', new THREE.InstancedBufferAttribute(sortedRotations, 4));
      geometry.setAttribute('aOpacity', new THREE.InstancedBufferAttribute(sortedOpacities, 1));
      geometry.instanceCount = count;
      const material = createMaterial();
      material.uniforms.uViewport.value.set(Math.max(1, mount.clientWidth), Math.max(1, mount.clientHeight));
      mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      scene.add(mesh);
      grid.position.y = clamp(parsed.floorY, -2.3, 1.1);
      applySort();
    };

    void (async () => {
      try {
        const buffer = await fetchArrayBuffer(plyUrl, controller.signal, setLoadingPercent);
        if (disposed) return;
        setLoadingPercent(93);
        const maxSplats = window.innerWidth < 768 ? 75_000 : 180_000;
        const parsed = await parseGaussianPlyInWorker(buffer, maxSplats, controller.signal);
        if (disposed) return;
        installCloud(parsed);
        setStats({ source: parsed.sourceCount, rendered: parsed.renderedCount });
        setLoadingPercent(100);
        setLoading(false);
      } catch (loadError) {
        if (disposed || (loadError instanceof DOMException && loadError.name === 'AbortError')) return;
        setError(loadError instanceof Error ? loadError.message : 'The Gaussian PLY could not be displayed.');
        setLoading(false);
      }
    })();

    const clock = new THREE.Clock();
    const animate = () => {
      animationFrame = requestAnimationFrame(animate);
      const elapsed = clock.getElapsedTime();
      const current = stateRef.current;
      if (current.isPlaying) {
        if (current.preset === 'orbit') {
          camera.position.x = Math.sin(elapsed * 0.22) * 4.6;
          camera.position.z = Math.cos(elapsed * 0.22) * 4.6;
          camera.position.y = 1.4;
          camera.lookAt(0, 0, 0);
        } else if (current.preset === 'flythrough') {
          camera.position.x = Math.sin(elapsed * 0.17) * 2.5;
          camera.position.z = 1.4 + Math.cos(elapsed * 0.17) * 2.2;
          camera.position.y = 0.4 + Math.sin(elapsed * 0.11) * 0.5;
          camera.lookAt(0, 0, 0);
        } else {
          camera.position.z = 3.5 + Math.sin(elapsed * 0.5) * 1.7;
          camera.position.x = 0.35;
          camera.lookAt(0, 0, 0);
        }
        if (elapsed - lastAutoSort > 0.65) {
          lastAutoSort = elapsed;
          applySort();
        }
      }
      grid.visible = current.showGrid;
      if (mesh) mesh.material.uniforms.uExposure.value = current.exposure;
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width <= 0 || height <= 0) continue;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
        if (mesh) mesh.material.uniforms.uViewport.value.set(width, height);
      }
    });
    resizeObserver.observe(mount);

    return () => {
      disposed = true;
      controller.abort();
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      controls.removeEventListener('end', applySort);
      controls.dispose();
      if (mesh) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, [interactive, plyUrl, reloadKey]);

  return (
    <div className="relative h-full min-h-[420px] w-full overflow-hidden rounded-2xl border border-white/10 bg-[#050507]">
      <div
        ref={mountRef}
        tabIndex={0}
        onKeyDown={(event) => {
          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_'].includes(event.key)) {
            event.preventDefault();
            keyboardActionRef.current(event.key);
          } else if (event.key.toLowerCase() === 'r') {
            event.preventDefault();
            resetRef.current();
          } else if (event.key === ' ') {
            event.preventDefault();
            setIsPlaying((value) => !value);
          }
        }}
        className="h-full w-full cursor-grab active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-white"
        aria-label="Interactive anisotropic Gaussian splat viewer. Use arrow keys to rotate, plus and minus to zoom, R to reset, and Space to play or pause."
      />

      <div className="pointer-events-none absolute left-4 right-4 top-4 flex items-center justify-between gap-3">
        <div className="pointer-events-auto flex max-w-[70%] items-center gap-2 rounded-full border border-white/10 bg-black/75 px-3 py-1.5 text-[11px] font-mono text-white/80 backdrop-blur-md">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <span className="truncate">{filename || 'GAUSSIAN PLY'}</span>
          {stats && <span className="text-white/40">{formatCount(stats.rendered)} rendered / {formatCount(stats.source)} source</span>}
        </div>
        <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/10 bg-black/75 p-1 backdrop-blur-md">
          <button onClick={() => setShowGrid((value) => !value)} aria-pressed={showGrid} aria-label="Toggle grid" className={`rounded-full p-2 ${showGrid ? 'bg-white text-black' : 'text-white/60'}`}><Grid className="h-3.5 w-3.5" /></button>
          <button onClick={() => resetRef.current()} aria-label="Reset camera" className="rounded-full p-2 text-white/70 hover:bg-white/10"><RotateCcw className="h-3.5 w-3.5" /></button>
        </div>
      </div>

      <div className="absolute bottom-4 left-4 right-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1 rounded-full border border-white/10 bg-black/75 p-1 backdrop-blur-md">
          <button onClick={() => setIsPlaying((value) => !value)} aria-label={isPlaying ? 'Pause camera motion' : 'Play camera motion'} className="rounded-full p-2 text-white/80 hover:bg-white/10">{isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}</button>
          {(['orbit', 'flythrough', 'dolly'] as const).map((mode) => <button key={mode} onClick={() => setPreset(mode)} aria-pressed={preset === mode} className={`rounded-full px-3 py-1.5 text-[10px] font-mono uppercase ${preset === mode ? 'bg-white text-black' : 'text-white/55 hover:text-white'}`}>{mode}</button>)}
        </div>
        <label className="flex items-center gap-2 rounded-full border border-white/10 bg-black/75 px-3 py-2 text-[10px] font-mono text-white/50 backdrop-blur-md">
          <Eye className="h-3.5 w-3.5" /> EXPOSURE
          <input type="range" min="0.5" max="2" step="0.05" value={exposure} onChange={(event) => setExposure(Number(event.target.value))} className="w-24 accent-white" />
        </label>
      </div>

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/75 backdrop-blur-sm" role="status" aria-live="polite">
          <div className="min-w-64 rounded-2xl border border-white/10 bg-neutral-950/90 p-5 text-center">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-white" />
            <div className="mt-3 text-xs font-mono text-white/75">Loading anisotropic Gaussian data</div>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-white transition-all" style={{ width: `${loadingPercent}%` }} /></div>
            <div className="mt-2 text-[10px] font-mono text-white/40">{loadingPercent}%</div>
          </div>
        </div>
      )}

      {error && !loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/85 p-6" role="alert">
          <div className="max-w-lg rounded-2xl border border-rose-400/30 bg-rose-500/10 p-6 text-center">
            <AlertTriangle className="mx-auto h-7 w-7 text-rose-300" />
            <h3 className="mt-3 text-lg font-bold text-white">Gaussian output could not be displayed</h3>
            <p className="mt-2 whitespace-pre-wrap text-xs font-mono leading-relaxed text-rose-100/75">{error}</p>
            {plyUrl && <button onClick={() => setReloadKey((value) => value + 1)} className="mt-4 rounded-full bg-white px-5 py-2 text-xs font-bold text-black">Retry viewer</button>}
          </div>
        </div>
      )}
    </div>
  );
};
