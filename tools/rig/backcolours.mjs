// Bakes the colours for the parts of a heroine her picture cannot see (her back, under her arms) into the
// .glb, so the game does not have to work them out on the phone. Mirrors js/projection.js: the picture is
// laid over the model's front (projection.json); what the picture sees keeps its colour, and everything else
// takes the colour of the nearest seen surface along the model (js/surfacefill.js). Skin does not spread far,
// so the back of the head becomes hair and the back of a dress stays dress.
import fs from 'fs';
import path from 'path';
import { fillSurfaceColours, looksLikeSkin } from '../../js/surfacefill.js';
import { vertexNormals } from './mesh.mjs';

const toLinear = (c) => ((c /= 255) < 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toSrgb = (c) => Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
const smoothstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/** Returns sRGB bytes (rgba, a = 255) per vertex, or null when the heroine has no picture. */
export async function bakeBackColours(id, mesh, root) {
  const settingsFile = path.join(root, 'assets/models/heroines/projection.json');
  const picture = path.join(root, `assets/art/heroines3d/${id}.jpg`);
  if (!fs.existsSync(picture)) return null;
  let sharp;
  try { sharp = (await import('sharp')).default; } catch {
    console.log('  (sharp not installed: back colours are left to the game)');
    return null;
  }
  const settings = fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, 'utf8')) : {};
  const img = await sharp(picture).raw().toBuffer({ resolveWithObject: true });
  const IW = img.info.width, IH = img.info.height, ch = img.info.channels;
  const params = settings[id] || { rect: [0, 0, IW, IH], front: 1 };
  const [x0, y0, x1, y1] = params.rect, front = params.front || 1;
  const P = mesh.pos, I = mesh.index, n = P.length / 3;
  const nor = vertexNormals(P, I);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n * 3; i++) { lo[i % 3] = Math.min(lo[i % 3], P[i]); hi[i % 3] = Math.max(hi[i % 3], P[i]); }
  // Front depth, like frontDepth() in projection.js (768 px on the long side, orthographic).
  const w = hi[0] - lo[0], h = hi[1] - lo[1];
  const W = Math.round(768 * Math.min(1, w / h)), H = Math.round(768 * Math.min(1, h / w));
  const zb = new Float32Array(W * H).fill(-Infinity);
  const sx = (x) => ((front > 0 ? x - lo[0] : hi[0] - x) / w) * (W - 1), sy = (y) => ((hi[1] - y) / h) * (H - 1);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ax = sx(P[a]), ay = sy(P[a + 1]), bx = sx(P[b]), by = sy(P[b + 1]), cx = sx(P[c]), cy = sy(P[c + 1]);
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-12) continue;
    for (let y = Math.max(0, Math.floor(Math.min(ay, by, cy))); y <= Math.min(H - 1, Math.ceil(Math.max(ay, by, cy))); y++) {
      for (let x = Math.max(0, Math.floor(Math.min(ax, bx, cx))); x <= Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx))); x++) {
        const w0 = ((bx - x) * (cy - y) - (by - y) * (cx - x)) / area, w1 = ((cx - x) * (ay - y) - (cy - y) * (ax - x)) / area, w2 = 1 - w0 - w1;
        if (w0 < -0.01 || w1 < -0.01 || w2 < -0.01) continue;
        const z = (w0 * P[a + 2] + w1 * P[b + 2] + w2 * P[c + 2]) * front;
        if (z > zb[y * W + x]) zb[y * W + x] = z;
      }
    }
  }
  const visible = (i) => {
    const X = Math.round(sx(P[i * 3])), Y = Math.round(sy(P[i * 3 + 1]));
    let near = -Infinity;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = Math.min(W - 1, Math.max(0, X + dx)), y = Math.min(H - 1, Math.max(0, Y + dy));
      near = Math.max(near, zb[y * W + x]);
    }
    return P[i * 3 + 2] * front >= near - 0.02;
  };
  const colours = new Float32Array(n * 3), known = new Uint8Array(n), penalty = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = (front > 0 ? P[i * 3] - lo[0] : hi[0] - P[i * 3]) / w, v = (P[i * 3 + 1] - lo[1]) / h;
    const px = Math.min(IW - 1, Math.max(0, Math.round(x0 + u * (x1 - x0)))), py = Math.min(IH - 1, Math.max(0, Math.round(y1 - v * (y1 - y0))));
    const k = (py * IW + px) * ch;
    const frontness = visible(i) ? smoothstep(-0.25, 0.35, nor[i * 3 + 2] * front) : 0;
    if (frontness <= 0.35) continue;
    known[i] = 1;
    colours[i * 3] = toLinear(img.data[k]); colours[i * 3 + 1] = toLinear(img.data[k + 1]); colours[i * 3 + 2] = toLinear(img.data[k + 2]);
    if (looksLikeSkin(img.data[k], img.data[k + 1], img.data[k + 2])) penalty[i] = 0.08;
  }
  const reached = fillSurfaceColours(P, I, colours, known, { penalty });
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) out[i * 4 + c] = reached[i] ? toSrgb(Math.min(1, colours[i * 3 + c])) : 160;
    out[i * 4 + 3] = 255;
  }
  return out;
}
