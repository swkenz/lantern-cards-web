// Colours an untextured Meshy sculpt by projecting its source picture onto it from the front.
// Faces that point away from the picture get a blurred version of the same spot, so the back of
// the model keeps the right palette (hair stays hair-coloured) without copying the face onto it.
import * as THREE from 'three';

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image failed: ' + url));
    img.src = url;
  });
}

function blurred(img, width = 14) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = Math.max(4, Math.round((img.height / img.width) * width));
  const g = c.getContext('2d');
  g.filter = 'blur(1px)';
  g.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/**
 * Adds `projUv` and `frontness` attributes to every mesh under `holder`.
 * params.rect = [x0, y0, x1, y1]: where the model's front bounding box sits in the picture (pixels).
 * params.front = 1 when the model faces +Z, -1 when it faces -Z.
 * Returns the two textures the projected material samples.
 */
/**
 * Front depth map of the model (orthographic, like a shadow map), so only the surface the picture
 * actually "sees" gets the sharp projection; hidden surfaces behind it get the soft colours.
 */
function frontDepth(renderer, holder, box, front, size = 768) {
  const w = box.max.x - box.min.x, h = box.max.y - box.min.y;
  const W = Math.round(size * Math.min(1, w / h)), H = Math.round(size * Math.min(1, h / w));
  const cx = (box.min.x + box.max.x) / 2, cy = (box.min.y + box.max.y) / 2;
  const reach = Math.max(Math.abs(box.min.z), Math.abs(box.max.z)) + 0.2;
  const cam = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.01, reach * 2 + 0.2);
  cam.position.set(cx, cy, front * (reach + 0.1));
  cam.lookAt(cx, cy, 0);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  const material = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    vertexShader: 'varying float vDepth; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }',
    fragmentShader: `uniform float uNear; uniform float uFar; varying float vDepth;
      void main(){ float d = clamp((vDepth - uNear) / (uFar - uNear), 0.0, 1.0); float hi = floor(d * 255.0) / 255.0; gl_FragColor = vec4(hi, fract(d * 255.0), 0.0, 1.0); }`,
    uniforms: { uNear: { value: cam.near }, uFar: { value: cam.far } },
  });
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(1, 1, 1);
  scene.overrideMaterial = material;
  const parent = holder.parent;
  scene.add(holder);
  const target = new THREE.WebGLRenderTarget(W, H, { colorSpace: THREE.NoColorSpace });
  const before = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.clear();
  renderer.render(scene, cam);
  const pixels = new Uint8Array(W * H * 4);
  renderer.readRenderTargetPixels(target, 0, 0, W, H, pixels);
  renderer.setRenderTarget(before);
  target.dispose();
  material.dispose();
  scene.remove(holder);
  if (parent) parent.add(holder);
  const depthAt = (px, py) => {
    let best = 1;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = Math.min(W - 1, Math.max(0, px + dx)), y = Math.min(H - 1, Math.max(0, py + dy));
        const i = (y * W + x) * 4;
        best = Math.min(best, pixels[i] / 255 + pixels[i + 1] / 255 / 255);
      }
    }
    return best;
  };
  const v = new THREE.Vector3();
  return (worldPoint) => {
    v.copy(worldPoint).applyMatrix4(cam.matrixWorldInverse);
    const d = (-v.z - cam.near) / (cam.far - cam.near);
    v.copy(worldPoint).project(cam);
    const px = Math.round((v.x * 0.5 + 0.5) * (W - 1)), py = Math.round((v.y * 0.5 + 0.5) * (H - 1));
    // Visible if no surface sits clearly in front of this point (tolerance ~2 cm).
    return d <= depthAt(px, py) + 0.02 / (cam.far - cam.near);
  };
}

export function bakeProjection(holder, img, params, renderer) {
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder);
  const [x0, y0, x1, y1] = params.rect;
  const front = params.front || 1;
  const visible = renderer ? frontDepth(renderer, holder, box, front) : () => true;
  holder.updateMatrixWorld(true);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();
  holder.traverse((o) => {
    if (!o.isMesh || o.userData.outline) return;
    const g = o.geometry;
    const pos = g.attributes.position;
    if (!g.attributes.normal) g.computeVertexNormals();
    const nor = g.attributes.normal;
    normalMatrix.getNormalMatrix(o.matrixWorld);
    const uv = new Float32Array(pos.count * 2);
    const fr = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      n.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix).normalize();
      const u = front > 0 ? (p.x - box.min.x) / (box.max.x - box.min.x) : (box.max.x - p.x) / (box.max.x - box.min.x);
      const h = (p.y - box.min.y) / (box.max.y - box.min.y);
      const ix = x0 + u * (x1 - x0);
      const iy = y1 - h * (y1 - y0);
      uv[i * 2] = ix / img.width;
      uv[i * 2 + 1] = 1 - iy / img.height;
      const facing = n.z * front;
      fr[i] = visible(p) ? THREE.MathUtils.smoothstep(facing, -0.25, 0.35) : 0;
    }
    g.setAttribute('projUv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('frontness', new THREE.BufferAttribute(fr, 1));
  });
  const sharp = new THREE.Texture(img);
  sharp.colorSpace = THREE.SRGBColorSpace;
  sharp.anisotropy = 4;
  sharp.needsUpdate = true;
  const soft = new THREE.CanvasTexture(blurred(img));
  soft.colorSpace = THREE.SRGBColorSpace;
  return { sharp, soft };
}

/** Shader patch: multiplies the diffuse colour by the projected picture (sharp in front, soft behind). */
export function patchProjected(shader, textures) {
  shader.uniforms.uProjSharp = { value: textures.sharp };
  shader.uniforms.uProjSoft = { value: textures.soft };
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec2 projUv;\nattribute float frontness;\nvarying vec2 vProjUv;\nvarying float vFrontness;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvProjUv = projUv;\nvFrontness = frontness;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform sampler2D uProjSharp;\nuniform sampler2D uProjSoft;\nvarying vec2 vProjUv;\nvarying float vFrontness;')
    .replace('#include <map_fragment>', `#include <map_fragment>
      vec2 puv = clamp(vProjUv, vec2(0.001), vec2(0.999));
      vec3 projSharp = texture2D(uProjSharp, puv).rgb;
      vec3 projSoft = texture2D(uProjSoft, puv).rgb;
      diffuseColor.rgb *= mix(projSoft, projSharp, vFrontness) * 1.25;`);
}
