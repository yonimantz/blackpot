import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  GridHelper,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Raycaster,
  Scene,
  ShadowMaterial,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Texture,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
  WireframeGeometry,
  type Material,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Model3dDisplayMode } from '../types/nodeTypes';

export interface Model3dViewerSettings {
  showGrid: boolean;
  transparentBg: boolean;
  keyLight: number;
  fillLight: number;
  shadowStrength: number;
  lightAzimuth: number;
  lightElevation: number;
  displayMode: Model3dDisplayMode;
}

export interface Model3dViewerHandle {
  /**
   * PNG data URL of the current view (grid/shadow/display-mode as currently
   * toggled, but never the corner gizmo), or null if nothing is loaded yet.
   */
  captureImage: () => string | null;
}

const BG_COLOR = 0x18181b;
const GIZMO_MARGIN = 6;

/** Gizmo size tracks the node size so it stays proportional when resized. */
function gizmoDim(width: number, height: number): number {
  return Math.round(Math.max(44, Math.min(84, Math.min(width, height) * 0.3)));
}

function makeDotTexture(color: string, label: string, faded: boolean): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.beginPath();
  ctx.arc(32, 32, 16, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.globalAlpha = faded ? 0.35 : 1;
  ctx.fill();
  if (label) {
    ctx.globalAlpha = 1;
    ctx.font = 'bold 28px Arial';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#111114';
    ctx.fillText(label, 32, 42);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

interface Gizmo {
  scene: Scene;
  camera: OrthographicCamera;
  root: Group;
  handles: Sprite[];
  dispose: () => void;
}

/**
 * Compact axis navigator drawn into a corner viewport. Written by hand rather
 * than using three's `ViewHelper` because that helper is locked to a 128px
 * square (far too large for a small node) and drives the camera quaternion
 * directly, which fights OrbitControls' target-based orientation.
 */
function createGizmo(): Gizmo {
  const scene = new Scene();
  const camera = new OrthographicCamera(-2, 2, 2, -2, 0, 4);
  camera.position.set(0, 0, 2);

  const root = new Group();
  scene.add(root);

  const axisGeometry = new CylinderGeometry(0.05, 0.05, 0.8, 6)
    .rotateZ(-Math.PI / 2)
    .translate(0.4, 0, 0);

  const axes: [string, number, number, number][] = [
    ['#ff4466', 0, 0, 0],
    ['#88ff44', 0, 0, Math.PI / 2],
    ['#4488ff', 0, -Math.PI / 2, 0],
  ];
  const owned: (Material | Texture)[] = [];
  for (const [color, rx, ry, rz] of axes) {
    const material = new MeshBasicMaterial({ color, toneMapped: false });
    owned.push(material);
    const mesh = new Mesh(axisGeometry, material);
    mesh.rotation.set(rx, ry, rz);
    root.add(mesh);
  }

  const handles: Sprite[] = [];
  const faces: [string, string, Vector3, boolean][] = [
    ['#ff4466', 'X', new Vector3(1, 0, 0), false],
    ['#88ff44', 'Y', new Vector3(0, 1, 0), false],
    ['#4488ff', 'Z', new Vector3(0, 0, 1), false],
    ['#ff4466', '', new Vector3(-1, 0, 0), true],
    ['#88ff44', '', new Vector3(0, -1, 0), true],
    ['#4488ff', '', new Vector3(0, 0, -1), true],
  ];
  for (const [color, label, dir, faded] of faces) {
    const map = makeDotTexture(color, label, faded);
    const material = new SpriteMaterial({ map, toneMapped: false });
    owned.push(map, material);
    const sprite = new Sprite(material);
    sprite.position.copy(dir);
    sprite.scale.setScalar(0.42);
    sprite.userData.dir = dir;
    root.add(sprite);
    handles.push(sprite);
  }

  return {
    scene,
    camera,
    root,
    handles,
    dispose: () => {
      axisGeometry.dispose();
      for (const item of owned) item.dispose();
    },
  };
}

/**
 * Free every GPU resource reachable from a loaded glTF scene, including the
 * lazily built wireframe overlays (LineSegments, not Mesh, so they need their
 * own geometry pass) and whatever original material a display-mode override
 * parked in `userData` instead of leaving on `.material`. `shared` holds the
 * plain/line materials the viewer reuses across every model, which must
 * survive any single model's disposal.
 */
function disposeTree(root: Object3D, shared: ReadonlySet<Material> = new Set()) {
  const disposed = new Set<Material>();
  const disposeMaterial = (material: Material | null | undefined) => {
    if (!material || shared.has(material) || disposed.has(material)) return;
    disposed.add(material);
    for (const value of Object.values(material)) {
      if (value instanceof Texture) value.dispose();
    }
    material.dispose();
  };

  root.traverse((child) => {
    const obj = child as Object3D & { geometry?: BufferGeometry; material?: Material | Material[] };
    obj.geometry?.dispose();
    if (obj.material) {
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      materials.forEach(disposeMaterial);
    }
    const original = child.userData?.originalMaterial as Material | Material[] | undefined;
    if (original) {
      const originals = Array.isArray(original) ? original : [original];
      originals.forEach(disposeMaterial);
    }
  });
}

/**
 * Swaps each mesh's material between its authored glTF material and a shared
 * plain surface, and shows/hides a lazily built wireframe overlay. The overlay
 * is built once per mesh and cached as a child, since `WireframeGeometry`
 * duplicates every triangle edge and would be wasted work for the common
 * Textured case.
 */
function applyDisplayMode(
  model: Object3D,
  mode: Model3dDisplayMode,
  plainMaterial: Material,
  lineMaterial: Material,
) {
  model.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh) return;
    const original = mesh.userData.originalMaterial as Material | Material[] | undefined;

    if (mode === 'textured' && original) {
      mesh.material = original;
    } else {
      mesh.material = Array.isArray(original) ? original.map(() => plainMaterial) : plainMaterial;
    }

    let overlay = mesh.userData.wireframeOverlay as LineSegments | undefined;
    if (mode === 'wireframe') {
      if (!overlay) {
        overlay = new LineSegments(new WireframeGeometry(mesh.geometry), lineMaterial);
        overlay.userData.isWireframeOverlay = true;
        mesh.add(overlay);
        mesh.userData.wireframeOverlay = overlay;
      }
      overlay.visible = true;
    } else if (overlay) {
      overlay.visible = false;
    }
  });
}

