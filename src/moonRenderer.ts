import {
  AdditiveBlending,
  AmbientLight,
  CanvasTexture,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  WebGLRenderer,
} from "three";

export type MoonController = {
  setRunning: (running: boolean) => void;
  render: () => void;
  dispose: () => void;
};

// Coordinates in the 1536 × 1024 poster. CSS applies the same cover crop to both.
const WIDTH = 1536;
const HEIGHT = 1024;
const RADIUS = 332;
const TURN_SECONDS = 240;

function createCorona() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable");
  const gradient = context.createRadialGradient(256, 256, 0, 256, 256, 256);
  gradient.addColorStop(0, "rgba(255, 45, 15, 0)");
  gradient.addColorStop(0.6, "rgba(255, 45, 15, 0.02)");
  gradient.addColorStop(0.65, "rgba(255, 48, 30, 0.45)");
  gradient.addColorStop(0.675, "rgba(255, 36, 18, 0.65)");
  gradient.addColorStop(0.71, "rgba(244, 18, 8, 0.35)");
  gradient.addColorStop(0.81, "rgba(204, 8, 3, 0.13)");
  gradient.addColorStop(1, "rgba(160, 0, 0, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 512, 512);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export async function createMoonRenderer(
  canvas: HTMLCanvasElement,
): Promise<MoonController> {
  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(1);
  renderer.setSize(WIDTH, HEIGHT, false);
  renderer.setClearColor(0x000000, 0);
  const loader = new TextureLoader();
  const results = await Promise.allSettled([
    loader.loadAsync("/assets/moon-color.jpg"),
    loader.loadAsync("/assets/moon-height.jpg"),
  ]);
  if (results.some((result) => result.status === "rejected")) {
    results.forEach((result) => {
      if (result.status === "fulfilled") result.value.dispose();
    });
    renderer.dispose();
    throw new Error("Unable to load the lunar surface textures");
  }
  const [colorMap, heightMap] = results.map(
    (result) => (result as PromiseFulfilledResult<Texture>).value,
  );
  colorMap.colorSpace = SRGBColorSpace;
  colorMap.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());

  const scene = new Scene();
  const camera = new OrthographicCamera(
    -WIDTH / 2,
    WIDTH / 2,
    HEIGHT / 2,
    -HEIGHT / 2,
    1,
    3000,
  );
  camera.position.z = 1500;
  const geometry = new SphereGeometry(RADIUS, 80, 56);
  const material = new MeshStandardMaterial({
    map: colorMap,
    bumpMap: heightMap,
    bumpScale: 3.8,
    color: new Color("#dd262b"),
    emissive: new Color("#e71a16"),
    emissiveMap: colorMap,
    emissiveIntensity: 0.28,
    roughness: 1,
    metalness: 0,
  });
  const moon = new Mesh(geometry, material);
  moon.position.set(1091 - WIDTH / 2, HEIGHT / 2 - 356, 0);
  moon.rotation.set(0.08, 2.6, -0.16);
  scene.add(moon);
  scene.add(new AmbientLight("#ffd6d4", 0.85));
  const keyLight = new DirectionalLight("#ffe3dc", 3.6);
  keyLight.position.set(-600, 850, 1200);
  scene.add(keyLight);
  const rimLight = new DirectionalLight("#ff240e", 2.5);
  rimLight.position.set(800, -150, 100);
  scene.add(rimLight);

  const coronaTexture = createCorona();
  const coronaMaterial = new SpriteMaterial({
    map: coronaTexture,
    blending: AdditiveBlending,
    depthWrite: false,
    opacity: 0.75,
  });
  const corona = new Sprite(coronaMaterial);
  corona.position.copy(moon.position);
  corona.position.z = -RADIUS - 1;
  corona.scale.set(1000, 1000, 1);
  scene.add(corona);

  let disposed = false;
  let running = false;
  let previousTime: number | null = null;
  let elapsed = 0;
  const render = () => {
    if (!disposed) renderer.render(scene, camera);
  };
  const frame = (timestamp: number) => {
    if (previousTime !== null && timestamp - previousTime < 1000 / 30) return;
    const delta =
      previousTime === null
        ? 0
        : Math.min((timestamp - previousTime) / 1000, 0.1);
    previousTime = timestamp;
    elapsed += delta;
    moon.rotation.y = 2.6 + (elapsed / TURN_SECONDS) * Math.PI * 2;
    // Slow, overlapping light cycles avoid an obvious mechanical pulse.
    const breath = (1 - Math.cos((elapsed / 8) * Math.PI * 2)) / 2;
    const shimmer = (1 - Math.cos((elapsed / 13) * Math.PI * 2)) / 2;
    coronaMaterial.opacity = 0.52 + breath * 0.38 + shimmer * 0.08;
    corona.scale.setScalar(1000 + breath * 24);
    material.emissiveIntensity = 0.28 + breath * 0.12;
    render();
  };
  render();

  return {
    render,
    setRunning(next) {
      if (disposed || running === next) return;
      running = next;
      previousTime = null;
      renderer.setAnimationLoop(next ? frame : null);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      renderer.setAnimationLoop(null);
      geometry.dispose();
      material.dispose();
      coronaMaterial.dispose();
      coronaTexture.dispose();
      colorMap.dispose();
      heightMap.dispose();
      renderer.dispose();
    },
  };
}
