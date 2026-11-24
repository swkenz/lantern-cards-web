// The 3D side of Lantern Cards: arenas, Akari, monsters, companions, effects and the camera.
// A port of LcStage.cs to three.js. Unity's left-handed data was mirrored on X when exported,
// so a Unity yaw becomes axis = (-sin, 0, cos) here and "side" is cross(axis, up).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Db, Motion, Element } from './data.js';
import { bakeProjection, patchProjected, loadImage } from './projection.js';

const UP = new THREE.Vector3(0, 1, 0);
const rand = (a, b) => a + Math.random() * (b - a);
const lerp = THREE.MathUtils.lerp;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (t) => t * t * (3 - 2 * t);
const rgb = (arr, mul = 1) => new THREE.Color(arr[0] * mul, arr[1] * mul, arr[2] * mul);
const elementColor = (e, mul = 1) => rgb(Db.elementRgb[e] || [1, 1, 1], mul);
function onSphere() {
  const v = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1));
  return v.lengthSq() < 1e-6 ? new THREE.Vector3(0, 1, 0) : v.normalize();
}
function inSphere() {
  return onSphere().multiplyScalar(Math.cbrt(Math.random()));
}

// Speeds of the Unity Animator states, so timings match the original.
const HERO_SPEED = { attack1: 1.15, attack2: 1.15, attack3: 1.5, cleave: 1.25, whirlwind: 1.6, dash: 1.5, spell: 1.4, block: 1, hit: 1, knockback: 1.3, drink: 1.5, roll: 1.35, interact: 1.6 };
const CREATURE_SPEED = { attack: 1.25, hit: 1.5, jump: 1, dance: 1 };

// ---------- Canvas textures for effects ----------

function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const softTex = () => canvasTexture(64, (g, s) => {
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.75)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
});
const ringTex = () => canvasTexture(256, (g, s) => {
  const grad = g.createRadialGradient(s / 2, s / 2, s * 0.30, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.25)');
  grad.addColorStop(0.82, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
});
const crescentTex = () => canvasTexture(256, (g, s) => {
  g.translate(s / 2, s / 2);
  for (let i = 0; i < 18; i++) {
    const k = i / 17;
    g.beginPath();
    g.strokeStyle = `rgba(255,255,255,${0.06 + 0.5 * Math.sin(k * Math.PI)})`;
    g.lineWidth = 3 + 26 * Math.sin(k * Math.PI);
    g.arc(0, s * 0.12, s * 0.36, Math.PI * (1.08 + 0.02 * i), Math.PI * (1.92 - 0.02 * i));
    g.stroke();
  }
});

// ---------- Particles ----------

class Particles {
  constructor(max, texture, blending, gravity) {
    this.max = max;
    this.gravity = gravity;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.base = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture }, scale: { value: 600 } },
      vertexShader: `
        attribute float size; attribute vec4 color; varying vec4 vColor;
        uniform float scale;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map; varying vec4 vColor;
        void main() {
          vec4 t = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
          if (gl_FragColor.a < 0.004) discard;
        }`,
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  emit(p, v, color, alpha, size, life) {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.base.set([color.r, color.g, color.b, alpha], i * 4);
    this.size0[i] = size;
    this.age[i] = 0;
    this.life[i] = life;
  }

  update(dt) {
    let n = 0;
    for (let i = 0; i < this.count; i++) {
      const age = this.age[i] + dt;
      if (age >= this.life[i]) continue;
      if (n !== i) {
        this.pos.copyWithin(n * 3, i * 3, i * 3 + 3);
        this.vel.copyWithin(n * 3, i * 3, i * 3 + 3);
        this.base.copyWithin(n * 4, i * 4, i * 4 + 4);
        this.size0[n] = this.size0[i];
        this.life[n] = this.life[i];
      }
      this.age[n] = age;
      this.vel[n * 3 + 1] -= this.gravity * 9.81 * dt;
      this.pos[n * 3] += this.vel[n * 3] * dt;
      this.pos[n * 3 + 1] += this.vel[n * 3 + 1] * dt;
      this.pos[n * 3 + 2] += this.vel[n * 3 + 2] * dt;
      const k = age / this.life[n];
      // Unity: size over lifetime eases from 1 to 0.05.
      this.size[n] = this.size0[n] * lerp(1, 0.05, smooth(k));
      this.col[n * 4] = this.base[n * 4];
      this.col[n * 4 + 1] = this.base[n * 4 + 1];
      this.col[n * 4 + 2] = this.base[n * 4 + 2];
      this.col[n * 4 + 3] = this.base[n * 4 + 3] * (k < 0.1 ? k / 0.1 : 1);
      n++;
    }
    this.count = n;
    const g = this.points.geometry;
    g.setDrawRange(0, n);
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
  }

  clear() {
    this.count = 0;
  }
}

// ---------- Toon look ----------

