// Tiny software renderer for previews: orthographic views, z-buffer, lambert shading, joint overlay.
// sharp writes the PNGs (npm i -D sharp, or a global install).
const sharp = (await import('sharp').catch(() => import('/opt/npm-tools/node_modules/sharp/dist/index.mjs'))).default;
// view: 'front' looks from +Z, 'side' looks from +X (character's left), 'back' from -Z, 'right' from -X
const VIEWS = {
  front: (p) => [p[0], p[1], p[2]],
  back: (p) => [-p[0], p[1], -p[2]],
  side: (p) => [-p[2], p[1], p[0]],
  right: (p) => [p[2], p[1], -p[0]],
  top: (p) => [p[0], -p[2], p[1]],
};
export function render(pos, index, { view = 'front', px = 500, box = [-1, -0.05, 1, 1.85], joints = null, bones = null, colors = null, grid = 0.1, clip = null } = {}) {
  const [x0, y0, x1, y1] = box;
  const W = Math.round(px * (x1 - x0) / (y1 - y0)), H = px;
  const img = new Uint8ClampedArray(W * H * 3).fill(236);
  const zb = new Float32Array(W * H).fill(-1e9);
  const T = VIEWS[view];
  const sx = (x) => (x - x0) / (x1 - x0) * (W - 1), sy = (y) => (y1 - y) / (y1 - y0) * (H - 1);
  // grid
  if (grid) {
    for (let g = Math.ceil(x0 / grid) * grid; g <= x1; g += grid) { const X = Math.round(sx(g)); for (let y = 0; y < H; y++) { const k = (y * W + X) * 3; const v = Math.abs(g) < 1e-6 ? 170 : 215; img[k] = img[k + 1] = img[k + 2] = v; } }
    for (let g = Math.ceil(y0 / grid) * grid; g <= y1; g += grid) { const Y = Math.round(sy(g)); for (let x = 0; x < W; x++) { const k = (Y * W + x) * 3; const v = Math.abs(g % 0.5) < 1e-6 || Math.abs(Math.abs(g % 0.5) - 0.5) < 1e-6 ? 170 : 215; img[k] = img[k + 1] = img[k + 2] = v; } }
  }
  const P = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) { const q = T([pos[i], pos[i + 1], pos[i + 2]]); P[i] = sx(q[0]); P[i + 1] = sy(q[1]); P[i + 2] = q[2]; }
  const L = [0.35, 0.55, 0.75]; const ll = Math.hypot(...L); L[0] /= ll; L[1] /= ll; L[2] /= ll;
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
    if (clip && (pos[a + 1] > clip[1] || pos[a + 1] < clip[0])) continue;
    // world-space normal in view space
    const qa = T([pos[a], pos[a + 1], pos[a + 2]]), qb = T([pos[b], pos[b + 1], pos[b + 2]]), qc = T([pos[c], pos[c + 1], pos[c + 2]]);
    const ux = qb[0] - qa[0], uy = qb[1] - qa[1], uz = qb[2] - qa[2], vx = qc[0] - qa[0], vy = qc[1] - qa[1], vz = qc[2] - qa[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const shade = 0.35 + 0.65 * Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
    let col = [225, 222, 230];
    if (colors) { const ia = index[t] * 3; col = [colors[ia], colors[ia + 1], colors[ia + 2]]; }
    const ax = P[a], ay = P[a + 1], bx = P[b], by = P[b + 1], cx = P[c], cy = P[c + 1];
    const minx = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxx = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
    const miny = Math.max(0, Math.floor(Math.min(ay, by, cy))), maxy = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-9) continue;
    for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
      const w0 = ((bx - x) * (cy - y) - (by - y) * (cx - x)) / area, w1 = ((cx - x) * (ay - y) - (cy - y) * (ax - x)) / area, w2 = 1 - w0 - w1;
      if (w0 < -0.001 || w1 < -0.001 || w2 < -0.001) continue;
      const z = w0 * P[a + 2] + w1 * P[b + 2] + w2 * P[c + 2];
      const k = y * W + x;
      if (z <= zb[k]) continue;
      zb[k] = z;
      img[k * 3] = col[0] * shade; img[k * 3 + 1] = col[1] * shade; img[k * 3 + 2] = col[2] * shade;
    }
  }
  const dot = (X, Y, r, c) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { if (dx * dx + dy * dy > r * r) continue; const x = Math.round(X + dx), y = Math.round(Y + dy); if (x < 0 || y < 0 || x >= W || y >= H) continue; const k = (y * W + x) * 3; img[k] = c[0]; img[k + 1] = c[1]; img[k + 2] = c[2]; } };
  if (bones && joints) for (const [i, j] of bones) {
    const p = T(joints[i]), q = T(joints[j]);
    const X0 = sx(p[0]), Y0 = sy(p[1]), X1 = sx(q[0]), Y1 = sy(q[1]); const n = Math.ceil(Math.hypot(X1 - X0, Y1 - Y0));
    for (let s = 0; s <= n; s++) dot(X0 + (X1 - X0) * s / n, Y0 + (Y1 - Y0) * s / n, 1, [40, 120, 255]);
  }
  if (joints) joints.forEach((j, i) => { const p = T(j); dot(sx(p[0]), sy(p[1]), 3, i === 0 ? [255, 0, 0] : [230, 40, 60]); });
  return { img, W, H };
}
export async function savePng(views, file) {
  // views: array of {img,W,H}; stitched horizontally
  const H = Math.max(...views.map((v) => v.H)); const W = views.reduce((s, v) => s + v.W + 6, 0);
  const out = Buffer.alloc(W * H * 3, 255); let ox = 0;
  for (const v of views) { for (let y = 0; y < v.H; y++) for (let x = 0; x < v.W; x++) { const s = (y * v.W + x) * 3, d = (y * W + ox + x) * 3; out[d] = v.img[s]; out[d + 1] = v.img[s + 1]; out[d + 2] = v.img[s + 2]; } ox += v.W + 6; }
  await sharp(out, { raw: { width: W, height: H, channels: 3 } }).png().toFile(file);
}
