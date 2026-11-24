// Heroine sculpt as an indexed, normalized mesh: Y up, facing +Z, 1.75 m tall, feet at y=0, centred on x/z.
import { readFbx, child, childs } from './fbx.mjs';
export const HEIGHT = 1.75;
export function loadHeroine(path) {
  const f = readFbx(path);
  const objs = f.root.find((n) => n.name === 'Objects');
  const geo = childs(objs, 'Geometry')[0];
  const raw = child(geo, 'Vertices').props[0];
  const pvi = child(geo, 'PolygonVertexIndex').props[0];
  const n = raw.length / 3;
  const pos = new Float32Array(n * 3);
  // Lcl Rotation -90 about X: (x, y, z) -> (x, z, -y)
  for (let i = 0; i < n; i++) { pos[i * 3] = raw[i * 3]; pos[i * 3 + 1] = raw[i * 3 + 2]; pos[i * 3 + 2] = -raw[i * 3 + 1]; }
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], pos[i * 3 + a]); mx[a] = Math.max(mx[a], pos[i * 3 + a]); }
  const s = HEIGHT / (mx[1] - mn[1]);
  const c = [(mn[0] + mx[0]) / 2, mn[1], (mn[2] + mx[2]) / 2];
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) pos[i * 3 + a] = (pos[i * 3 + a] - c[a]) * s;
  const idx = [];
  let poly = [];
  for (const k of pvi) {
    if (k < 0) { poly.push(~k); for (let t = 1; t + 1 < poly.length; t++) idx.push(poly[0], poly[t], poly[t + 1]); poly = []; } else poly.push(k);
  }
  return { pos, index: Uint32Array.from(idx), count: n, normalize: { center: c, scale: s } };
}
export function vertexNormals(pos, index) {
  const nor = new Float32Array(pos.length);
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) { nor[k] += nx; nor[k + 1] += ny; nor[k + 2] += nz; }
  }
  for (let i = 0; i < nor.length; i += 3) { const l = Math.hypot(nor[i], nor[i + 1], nor[i + 2]) || 1; nor[i] /= l; nor[i + 1] /= l; nor[i + 2] /= l; }
  return nor;
}
