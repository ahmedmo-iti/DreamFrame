import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Box, Cpu, Loader2 } from 'lucide-react';

export type MeshRenderMode = 'wireframe' | 'textured' | 'pointcloud' | 'normals' | 'depth';

interface MeshViewportProps {
  interactive?: boolean;
  outputMode?: 'Mesh' | 'Point Cloud';
  modelUrl?: string;
  filename?: string;
  loadingPlaceholder?: boolean;
}

export const MeshViewport: React.FC<MeshViewportProps> = ({
  interactive = true,
  outputMode = 'Mesh',
  modelUrl,
  filename,
  loadingPlaceholder = false,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [renderMode, setRenderMode] = useState<MeshRenderMode>(
    outputMode === 'Point Cloud' ? 'pointcloud' : 'textured',
  );
  const [autoRotate, setAutoRotate] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [loading, setLoading] = useState(Boolean(modelUrl));
  const [loadError, setLoadError] = useState('');
  const autoRotateRef = useRef(autoRotate);
  const keyboardActionRef = useRef<(key: string) => void>(() => undefined);

  useEffect(() => {
    autoRotateRef.current = autoRotate;
  }, [autoRotate]);

  useEffect(() => {
    if (!mountRef.current) return;

    setLoading(Boolean(modelUrl));
    setLoadError('');

    const mount = mountRef.current;
    const width = mount.clientWidth;
    const height = mount.clientHeight;
    const scene = new THREE.Scene();
    // Match Maya's default neutral viewport: a flat medium gray rather than
    // a black or cinematic gradient background.
    scene.background = new THREE.Color(0x606060);

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.01, 1000);
    camera.position.set(2.2, 1.8, 3.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.86;
    renderer.setClearColor(0x606060, 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const environmentTarget = pmremGenerator.fromScene(new RoomEnvironment(), 0.02);
    scene.environment = environmentTarget.texture;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enabled = interactive;
    keyboardActionRef.current = (key: string) => {
      const offset = camera.position.clone().sub(controls.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      if (key === 'ArrowLeft') spherical.theta -= 0.12;
      if (key === 'ArrowRight') spherical.theta += 0.12;
      if (key === 'ArrowUp') spherical.phi = Math.max(0.15, spherical.phi - 0.1);
      if (key === 'ArrowDown') spherical.phi = Math.min(Math.PI - 0.15, spherical.phi + 0.1);
      if (key === '+' || key === '=') spherical.radius = Math.max(0.3, spherical.radius * 0.88);
      if (key === '-' || key === '_') spherical.radius = Math.min(30, spherical.radius * 1.12);
      camera.position.copy(controls.target.clone().add(new THREE.Vector3().setFromSpherical(spherical)));
      controls.update();
    };

    // Neutral, Maya-like default viewport lighting. This keeps PBR materials
    // readable without the overexposed studio look used by the previous build.
    scene.add(new THREE.HemisphereLight(0xd9dde1, 0x4b4f52, 0.58));
    scene.add(new THREE.AmbientLight(0xffffff, 0.12));

    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(5, 7, 6);
    key.castShadow = true;
    scene.add(key);

    const fill = new THREE.DirectionalLight(0xcfd5da, 0.28);
    fill.position.set(-5, 3, 4);
    scene.add(fill);

    const rim = new THREE.DirectionalLight(0xd8dde1, 0.22);
    rim.position.set(-3, 5, -6);
    scene.add(rim);


    let rootObject: THREE.Object3D | null = null;
    const disposables: Array<{ dispose: () => void }> = [];

    const applyRenderMode = (root: THREE.Object3D) => {
      root.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;

        const sourceMaterial = Array.isArray(child.material) ? child.material[0] : child.material;
        let material: THREE.Material;

        if (renderMode === 'normals') {
          material = new THREE.MeshNormalMaterial({ flatShading: true });
        } else if (renderMode === 'depth') {
          material = new THREE.MeshDepthMaterial();
        } else {
          const standard = sourceMaterial instanceof THREE.MeshStandardMaterial
            ? sourceMaterial.clone()
            : new THREE.MeshStandardMaterial({ color: 0x9aa0ad, roughness: 0.55, metalness: 0.1 });
          standard.wireframe = renderMode === 'wireframe';
          standard.envMapIntensity = 0.48;
          standard.needsUpdate = true;
          if (renderMode === 'pointcloud') {
            standard.wireframe = true;
            standard.transparent = true;
            standard.opacity = 0.45;
          }
          material = standard;
        }

        child.material = material;
        disposables.push(material);
      });
    };

    const fitObject = (object: THREE.Object3D) => {
      const box = new THREE.Box3().setFromObject(object);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      object.position.sub(center);
      const maxDimension = Math.max(size.x, size.y, size.z, 0.0001);
      const scale = 2.25 / maxDimension;
      object.scale.setScalar(scale);

      const scaledBox = new THREE.Box3().setFromObject(object);
      object.position.y -= scaledBox.min.y + 1.15;
      controls.target.set(0, 0, 0);
      controls.update();
    };

    if (modelUrl?.toLowerCase().includes('.glb') || modelUrl?.toLowerCase().includes('.gltf')) {
      new GLTFLoader().load(
        modelUrl,
        (gltf) => {
          rootObject = gltf.scene;
          applyRenderMode(rootObject);
          fitObject(rootObject);
          scene.add(rootObject);
          setLoading(false);
        },
        undefined,
        (error) => {
          console.error(error);
          setLoadError('The mesh file was created, but the browser preview could not load it. Use Export to download it.');
          setLoading(false);
        },
      );
    } else {
      setLoading(false);
    }

    let animationFrame = 0;
    const animate = () => {
      animationFrame = requestAnimationFrame(animate);
      if (autoRotateRef.current && rootObject) rootObject.rotation.y += 0.008;
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: newWidth, height: newHeight } = entry.contentRect;
        if (newWidth > 0 && newHeight > 0) {
          camera.aspect = newWidth / newHeight;
          camera.updateProjectionMatrix();
          renderer.setSize(newWidth, newHeight);
        }
      }
    });
    resizeObserver.observe(mount);

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      controls.dispose();
      disposables.forEach((item) => item.dispose());
      environmentTarget.dispose();
      pmremGenerator.dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, [interactive, modelUrl, renderMode]);

  return (
    <div className="relative w-full h-full min-h-[360px] rounded-2xl overflow-hidden bg-[#606060] border border-black/30 group">
      <div
        ref={mountRef}
        tabIndex={0}
        onKeyDown={(event) => {
          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_'].includes(event.key)) {
            event.preventDefault();
            keyboardActionRef.current(event.key);
          } else if (event.key === ' ') {
            event.preventDefault();
            setAutoRotate((value) => !value);
          }
        }}
        className="w-full h-full cursor-grab active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-white"
        aria-label="Interactive 3D model viewer. Use arrow keys to rotate, plus and minus to zoom, and Space to toggle the turntable."
      />

      <div className="absolute top-4 left-4 right-4 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-2 pointer-events-auto bg-black/80 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 text-xs text-white/80 font-mono max-w-[52%]">
          <Box className="w-3.5 h-3.5 text-white/80 shrink-0" />
          <span className="truncate">{filename || (modelUrl ? 'LOCAL COMFYUI MESH' : loadingPlaceholder ? 'GENERATING LOCAL MESH' : 'EMPTY VIEWPORT')}</span>
        </div>

        <div className="flex items-center gap-1 pointer-events-auto bg-black/80 backdrop-blur-md border border-white/10 rounded-full p-1 text-xs">
          {([
            { id: 'wireframe', label: 'Wireframe' },
            { id: 'textured', label: 'Shaded' },
            { id: 'normals', label: 'Normals' },
          ] as const).map((mode) => (
            <button
              key={mode.id}
              onClick={() => setRenderMode(mode.id)}
              className={`px-3 py-1 rounded-full text-[11px] font-mono transition-all ${
                renderMode === mode.id ? 'bg-white text-black font-semibold' : 'text-white/60 hover:text-white'
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      {loadingPlaceholder && !modelUrl && !loadError && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/30 bg-black/25 shadow-sm">
            <Loader2 className="h-4 w-4 animate-spin text-white/90" />
          </div>
        </div>
      )}

      {loading && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="flex items-center gap-3 rounded-full border border-white/10 bg-black/80 px-5 py-3 font-mono text-xs text-white/80">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading generated mesh
          </div>
        </div>
      )}

      {loadError && (
        <div className="absolute left-4 right-4 bottom-16 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-2 text-[11px] font-mono text-amber-100/80">
          {loadError}
        </div>
      )}

      <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-3 pointer-events-auto bg-black/70 backdrop-blur-md border border-white/10 rounded-full px-3.5 py-1.5 text-[11px] font-mono text-white/70">
          <Cpu className="w-3.5 h-3.5 text-white/50" />
          <span>{modelUrl || loadingPlaceholder ? 'SOURCE: COMFY DESKTOP' : 'NO MODEL LOADED'}</span>
        </div>

        <button
          onClick={() => setAutoRotate(!autoRotate)}
          className={`pointer-events-auto text-xs font-mono px-3 py-1.5 rounded-full border backdrop-blur-md transition-all ${
            autoRotate
              ? 'bg-white/15 text-white border-white/30'
              : 'bg-black/80 text-white/50 border-white/10 hover:text-white'
          }`}
        >
          {autoRotate ? 'TURNTABLE: ON' : 'TURNTABLE: OFF'}
        </button>
      </div>
    </div>
  );
};