interface SceneRefs {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  ambient: AmbientLight;
  key: DirectionalLight;
  grid: GridHelper;
  shadowPlane: Mesh;
  gizmo: Gizmo;
  model: Object3D | null;
  /** World-space radius of the loaded model, used to place the key light. */
  radius: number;
  /** Untextured surface shared by every mesh in Mesh/Wireframe display mode. */
  plainMaterial: Material;
  /** Line material shared by every mesh's lazily built wireframe overlay. */
  lineMaterial: Material;
  /** `disposeTree` must never free these two — they outlive any one model. */
  sharedMaterials: ReadonlySet<Material>;
  invalidate: () => void;
}

const Model3dViewer = forwardRef<Model3dViewerHandle, {
  src: string;
  settings: Model3dViewerSettings;
}>(function Model3dViewer({ src, settings }, ref) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const refs = useRef<SceneRefs | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  // Scene lifetime is tied to the mount, not to `src` or settings, so changing a
  // light does not rebuild the WebGL context.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // preserveDrawingBuffer is needed for captureImage()'s toDataURL() to
    // reliably read back what was just rendered.
    const renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    // The gizmo is a second pass into the same buffer, so clearing is manual.
    renderer.autoClear = false;
    renderer.domElement.classList.add('nodrag', 'nopan', 'nowheel');
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    host.appendChild(renderer.domElement);

    const scene = new Scene();
    const pmrem = new PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const envTexture = pmrem.fromScene(room, 0.04).texture;
    scene.environment = envTexture;
    room.dispose();
    pmrem.dispose();

    const camera = new PerspectiveCamera(45, 1, 0.01, 1000);
    camera.position.set(2, 1.6, 3);

    const controls = new OrbitControls(camera, renderer.domElement);
    // Damping is off on purpose: it keeps easing after pointer-up, which would
    // require an always-on animation loop. Without it, render-on-demand is exact.
    controls.enableDamping = false;
    controls.enablePan = false;

    const ambient = new AmbientLight(0xffffff, 0.4);
    scene.add(ambient);

    const key = new DirectionalLight(0xffffff, 2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);
    // A directional light aims at its target's world position, so the target
    // has to live in the graph for the shadow camera to follow it.
    scene.add(key.target);

    const shadowPlane = new Mesh(
      new PlaneGeometry(1, 1),
      new ShadowMaterial({ opacity: 0.5, transparent: true }),
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.receiveShadow = true;
    scene.add(shadowPlane);

    const grid = new GridHelper(1, 12, 0x6b7280, 0x3f3f46);
    (grid.material as Material).transparent = true;
    (grid.material as Material).opacity = 0.5;
    scene.add(grid);

    const gizmo = createGizmo();

    // Shared across every mesh so switching to Mesh/Wireframe never allocates
    // per-mesh materials, and so disposeTree knows never to free them.
    const plainMaterial = new MeshStandardMaterial({ color: 0xcfcfd4, roughness: 0.65, metalness: 0 });
    // Pushed back slightly so wireframe lines sitting exactly on the surface
    // they overlay don't z-fight with it.
    plainMaterial.polygonOffset = true;
    plainMaterial.polygonOffsetFactor = 1;
    plainMaterial.polygonOffsetUnits = 1;
    const lineMaterial = new LineBasicMaterial({ color: 0x27272a, transparent: true, opacity: 0.4, depthWrite: false });
    const sharedMaterials = new Set<Material>([plainMaterial, lineMaterial]);

    const savedViewport = new Vector4();
    let frame = 0;
    const renderFrame = () => {
      frame = 0;
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (width < 2 || height < 2) return;

      renderer.clear();
      renderer.render(scene, camera);

      // Second pass: axis navigator in the bottom-right corner.
      const dim = gizmoDim(width, height);
      renderer.getViewport(savedViewport);
      renderer.clearDepth();
      renderer.setViewport(width - dim - GIZMO_MARGIN, GIZMO_MARGIN, dim, dim);
      gizmo.root.quaternion.copy(camera.quaternion).invert();
      renderer.render(gizmo.scene, gizmo.camera);
      renderer.setViewport(
        savedViewport.x,
        savedViewport.y,
        savedViewport.z,
        savedViewport.w,
      );
    };
    const invalidate = () => {
      if (!frame) frame = requestAnimationFrame(renderFrame);
    };

    controls.addEventListener('change', invalidate);

    const resize = new ResizeObserver(() => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (width < 2 || height < 2) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      invalidate();
    });
    resize.observe(host);

    // Gizmo clicks are intercepted in the capture phase so a hit can be
    // swallowed before OrbitControls' own bubble-phase listener starts orbiting.
    const raycaster = new Raycaster();
    const pointer = new Vector2();
    let animation = 0;
    const onPointerDown = (event: PointerEvent) => {
      // The gizmo viewport is sized from the node's layout box, but the node sits
      // inside React Flow's scaled viewport, so getBoundingClientRect reports the
      // zoomed size. Convert the click back into layout space before hit-testing,
      // otherwise the gizmo is unclickable at any zoom other than 100%.
      const layoutW = host.clientWidth;
      const layoutH = host.clientHeight;
      const rect = renderer.domElement.getBoundingClientRect();
      if (!layoutW || !layoutH || !rect.width) return;
      const scale = rect.width / layoutW;

      const dim = gizmoDim(layoutW, layoutH);
      const left = rect.width - (dim + GIZMO_MARGIN) * scale;
      const top = rect.height - (dim + GIZMO_MARGIN) * scale;
      const x = (event.clientX - rect.left - left) / scale;
      const y = (event.clientY - rect.top - top) / scale;
      if (x < 0 || x > dim || y < 0 || y > dim) return;

      pointer.set((x / dim) * 2 - 1, -(y / dim) * 2 + 1);
      raycaster.setFromCamera(pointer, gizmo.camera);
      const hit = raycaster.intersectObjects(gizmo.handles)[0];
      if (!hit) return;

      event.preventDefault();
      event.stopPropagation();

      const dir = (hit.object.userData.dir as Vector3).clone();
      const distance = camera.position.distanceTo(controls.target);
      const from = camera.position.clone();
      const to = controls.target.clone().add(dir.multiplyScalar(distance));
      const start = performance.now();
      const duration = 280;
      cancelAnimationFrame(animation);
      const step = () => {
        const t = Math.min(1, (performance.now() - start) / duration);
        // Smoothstep, so the move eases in and out.
        const eased = t * t * (3 - 2 * t);
        camera.position.lerpVectors(from, to, eased);
        controls.update();
        renderFrame();
        if (t < 1) animation = requestAnimationFrame(step);
      };
      animation = requestAnimationFrame(step);
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown, true);

    refs.current = {
      renderer,
      scene,
      camera,
      controls,
      ambient,
      key,
      grid,
      shadowPlane,
      gizmo,
      model: null,
      radius: 1,
      plainMaterial,
      lineMaterial,
      sharedMaterials,
      invalidate,
    };

    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(animation);
      resize.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown, true);
      controls.removeEventListener('change', invalidate);
      controls.dispose();
      if (refs.current?.model) disposeTree(refs.current.model, sharedMaterials);
      gizmo.dispose();
      shadowPlane.geometry.dispose();
      (shadowPlane.material as Material).dispose();
      grid.geometry.dispose();
      (grid.material as Material).dispose();
      plainMaterial.dispose();
      lineMaterial.dispose();
      envTexture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      refs.current = null;
    };
  }, []);

  // Load (and reload) the mesh without touching the rest of the scene.
  useEffect(() => {
    const current = refs.current;
    if (!current || !src) return;
    let cancelled = false;
    setStatus('loading');

    new GLTFLoader()
      .loadAsync(src)
      .then((gltf) => {
        if (cancelled || !refs.current) {
          disposeTree(gltf.scene);
          return;
        }
        const live = refs.current;
        if (live.model) {
          live.scene.remove(live.model);
          disposeTree(live.model, live.sharedMaterials);
        }

        const model = gltf.scene;
        model.traverse((child) => {
          const mesh = child as Mesh;
          if (!mesh.isMesh) return;
          mesh.castShadow = true;
          // Parked here so a display-mode override can swap `.material` to the
          // shared plain surface and still restore the authored look later.
          mesh.userData.originalMaterial = mesh.material;
        });

        // Sit the mesh on y=0 and centre it on the origin so the grid and the
        // shadow catcher need no per-model offset.
        const box = new Box3().setFromObject(model);
        const size = box.getSize(new Vector3());
        const center = box.getCenter(new Vector3());
        model.position.set(-center.x, -box.min.y, -center.z);
        live.scene.add(model);
        live.model = model;

        const span = Math.max(size.x, size.y, size.z) || 1;
        live.radius = span;

        const floor = Math.max(size.x, size.z) * 3 || 3;
        live.shadowPlane.scale.set(floor, floor, 1);
        live.grid.scale.setScalar(floor);
        // Lift the grid off the shadow catcher to avoid coplanar z-fighting.
        live.grid.position.y = span * 0.001;

        const shadowCam = live.key.shadow.camera;
        shadowCam.left = -span;
        shadowCam.right = span;
        shadowCam.top = span;
        shadowCam.bottom = -span;
        shadowCam.near = 0.01;
        shadowCam.far = span * 8;
        shadowCam.updateProjectionMatrix();

        const target = new Vector3(0, size.y / 2, 0);
        live.controls.target.copy(target);
        const distance = (span / (2 * Math.tan((live.camera.fov * Math.PI) / 360))) * 1.5;
        live.camera.position.set(
          target.x + distance * 0.55,
          target.y + distance * 0.45,
          target.z + distance * 0.8,
        );
        live.camera.near = distance / 100;
        live.camera.far = distance * 100;
        live.camera.updateProjectionMatrix();
        live.controls.update();

        setStatus('ready');
        live.invalidate();
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [src]);

  // Apply inspector settings in place. Re-runs on `status` too, because the key
  // light is placed relative to the model radius, which is only known once the
  // mesh has loaded.
  useEffect(() => {
    const current = refs.current;
    if (!current) return;
    const {
      showGrid,
      transparentBg,
      keyLight,
      fillLight,
      shadowStrength,
      lightAzimuth,
      lightElevation,
      displayMode,
    } = settings;

    if (current.model) {
      applyDisplayMode(current.model, displayMode, current.plainMaterial, current.lineMaterial);
    }

    current.scene.background = transparentBg ? null : new Color(BG_COLOR);
    current.grid.visible = showGrid;
    current.key.intensity = keyLight;
    current.scene.environmentIntensity = fillLight;
    current.ambient.intensity = fillLight * 0.35;
    (current.shadowPlane.material as ShadowMaterial).opacity = shadowStrength;
    current.shadowPlane.visible = shadowStrength > 0;
    // A three.js light still casts a shadow at zero intensity, which would leave
    // a shadow with nothing appearing to cast it.
    current.key.castShadow = shadowStrength > 0 && keyLight > 0;

    const azimuth = (lightAzimuth * Math.PI) / 180;
    const elevation = (lightElevation * Math.PI) / 180;
    const distance = current.radius * 3;
    current.key.position.set(
      Math.cos(elevation) * Math.sin(azimuth) * distance,
      Math.sin(elevation) * distance,
      Math.cos(elevation) * Math.cos(azimuth) * distance,
    );

    current.invalidate();
  }, [settings, status]);

  // Exposed so BaseNode can register a capture function per node id (see
  // model3dCapture.ts) for the Preview 3D "Image" output — the backend has no
  // 3D renderer, so this browser-side snapshot is the only source of truth.
  useImperativeHandle(
    ref,
    () => ({
      captureImage: () => {
        const current = refs.current;
        const host = hostRef.current;
        if (!current || !host || !current.model || status !== 'ready') return null;
        const { renderer, scene, camera } = current;
        const width = host.clientWidth;
        const height = host.clientHeight;
        if (width < 2 || height < 2) return null;

        // Main scene only: the gizmo is a second pass drawn into the same
        // buffer by `renderFrame`, and is a navigation aid, not scene content.
        renderer.setViewport(0, 0, width, height);
        renderer.clear();
        renderer.render(scene, camera);
        const dataUrl = renderer.domElement.toDataURL('image/png');
        // Restore the on-screen gizmo overlay this pass deliberately skipped.
        current.invalidate();
        return dataUrl;
      },
    }),
    [status],
  );

  // A checkerboard behind the transparent canvas, matching how the app shows
  // transparent image previews. Without it the toggle is invisible, because the
  // opaque studio colour is nearly identical to the node body behind the canvas.
  const shellClass = settings.transparentBg
    ? 'node-preview-model node-preview-img-checker'
    : 'node-preview-model';

  return (
    <div className={shellClass}>
      <div ref={hostRef} className="node-preview-model-canvas" />
      {status !== 'ready' && (
        <div className="node-preview-model-status">
          {status === 'error' ? 'Could not load mesh' : 'Loading 3D…'}
        </div>
      )}
    </div>
  );
});

export default Model3dViewer;