const gradientMap = (() => {
  // Light, slightly violet shadows like Unity's AnimeCharacter shader (_ShadowTint 0.78, 0.68, 0.86).
  const data = new Uint8Array([199, 173, 219, 255, 222, 205, 235, 255, 248, 244, 250, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(data, 4, 1);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();

/** A cel-shaded material with rim light and a hit flash, like the AnimeCharacter shader in Unity. */
function toonFrom(src, rimColor, rimStrength, projected = null) {
  const m = new THREE.MeshToonMaterial({
    color: src.color ? src.color.clone() : new THREE.Color(1, 1, 1),
    map: src.map || null,
    gradientMap,
    transparent: src.transparent,
    alphaTest: src.alphaTest,
    side: src.side,
  });
  if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
  m.userData.rim = { value: new THREE.Color(rimColor) };
  m.userData.rimStrength = { value: rimStrength };
  m.userData.flash = { value: 0 };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = m.userData.rim;
    shader.uniforms.uRimStrength = m.userData.rimStrength;
    shader.uniforms.uFlash = m.userData.flash;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim; uniform float uRimStrength; uniform float uFlash;')
      .replace('#include <opaque_fragment>', `
        float rimK = pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), 4.0);
        outgoingLight += uRim * rimK * uRimStrength;
        outgoingLight = mix(outgoingLight, vec3(1.0, 0.95, 1.0), uFlash);
        #include <opaque_fragment>`);
    if (projected) patchProjected(shader, projected);
  };
  m.customProgramCacheKey = () => (projected ? 'lc-toon-proj' : 'lc-toon');
  return m;
}

/** Inverted-hull outline in screen space, so it has the same width at any model scale. */
function outlineMaterial(color, width) {
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uOutline = { value: width };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uOutline;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        {
          #ifdef USE_SKINNING
            vec3 on = objectNormal;
          #else
            vec3 on = normal;
          #endif
          vec3 vn = normalize(normalMatrix * on);
          vec2 dir = (projectionMatrix * vec4(vn, 0.0)).xy;
          float len = length(dir);
          if (len > 1e-5) gl_Position.xy += dir / len * uOutline * gl_Position.w;
        }`);
  };
  m.customProgramCacheKey = () => 'lc-outline';
  return m;
}

function stylizeCharacter(root, { rim = 0xfff2d9, rimStrength = 0.4, outline = 0x331f42, width = 0.0028 } = {}) {
  const materials = [];
  const meshes = [];
  root.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const o of meshes) {
    o.castShadow = true;
    o.receiveShadow = true;
    o.frustumCulled = false;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    const toon = list.map((src) => toonFrom(src, rim, rimStrength, o.userData.projected || null));
    materials.push(...toon);
    o.material = Array.isArray(o.material) ? toon : toon[0];
    const hullMat = outlineMaterial(outline, width);
    let hull;
    if (o.isSkinnedMesh) {
      hull = new THREE.SkinnedMesh(o.geometry, hullMat);
      hull.bind(o.skeleton, o.bindMatrix);
    } else hull = new THREE.Mesh(o.geometry, hullMat);
    hull.position.copy(o.position);
    hull.quaternion.copy(o.quaternion);
    hull.scale.copy(o.scale);
    hull.frustumCulled = false;
    hull.castShadow = false;
    o.parent.add(hull);
  }
  return materials;
}

/** World meshes: cheap Lambert shading, keeping textures, vertex colours and alpha cut-outs. */
function stylizeWorld(root) {
  const lights = [];
  root.traverse((o) => {
    if (o.userData && o.userData.light === 'point') lights.push(o);
    if (!o.isMesh) return;
    o.receiveShadow = true;
    o.castShadow = !/Ground|Decor_|Grass|Flower/i.test(o.name);
    const convert = (src) => {
      const name = (src.name || '').toLowerCase();
      const emissive = src.emissive && (src.emissive.r + src.emissive.g + src.emissive.b) > 0.01;
      const m = new THREE.MeshLambertMaterial({
        color: src.color.clone(),
        map: src.map || null,
        vertexColors: src.vertexColors,
        alphaTest: src.alphaTest || (/leaves|flower|grass|leaf/.test(name) ? 0.5 : 0),
        transparent: src.transparent,
        side: /leaves|flower|grass|leaf|paper|cloth|banner/.test(name) ? THREE.DoubleSide : src.side,
      });
      if (emissive || /flame|paperlit/.test(name)) {
        m.emissive = emissive ? src.emissive.clone() : new THREE.Color(1, 0.7, 0.35);
        m.emissiveIntensity = (src.userData && src.userData.emissiveStrength) || 2.2;
        m.emissiveMap = src.emissiveMap || src.map || null;
      }
      return m;
    };
    o.material = Array.isArray(o.material) ? o.material.map(convert) : convert(o.material);
  });
  return lights;
}

// ---------- Actors ----------

class Actor {
  constructor(gltf, base, speeds, style) {
    this.root = SkeletonUtils.clone(gltf.scene);
    this.materials = stylizeCharacter(this.root, style);
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = {};
    this.speeds = speeds;
    for (const clip of gltf.animations) this.actions[clip.name] = this.mixer.clipAction(clip);
    this.base = base;
    this.current = null;
    this.mixer.addEventListener('finished', (e) => {
      if (e.action === this.current && this.returnTo) this.play(this.returnTo, 0.15);
    });
    this.play(base, 0);
  }

  has(name) {
    return !!this.actions[name];
  }

  /** Loops (idle, run, dance) keep going; one-shots return to the base state or hold their last frame. */
  play(name, fade = 0.15, { once = false, hold = false, speed } = {}) {
    const action = this.actions[name];
    if (!action) return;
    action.reset();
    action.enabled = true;
    action.setEffectiveTimeScale(speed ?? this.speeds[name] ?? 1);
    action.setEffectiveWeight(1);
    if (once || hold) {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    } else action.setLoop(THREE.LoopRepeat, Infinity);
    this.returnTo = once && !hold ? this.base : null;
    if (this.current && this.current !== action && fade > 0) action.crossFadeFrom(this.current, fade, false);
    else if (this.current && this.current !== action) this.current.stop();
    action.play();
    this.current = action;
  }

  setBase(name, fade = 0.2) {
    this.base = name;
    this.play(name, fade);
  }

  setFlash(v, rim) {
    for (const m of this.materials) {
      m.userData.flash.value = v;
      if (rim) {
        m.userData.rim.value.copy(rim.color);
        m.userData.rimStrength.value = rim.strength;
      }
    }
  }
}

// ---------- Stage ----------

export class Stage {
  static fast = false;

  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.12, 500);
    this.baseFov = 58;
    this.fovKick = 0;
    this.shakeAmount = 0;
    this.timeScale = 1;
    this.clock = new THREE.Clock();
    this.loader = new GLTFLoader();
    this.cache = new Map();
    this.timers = [];
    this.ticks = [];
    this.tweens = [];
    this.fades = [];
    this.view = 0;
    this.orbit = 0;

    this.hemi = new THREE.HemisphereLight(0xcfe6ff, 0x8a7a5a, 1.15);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 1.9);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -14;
    sc.right = sc.top = 14;
    sc.near = 1;
    sc.far = 80;
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.scene.fog = new THREE.Fog(0xcfe0f0, 70, 260);
    this.sky = this.makeSky();
    this.scene.add(this.sky);

    this.sparks = new Particles(2500, softTex(), THREE.AdditiveBlending, 0.4);
    this.mist = new Particles(900, softTex(), THREE.NormalBlending, -0.05);
    this.ambient = new Particles(700, softTex(), THREE.NormalBlending, 0);
    this.scene.add(this.sparks.points, this.mist.points, this.ambient.points);
    this.ringTexture = ringTex();
    this.crescentTexture = crescentTex();
    this.sphereGeo = new THREE.SphereGeometry(0.5, 32, 16);
    this.planeGeo = new THREE.PlaneGeometry(1, 1);

    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.arenaName = null;
    this.arena = null;
    this.ground = null;
    this.raycaster = new THREE.Raycaster();

    this.axis = new THREE.Vector3(0, 0, 1);
    this.side = new THREE.Vector3(1, 0, 0);
    this.heroHome = new THREE.Vector3();
    this.enemyHome = new THREE.Vector3();
    this.companionHome = new THREE.Vector3();
    this.camPos = new THREE.Vector3(0, 3, 8);
    this.camLook = new THREE.Vector3(0, 1, 0);
    this.lookNow = new THREE.Vector3(0, 1, 0);
    this.enemyHeight = 1.3;
    this.enemy = null;
    this.companion = null;
    this.enemyFlash = 0;
    this.glow = 1.2;
    this.alternate = false;

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1280, 720), 0.5, 0.4, 1.05);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  makeSky() {
    const geo = new THREE.SphereGeometry(300, 32, 16);
    this.skyUniforms = {
      top: { value: new THREE.Color(0x3d8ff0) },
      horizon: { value: new THREE.Color(0xe3eefa) },
      bottom: { value: new THREE.Color(0xd9e6c8) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vDir;
        void main(){ float h = vDir.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(clamp(h,0.0,1.0), 0.55)) : mix(horizon, bottom, clamp(-h*4.0,0.0,1.0));
        gl_FragColor = vec4(c, 1.0); }`,
    });
    const sky = new THREE.Mesh(geo, mat);
    sky.renderOrder = -10;
    return sky;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------- Loading ----------

  load(url) {
    if (!this.cache.has(url)) this.cache.set(url, this.loader.loadAsync(url));
    return this.cache.get(url);
  }

  async init(onProgress) {
    const steps = ['assets/models/akari.glb', 'assets/models/arenas/home.glb'];
    let done = 0;
    const tick = () => onProgress?.(++done / steps.length);
    const [hero] = await Promise.all(steps.map((u) => this.load(u).then((g) => { tick(); return g; })));
    this.hero = new Actor(hero, 'idle', HERO_SPEED, { rim: 0xfff4e0, rimStrength: 0.35, width: 0.0022 });
    this.scene.add(this.hero.root);
    this.loop();
    // Warm the other arenas in the background.
    for (const n of ['act1', 'act2', 'act3']) this.load(`assets/models/arenas/${n}.glb`).catch(() => {});
  }

  creatureUrl(model) {
    return `assets/models/creatures/${model.toLowerCase()}.glb`;
  }

  /**
   * A heroine's 3D model (from Meshy), if one has been added to assets/models/heroines.
   * Static sculpts: normalized to 1.75 m, feet on the ground, facing +Z. Resolves null when missing.
   */
  async heroineModel(id, element = Element.Light) {
    this.heroineCache ??= new Map();
    const tint = new THREE.Color(0xf6f0ea).lerp(elementColor(element), 0.22);
    if (Stage.fast) return null;
    if (!this.heroineCache.has(id)) {
      const fbx = async () => {
        this.fbxLoader ??= new (await import('three/addons/loaders/FBXLoader.js')).FBXLoader();
        return { scene: await this.fbxLoader.loadAsync(`assets/models/heroines/${id}.fbx`) };
      };
      this.heroineCache.set(id, this.load(`assets/models/heroines/${id}.glb`).catch(fbx).then(async (gltf) => {
        const model = gltf.scene;
        model.traverse((o) => {
          if (!o.isMesh) return;
          // Untextured sculpts become porcelain spirits tinted by their element.
          const list = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of list) if (!m.map) m.color = tint.clone();
        });
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const scale = 1.75 / Math.max(0.01, size.y);
        const holder = new THREE.Group();
        model.scale.setScalar(scale);
        const center = box.getCenter(new THREE.Vector3());
        model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
        holder.add(model);
        // Colour the sculpt with its own picture when one exists (see projection.js).
        const settings = (this.projectionSettings ??= await fetch('assets/models/heroines/projection.json').then((r) => r.json()).catch(() => ({})));
        const picture = await loadImage(`assets/art/heroines3d/${id}.jpg`).catch(() => null);
        let rimStrength = 0.9;
        if (picture) {
          const params = settings[id] || { rect: [0, 0, picture.width, picture.height], front: 1 };
          const textures = bakeProjection(holder, picture, params, this.renderer);
          holder.traverse((o) => {
            if (!o.isMesh) return;
            o.userData.projected = textures;
            const list = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of list) m.color = new THREE.Color(1, 1, 1);
          });
          rimStrength = 0.45;
        }
        stylizeCharacter(holder, { rim: elementColor(element).getHex(), rimStrength, width: 0.0022 });
        return holder;
      }).catch(() => null));
    }
    const template = await this.heroineCache.get(id);
    return template ? template.clone(true) : null;
  }

  clearAllies() {
    for (const a of this.allies || []) this.scene.remove(a.root);
    this.allies = [];
  }

  /** Team heroines stand behind Akari during battles (only those that have a 3D model). */
  async placeAllies(team) {
    this.clearAllies();
    // [along the battle axis, toward the camera]: just behind Akari and further from the camera, so all stay in frame.
    const slots = [[-0.9, -1.7], [-2.0, -0.8], [-0.2, -3.0]];
    let i = 0;
    for (const heroine of team) {
      const root = await this.heroineModel(heroine.id, heroine.element);
      if (!root || i >= slots.length) continue;
      const [back, across] = slots[i++];
      const home = this.grounded(this.heroHome.clone().addScaledVector(this.axis, back).addScaledVector(this.side, across));
      root.position.copy(home);
      this.face(root, this.axis);
      this.scene.add(root);
      this.allies.push({ id: heroine.id, root, home, phase: Math.random() * 6 });
    }
  }

  preloadCreature(model) {
    return this.load(this.creatureUrl(model));
  }

  async setArena(name) {
    if (this.arenaName === name) return;
    this.arenaName = name;
    const gltf = await this.load(`assets/models/arenas/${name}.glb`);
    if (this.arenaName !== name) return;
    if (this.arena) this.world.remove(this.arena);
    if (!gltf.userData.styled) {
      gltf.userData.lights = stylizeWorld(gltf.scene);
      gltf.userData.styled = true;
      for (const l of gltf.userData.lights) {
        const p = new THREE.PointLight(rgb(l.userData.color || [1, 0.7, 0.4]), (l.userData.intensity || 1) * 6, (l.userData.range || 8) * 1.2, 1.6);
        l.add(p);
      }
    }
    this.arena = gltf.scene;
    this.world.add(this.arena);
    this.ground = this.arena.getObjectByName('Ground');
    const x = gltf.scene.userData || {};
    const ex = gltf.parser?.json?.scenes?.[0]?.extras || x;
    if (ex.fogColor) {
      const fog = rgb(ex.fogColor);
      this.scene.fog.color.copy(fog);
      this.skyUniforms.horizon.value.copy(fog);
    }
    if (ex.skyColor) this.hemi.color.copy(rgb(ex.skyColor));
    if (ex.groundColor) {
      this.hemi.groundColor.copy(rgb(ex.groundColor));
      this.skyUniforms.bottom.value.copy(rgb(ex.groundColor)).lerp(this.scene.fog.color, 0.5);
    }
    if (ex.sunDirection) {
      this.sunDir = new THREE.Vector3(...ex.sunDirection).normalize();
      if (ex.sunColor) this.sun.color.copy(rgb(ex.sunColor));
      this.sun.intensity = (ex.sunIntensity || 1.5) * 1.25;
    }
  }

  groundAt(x, z) {
    if (!this.ground) return 0;
    this.raycaster.set(new THREE.Vector3(x, 60, z), new THREE.Vector3(0, -1, 0));
    const hit = this.raycaster.intersectObject(this.ground, false)[0];
    return hit ? hit.point.y : 0;
  }

  grounded(v) {
    v.y = this.groundAt(v.x, v.z);
    return v;
  }

  // ---------- Timing helpers (scaled by hit-stop, skipped in fast mode) ----------

  wait(seconds) {
    if (Stage.fast || seconds <= 0) return Promise.resolve();
    return new Promise((resolve) => this.timers.push({ left: seconds, resolve }));
  }

  tween(obj, to, seconds, ease = smooth) {
    if (Stage.fast) {
      obj.position.copy(to);
      return Promise.resolve();
    }
    return new Promise((resolve) => this.tweens.push({ obj, from: obj.position.clone(), to: to.clone(), t: 0, seconds, ease, resolve }));
  }

  // ---------- Placement and views ----------

  placeArena(act) {
    const yaw = THREE.MathUtils.degToRad(act.yaw);
    this.axis.set(-Math.sin(yaw), 0, Math.cos(yaw));
    this.side.crossVectors(this.axis, UP);
    this.heroHome = this.grounded(this.axis.clone().multiplyScalar(-3.2));
    this.enemyHome = this.grounded(this.axis.clone().multiplyScalar(3.4));
    this.companionHome = this.grounded(this.axis.clone().multiplyScalar(-4.6).addScaledVector(this.side, 1.3));
    this.placeHero(this.heroHome, this.axis);
  }

  face(obj, dir) {
    obj.rotation.set(0, Math.atan2(dir.x, dir.z), 0);
  }

  placeHero(pos, dir) {
    this.hero.root.position.copy(pos);
    this.face(this.hero.root, dir);
  }

  clearActors() {
    this.clearAllies();
    if (this.enemy) this.scene.remove(this.enemy.root);
    if (this.companion) this.scene.remove(this.companion.root);
    this.enemy = null;
    this.companion = null;
    this.enemyFlash = 0;
    this.sparks.clear();
    this.mist.clear();
  }

  async showHome() {
    this.clearActors();
    await this.setArena('home');
    const facing = new THREE.Vector3(Math.sin(THREE.MathUtils.degToRad(-200)), 0, Math.cos(THREE.MathUtils.degToRad(-200)));
    // Unity Euler(0,200,0) forward is (sin200, 0, cos200); mirrored on X.
    facing.set(-Math.sin(THREE.MathUtils.degToRad(200)), 0, Math.cos(THREE.MathUtils.degToRad(200)));
    const spot = this.grounded(new THREE.Vector3(0, 0, 0));
    this.placeHero(spot, facing);
    this.hero.setBase('idle', 0.2);
    this.view = 0;
    const right = new THREE.Vector3().crossVectors(facing, UP);
    this.camPos.copy(spot).addScaledVector(facing, 3.6).addScaledVector(UP, 1.55).addScaledVector(right, 1.3);
    this.camLook.copy(spot).addScaledVector(UP, 1.15).addScaledVector(right, 1.25);
    this.snap();
  }

  async showGacha() {
    await this.showHome();
    this.hero.setBase('dance', 0.2);
  }

  async showMap(act) {
    this.clearActors();
    await this.setArena(act.arenaKey);
    this.placeArena(act);
    this.hero.setBase('idle', 0.2);
    this.view = 1;
    this.orbit = 0;
  }

  async beginBattle(act, enemyDef, companionDef, team = []) {
    this.clearActors();
    await this.setArena(act.arenaKey);
    this.placeArena(act);
    this.hero.setBase('combat_idle', 0.15);
    this.enemyHeight = enemyDef.height;
    const gltf = await this.preloadCreature(enemyDef.model);
    this.enemy = new Actor(gltf, 'idle', CREATURE_SPEED, { rim: 0xc76bff, rimStrength: 1.0, width: 0.0032 });
    this.enemy.root.scale.setScalar(enemyDef.height);
    this.enemy.root.position.copy(this.enemyHome);
    this.face(this.enemy.root, this.axis.clone().negate());
    this.scene.add(this.enemy.root);
    this.glow = enemyDef.boss ? 1.9 : enemyDef.elite ? 1.5 : 1.2;
    this.enemy.setFlash(0, { color: new THREE.Color(0.78, 0.42, 1), strength: this.glow });
    if (companionDef) {
      const cg = await this.preloadCreature(companionDef.model).catch(() => null);
      if (cg) {
        this.companion = new Actor(cg, 'idle', CREATURE_SPEED, { rim: 0xfff2d9, rimStrength: 0.4, width: 0.0026 });
        this.companion.root.scale.setScalar(0.62);
        this.companion.root.position.copy(this.companionHome);
        this.face(this.companion.root, this.axis);
        this.scene.add(this.companion.root);
      }
    }
    await this.placeAllies(team);
    this.view = 2;
    this.shockwave(this.enemyHome, 3 + enemyDef.height, new THREE.Color(0.7, 0.4, 1));
    this.snap();
  }

  /** A heroine with a 3D model dashes in, strikes, and returns to her place. */
  async allyStrike(id, element, attack = true) {
    const ally = (this.allies || []).find((a) => a.id === id);
    if (!ally || Stage.fast) return false;
    const color = elementColor(element);
    if (!attack) {
      // Support cards: she rises in a pillar of light and sends it to Akari.
      ally.busy = true;
      this.column(ally.root.position.clone(), color);
      await this.tween(ally.root, ally.home.clone().addScaledVector(UP, 0.5), 0.18, (t) => Math.sin(t * Math.PI / 2));
      await this.projectile(ally.root.position.clone().addScaledVector(UP, 1.2), this.heroChest, color, 0.3);
      this.bubble(this.heroChest, color, 1.1);
      this.burst(this.heroChest, color, 30, 3);
      await this.tween(ally.root, ally.home, 0.2);
      ally.busy = false;
      return true;
    }
    const strike = this.grounded(this.enemyHome.clone().addScaledVector(this.axis, -(1.1 + this.enemyHeight * 0.35)).addScaledVector(this.side, 0.6));
    ally.busy = true;
    this.column(ally.root.position.clone(), color);
    const trail = this.ticks.push((dt) => {
      if (!ally.busy) return true;
      this.sparks.emit(ally.root.position.clone().addScaledVector(UP, rand(0.2, 1.6)), inSphere().multiplyScalar(0.5), color.clone().multiplyScalar(1.5), 0.9, rand(0.12, 0.25), 0.35);
      return false;
    });
    void trail;
    await this.tween(ally.root, strike, 0.18);
    this.face(ally.root, this.axis);
    ally.root.rotation.z = 0;
    this.slashArc(this.enemyChest, color);
    this.slashArc(this.enemyChest, color.clone().lerp(new THREE.Color(1, 1, 1), 0.4));
    this.column(this.enemyHome, color);
    this.shockwave(this.enemyHome, 4 + this.enemyHeight, color);
    this.burst(this.enemyChest, color, 60, 10);
    this.shake(0.5);
    await this.wait(0.22);
    // Return a moment later, without holding up the rest of the turn.
    this.wait(0.35).then(async () => {
      await this.tween(ally.root, ally.home, 0.3);
      this.face(ally.root, this.axis);
      ally.busy = false;
    });
    return true;
  }

  get enemyChest() {
    return this.enemy ? this.enemy.root.position.clone().addScaledVector(UP, this.enemyHeight * 0.55) : this.enemyHome.clone();
  }

  get heroChest() {
    return this.hero.root.position.clone().addScaledVector(UP, 1.05);
  }

  get enemyTop() {
    return this.enemyHome.clone().addScaledVector(UP, this.enemyHeight + 0.35);
  }

  // ---------- Camera ----------

  updateCameraTarget(dt) {
    if (this.view === 1) {
      this.orbit += dt * 4;
      const mid = this.heroHome.clone().add(this.enemyHome).multiplyScalar(0.5);
      const offset = this.axis.clone().multiplyScalar(-12).addScaledVector(this.side, 6).applyAxisAngle(UP, THREE.MathUtils.degToRad(-this.orbit));
      this.camPos.copy(mid).add(offset).addScaledVector(UP, 9);
      this.camLook.copy(mid).addScaledVector(UP, 1);
    } else if (this.view === 2) {
      const reach = Math.max(0, this.enemyHeight - 1.6);
      const mid = this.heroHome.clone().add(this.enemyHome).multiplyScalar(0.5);
      // Akari on the left, the enemy on the right.
      this.camPos.copy(mid).addScaledVector(this.side, 7.4 + reach * 1.3).addScaledVector(this.axis, -1.4).addScaledVector(UP, 2.5 + reach * 0.55);
      this.camLook.copy(mid).addScaledVector(UP, 0.35 + reach * 0.35);
    }
  }

  snap() {
    this.updateCameraTarget(0);
    this.camera.position.copy(this.camPos);
    this.lookNow.copy(this.camLook);
    this.camera.lookAt(this.lookNow);
  }

  shake(amount) {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
  }

  async hitStop(seconds) {
    if (this.timeScale < 0.5) return;
    this.timeScale = 0.05;
    await new Promise((r) => setTimeout(r, seconds * 1000));
    this.timeScale = 1;
  }

  /** Screen position (CSS pixels) of a world point, for floating numbers. */
  toScreen(p) {
    const v = p.clone().project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight, visible: v.z < 1 };
  }

  // ---------- Frame loop ----------

  loop() {
    const frame = () => {
      requestAnimationFrame(frame);
      const real = Math.min(this.clock.getDelta(), 0.1);
      const dt = real * this.timeScale;
      this.update(dt, real);
      this.composer.render();
    };
    frame();
  }

  update(dt, real) {
    for (const actor of [this.hero, this.enemy, this.companion]) actor?.mixer.update(dt);
    // Allies breathe: a gentle bob and sway while waiting.
    if (this.allies) {
      const t = performance.now() / 1000;
      for (const a of this.allies) {
        if (a.busy) continue;
        a.root.position.y = a.home.y + Math.sin(t * 1.6 + a.phase) * 0.02;
        a.root.rotation.z = Math.sin(t * 0.9 + a.phase) * 0.012;
      }
    }
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      t.left -= dt;
      if (t.left <= 0) {
        this.timers.splice(i, 1);
        t.resolve();
      }
    }
    for (let i = this.ticks.length - 1; i >= 0; i--) if (this.ticks[i](dt)) this.ticks.splice(i, 1);
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const t = this.tweens[i];
      t.t += dt;
      const k = clamp01(t.t / t.seconds);
      t.obj.position.lerpVectors(t.from, t.to, t.ease(k));
      if (k >= 1) {
        this.tweens.splice(i, 1);
        t.resolve();
      }
    }
    for (let i = this.fades.length - 1; i >= 0; i--) {
      const f = this.fades[i];
      f.t += dt;
      const k = f.t / f.life;
      if (k >= 1) {
        this.scene.remove(f.mesh);
        f.mesh.material.dispose();
        this.fades.splice(i, 1);
        continue;
      }
      f.update(f.mesh, k);
      if (f.faceCamera) f.mesh.quaternion.copy(this.camera.quaternion).multiply(f.roll);
      f.mesh.material.opacity = f.alpha * (1 - k);
    }

    // Camera: smooth follow, shake and the hit "FOV kick".
    this.updateCameraTarget(real);
    const follow = 1 - Math.exp(-real / 0.18);
    this.camera.position.lerp(this.camPos, follow);
    this.lookNow.lerp(this.camLook, 1 - Math.exp(-real / 0.12));
    if (this.shakeAmount > 0) {
      this.camera.position.addScaledVector(inSphere(), this.shakeAmount * 0.12);
      this.shakeAmount = Math.max(0, this.shakeAmount - real * 2.5);
    }
    this.camera.lookAt(this.lookNow);
    this.fovKick = Math.max(0, this.fovKick - real * 30);
    const fov = this.baseFov - this.fovKick;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.sky.position.copy(this.camera.position);
    const sunDir = this.sunDir || new THREE.Vector3(-0.4, -0.8, 0.45).normalize();
    this.sun.target.position.copy(this.camLook);
    this.sun.position.copy(this.camLook).addScaledVector(sunDir, -40);

    if (this.enemy && this.enemyFlash > 0) {
      this.enemyFlash = Math.max(0, this.enemyFlash - real * 4);
      this.enemy.setFlash(this.enemyFlash * 0.75, { color: new THREE.Color(0.78, 0.42, 1), strength: 1.4 });
    }

    // Drifting petals and lantern motes; purple wisps rise off the possessed enemy.
    if (!Stage.fast && Math.random() < 0.6) {
      const p = this.camLook.clone().add(new THREE.Vector3(rand(-12, 12), rand(0, 7), rand(-12, 12)));
      const petal = Math.random() < 0.6;
      this.ambient.emit(p, new THREE.Vector3(rand(0.2, 1), rand(-0.6, -0.2), rand(-0.4, 0.4)),
        petal ? new THREE.Color(1, 0.75, 0.86) : new THREE.Color(1, 0.88, 0.55), petal ? 0.9 : 0.85, rand(0.06, 0.14), rand(4, 7));
    }
    if (this.enemy && !Stage.fast && Math.random() < 0.25) {
      this.mistAt(this.enemy.root.position.clone().addScaledVector(UP, this.enemyHeight * rand(0.1, 0.8)), 1, 0.35);
    }
    this.sparks.update(dt);
    this.mist.update(dt);
    this.ambient.update(dt);
  }

  // ---------- Effects ----------

  burst(at, color, count, speed) {
    if (Stage.fast) return;
    for (let i = 0; i < count; i++) {
      const v = onSphere().multiplyScalar(speed * rand(0.3, 1)).add(UP);
      this.sparks.emit(at.clone().add(inSphere().multiplyScalar(0.25)), v, color.clone().multiplyScalar(rand(1.1, 1.8)), 1, rand(0.05, 0.18), rand(0.35, 0.9));
    }
  }

  mistAt(at, count, speed) {
    if (Stage.fast) return;
    for (let i = 0; i < count; i++) {
      const v = onSphere().multiplyScalar(rand(0.2, speed)).addScaledVector(UP, 0.5);
      this.mist.emit(at.clone().add(inSphere().multiplyScalar(0.4)), v, new THREE.Color(0.62, 0.38, 1), 0.5, rand(0.3, 0.8), rand(0.6, 1.4));
    }
  }

  fade(mesh, life, update, { faceCamera = false, roll = 0 } = {}) {
    if (Stage.fast) return;
    this.scene.add(mesh);
    this.fades.push({ mesh, life, update, t: 0, alpha: mesh.material.opacity, faceCamera, roll: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll) });
  }

  glowMaterial(color, alpha, map, blending = THREE.AdditiveBlending) {
    return new THREE.MeshBasicMaterial({ color, map: map || null, transparent: true, opacity: alpha, depthWrite: false, blending, side: THREE.DoubleSide, fog: false });
  }

  shockwave(center, radius, color) {
    const mesh = new THREE.Mesh(this.planeGeo, this.glowMaterial(color.clone().multiplyScalar(1.6), 1, this.ringTexture));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(center);
    mesh.position.y = this.groundAt(center.x, center.z) + 0.12;
    this.fade(mesh, 0.45, (m, t) => m.scale.setScalar(radius * 2 * (1 - (1 - t) * (1 - t))));
  }

  slashArc(at, color) {
    const mesh = new THREE.Mesh(this.planeGeo, this.glowMaterial(color.clone().multiplyScalar(2.4), 1, this.crescentTexture));
    mesh.position.copy(at);
    this.fade(mesh, 0.25, (m, t) => m.scale.set(2.6 * (0.7 + t * 0.5), 1.6 * (0.7 + t * 0.5), 1), { faceCamera: true, roll: THREE.MathUtils.degToRad(rand(-50, 50)) });
  }

  bubble(at, color, size = 1) {
    const mesh = new THREE.Mesh(this.sphereGeo, this.glowMaterial(color.clone().multiplyScalar(1.6), 0.35));
    mesh.position.copy(at);
    this.fade(mesh, 0.5, (m, t) => m.scale.setScalar((1.6 + t * 0.5) * size));
  }

  column(at, color) {
    const mesh = new THREE.Mesh(this.sphereGeo, this.glowMaterial(color.clone().multiplyScalar(2), 1));
    mesh.position.copy(at).addScaledVector(UP, 3);
    this.fade(mesh, 0.6, (m, t) => m.scale.set(Math.sin(t * Math.PI) * 1.4, 7, Math.sin(t * Math.PI) * 1.4));
    this.burst(at.clone().add(UP), color, 30, 4);
  }

  async projectile(from, to, color, time) {
    if (Stage.fast) return;
    const orb = new THREE.Mesh(this.sphereGeo, this.glowMaterial(color.clone().multiplyScalar(2.6), 1));
    orb.scale.setScalar(0.45);
    this.scene.add(orb);
    await new Promise((resolve) => {
      let t = 0;
      this.ticks.push((dt) => {
        t += dt;
        const k = clamp01(t / time);
        orb.position.lerpVectors(from, to, k).addScaledVector(UP, Math.sin(k * Math.PI) * 0.8);
        this.sparks.emit(orb.position.clone(), inSphere().multiplyScalar(0.4), color.clone().multiplyScalar(1.4), 0.8, 0.22, 0.25);
        if (k >= 1) {
          resolve();
          return true;
        }
        return false;
      });
    });
    this.scene.remove(orb);
    orb.material.dispose();
    this.burst(to, color, 20, 6);
  }

  // ---------- Hero actions ----------

  melee(motion) {
    return motion === Motion.Slash || motion === Motion.Heavy || motion === Motion.Spin || motion === Motion.Dash;
  }

  async moveHero(target, seconds) {
    const dir = target.clone().sub(this.hero.root.position);
    dir.y = 0;
    if (dir.lengthSq() > 0.01) this.face(this.hero.root, dir);
    this.hero.play('run', 0.08);
    await this.tween(this.hero.root, target, seconds);
  }

  /** Plays the start of a card: moves in and swings, or casts. Resolves at the moment of impact. */
  async heroAct(motion, element, heroineId = null, attack = true) {
    const color = elementColor(element);
    if (motion === Motion.Heroine && heroineId && this.allies?.some((a) => a.id === heroineId)) {
      this.hero.play('spell', 0.08, { once: true });
      await this.allyStrike(heroineId, element, attack);
      return;
    }
    if (this.melee(motion)) {
      const strike = this.grounded(this.enemyHome.clone().addScaledVector(this.axis, -(0.9 + this.enemyHeight * 0.35)));
      await this.moveHero(strike, motion === Motion.Dash ? 0.12 : 0.2);
      this.face(this.hero.root, this.axis);
      this.alternate = !this.alternate;
      const state = motion === Motion.Heavy ? 'cleave' : motion === Motion.Spin ? 'whirlwind' : motion === Motion.Dash ? 'dash' : this.alternate ? 'attack1' : 'attack2';
      this.hero.play(state, 0.06, { once: true });
      await this.wait(motion === Motion.Heavy ? 0.38 : motion === Motion.Spin ? 0.3 : 0.2);
      this.slashArc(this.enemyChest, color);
      this.burst(this.enemyChest, color, 18, 6);
    } else if (motion === Motion.Spell) {
      this.hero.play('spell', 0.06, { once: true });
      await this.wait(0.22);
      await this.projectile(this.heroChest.addScaledVector(this.axis, 0.5), this.enemyChest, color, 0.32);
    } else if (motion === Motion.Guard) {
      this.hero.play('block', 0.06, { once: true });
      this.bubble(this.heroChest, new THREE.Color(0.45, 0.75, 1));
      await this.wait(0.25);
    } else if (motion === Motion.Drink) {
      this.hero.play('drink', 0.08, { once: true });
      await this.wait(0.35);
      this.burst(this.heroChest, new THREE.Color(0.5, 1, 0.65), 30, 3);
    } else if (motion === Motion.Heroine) {
      // A teammate's strike falls from the sky onto the enemy while Akari raises her hand.
      this.hero.play('spell', 0.08, { once: true });
      await this.wait(0.15);
      this.column(this.enemyHome, color);
      this.shockwave(this.enemyHome, 4 + this.enemyHeight, color);
      this.burst(this.enemyChest, color, 50, 9);
      this.shake(0.45);
      await this.wait(0.2);
    } else {
      this.hero.play('spell', 0.08, { once: true });
      this.column(this.heroHome, color);
      await this.wait(0.35);
    }
  }

  /** Element-flavoured impact: embers, splashes, leaves, light or shadow. */
  elementImpact(at, element, big) {
    if (Stage.fast) return;
    const count = big ? 40 : 22;
    switch (element) {
      case Element.Fire:
        for (let i = 0; i < count; i++) {
          const c = new THREE.Color(1, 0.85, 0.3).lerp(new THREE.Color(1, 0.3, 0.1), Math.random()).multiplyScalar(1.6);
          this.sparks.emit(at.clone().add(inSphere().multiplyScalar(0.3)), new THREE.Vector3(rand(-2.5, 2.5), rand(3, 7), rand(-2.5, 2.5)), c, 1, rand(0.08, 0.22), rand(0.5, 1.1));
        }
        this.shockwave(this.enemyHome, 2.2 + this.enemyHeight * 0.5, new THREE.Color(1, 0.45, 0.2));
        break;
      case Element.Water:
        for (let i = 0; i < count; i++) {
          const a = Math.random() * Math.PI * 2;
          const c = new THREE.Color(0.55, 0.85, 1).lerp(new THREE.Color(1, 1, 1), Math.random() * 0.4).multiplyScalar(1.4);
          this.sparks.emit(at.clone().add(inSphere().multiplyScalar(0.2)), new THREE.Vector3(Math.cos(a) * rand(3, 6), rand(2, 5), Math.sin(a) * rand(3, 6)), c, 1, rand(0.06, 0.16), rand(0.4, 0.8));
        }
        this.shockwave(this.enemyHome, 3 + this.enemyHeight * 0.5, new THREE.Color(0.4, 0.75, 1));
        break;
      case Element.Wood:
        for (let i = 0; i < count; i++) {
          const c = Math.random() < 0.7 ? new THREE.Color(0.45, 0.95, 0.45) : new THREE.Color(1, 0.65, 0.8);
          this.ambient.emit(at.clone().add(inSphere().multiplyScalar(0.5)), onSphere().multiplyScalar(rand(1.5, 4)).addScaledVector(UP, 1.5), c, 1, rand(0.12, 0.26), rand(0.7, 1.3));
        }
        break;
      case Element.Light:
        this.burst(at, new THREE.Color(1, 0.92, 0.6), count, 10);
        if (big) this.column(this.enemyHome, elementColor(element));
        break;
      case Element.Dark:
        this.mistAt(at, count, 2.2);
        this.shockwave(this.enemyHome, 2.5 + this.enemyHeight * 0.5, new THREE.Color(0.55, 0.3, 0.95));
        break;
      default:
        this.burst(at, new THREE.Color(1, 1, 1), Math.floor(count / 2), 6);
    }
    if (big) {
      this.fovKick = 7;
      this.hitStop(0.07);
    }
  }

  async heroReturn() {
    if (this.hero.root.position.distanceTo(this.heroHome) > 0.3) {
      await this.wait(0.18);
      await this.moveHero(this.heroHome, 0.22);
    }
    this.face(this.hero.root, this.axis);
    this.hero.setBase('combat_idle', 0.2);
  }

  enemyHurt(amount, element, critical) {
    if (!this.enemy) return;
    this.enemyFlash = 0.8;
    if (amount > 0) this.enemy.play('hit', 0.04, { once: true });
    const color = elementColor(element);
    this.burst(this.enemyChest, color, critical ? 30 : 14, critical ? 8 : 5);
    this.elementImpact(this.enemyChest, element, critical || amount >= 15);
    if (critical) this.slashArc(this.enemyChest, color);
    this.mistAt(this.enemyChest, 6, 1);
    this.shake(critical ? 0.35 : 0.18);
  }

  heroBlock() { this.bubble(this.heroChest, new THREE.Color(0.45, 0.75, 1)); }
  heroHeal() { this.burst(this.heroChest, new THREE.Color(0.5, 1, 0.65), 24, 3); }
  enemyBlockFx() { this.bubble(this.enemyChest, new THREE.Color(0.55, 0.7, 1), this.enemyHeight); }

  enemyBuffFx() {
    if (!this.enemy) return;
    this.enemy.play('jump', 0.06, { once: true });
    this.shockwave(this.enemyHome, 2.5 + this.enemyHeight, new THREE.Color(1, 0.3, 0.4));
    this.burst(this.enemyChest, new THREE.Color(1, 0.35, 0.4), 30, 5);
  }

  statusFx(onEnemy, element) { this.burst(onEnemy ? this.enemyChest : this.heroChest, elementColor(element), 20, 3); }
  burnFx() { this.burst(this.enemyChest, new THREE.Color(1, 0.45, 0.2), 26, 4); }

  async enemyAttack(element) {
    if (!this.enemy) return;
    const lunge = this.grounded(this.enemyHome.clone().addScaledVector(this.axis, -1.6));
    this.enemy.play('attack', 0.06, { once: true });
    await this.tween(this.enemy.root, lunge, 0.22, (t) => t);
    await this.wait(0.1);
    this.burst(this.heroChest, elementColor(element), 16, 5);
  }

  heroHurt(amount, big) {
    if (amount > 0) this.hero.play(big ? 'knockback' : 'hit', 0.05, { once: true });
    this.burst(this.heroChest, new THREE.Color(1, 0.4, 0.5), 12, 4);
    this.shake(big ? 0.4 : 0.22);
  }

  async enemyReturn() {
    if (!this.enemy) return;
    await this.tween(this.enemy.root, this.enemyHome, 0.25, (t) => t);
    this.enemy.root.position.copy(this.enemyHome);
    this.hero.setBase('combat_idle', 0.25);
  }

  async companionAct(element, attack) {
    if (!this.companion) return;
    const color = elementColor(element);
    const home = this.companion.root.position.clone();
    if (!Stage.fast) {
      const up = home.clone().addScaledVector(UP, 0.6);
      await this.tween(this.companion.root, up, 0.15, (t) => Math.sin(t * Math.PI / 2));
      await this.tween(this.companion.root, home, 0.15, (t) => 1 - Math.cos(t * Math.PI / 2));
    }
    this.companion.root.position.copy(home);
    if (attack) await this.projectile(home.clone().addScaledVector(UP, 0.6), this.enemyChest, color, 0.35);
    else this.burst(this.heroChest, color, 22, 3);
  }

  async enemyDefeated() {
    if (!this.enemy) return;
    this.enemy.play('death', 0.05, { hold: true });
    this.mistAt(this.enemyChest, 70, 2);
    this.burst(this.enemyChest, new THREE.Color(1, 0.86, 0.55), 60, 8);
    this.shockwave(this.enemyHome, 4 + this.enemyHeight * 2, new THREE.Color(1, 0.85, 0.5));
    this.shake(0.5);
    await this.wait(0.7);
    this.hero.setBase('dance', 0.2);
    await this.wait(0.9);
  }

  async heroDefeated() {
    this.hero.play('death', 0.08, { hold: true });
    this.shake(0.5);
    await this.wait(1.4);
  }
}
