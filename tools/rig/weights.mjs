// Automatic skin weights by geodesic distance over the surface: each bone claims the surface right around it
// ("seeds"), then every other point belongs to whichever seeds it can reach along the mesh in the fewest
// centimetres. Hair, sleeves and held weapons that grow out of a body part therefore follow that part.
import { NAMES, IDX } from './skeleton.mjs';
import * as M from './math.mjs';

// A limb bone may only own surface this close to it: a long dress is not dragged around by the shins.
const CAP = { UpperLeg: 0.14, LowerLeg: 0.11, Foot: 0.1, Toes: 0.07, Shoulder: 0.2, UpperArm: 0.3, LowerArm: 0.35, Neck: 0.12, Head: 0.22 }; // hands: no limit (bows, swords, fans)
const RADIUS = { Hips: 0.16, Spine: 0.15, Chest: 0.15, UpperChest: 0.14, Neck: 0.07, Head: 0.13, Shoulder: 0.07, UpperArm: 0.065, LowerArm: 0.055, Hand: 0.06, UpperLeg: 0.095, LowerLeg: 0.075, Foot: 0.07, Toes: 0.05 };
const TORSO = ['Hips', 'Spine', 'Chest', 'UpperChest', 'Neck', 'Head'];
const kind = (name) => name.replace(/^(Left|Right)/, '');

function segDist(p, a, b) {
  const ab = M.sub(b, a), ap = M.sub(p, a);
  const L2 = M.dot(ab, ab) || 1e-9;
  const t = Math.max(0, Math.min(1, M.dot(ap, ab) / L2));
  const c = M.add(a, M.scale(ab, t));
  return { d: M.len(M.sub(p, c)), t, c };
}

class Heap {
  constructor(n) { this.k = new Float64Array(n); this.v = new Int32Array(n); this.n = 0; }
  push(key, val) { let i = this.n++; while (i > 0) { const p = (i - 1) >> 1; if (this.k[p] <= key) break; this.k[i] = this.k[p]; this.v[i] = this.v[p]; i = p; } this.k[i] = key; this.v[i] = val; }
  pop() {
    const key = this.k[0], val = this.v[0], lk = this.k[--this.n], lv = this.v[this.n];
    let i = 0;
    for (;;) { let c = 2 * i + 1; if (c >= this.n) break; if (c + 1 < this.n && this.k[c + 1] < this.k[c]) c++; if (this.k[c] >= lk) break; this.k[i] = this.k[c]; this.v[i] = this.v[c]; i = c; }
    this.k[i] = lk; this.v[i] = lv;
    this.top = key; return val;
  }
}

export function computeWeights(mesh, fit, { sigma = 0.02, rigid = {}, log = () => {} } = {}) {
  const { pos, index, count } = mesh;
  // Weld duplicated positions so seams do not cut the surface graph.
  const canon = new Int32Array(count);
  const seen = new Map();
  for (let i = 0; i < count; i++) {
    const k = `${Math.round(pos[i * 3] * 2e4)},${Math.round(pos[i * 3 + 1] * 2e4)},${Math.round(pos[i * 3 + 2] * 2e4)}`;
    const j = seen.get(k);
    if (j === undefined) { seen.set(k, i); canon[i] = i; } else canon[i] = j;
  }
  // Area-weighted normals on the welded graph.
  const nor = new Float32Array(count * 3);
  for (let f = 0; f < index.length; f += 3) {
    const a = canon[index[f]], b = canon[index[f + 1]], c = canon[index[f + 2]];
    const pa = [pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]], pb = [pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]], pc = [pos[c * 3], pos[c * 3 + 1], pos[c * 3 + 2]];
    const nn = M.cross(M.sub(pb, pa), M.sub(pc, pa));
    for (const v of [a, b, c]) { nor[v * 3] += nn[0]; nor[v * 3 + 1] += nn[1]; nor[v * 3 + 2] += nn[2]; }
  }
  // Adjacency (CSR).
  const deg = new Int32Array(count + 1);
  const edges = [];
  for (let f = 0; f < index.length; f += 3) {
    const v = [canon[index[f]], canon[index[f + 1]], canon[index[f + 2]]];
    for (let e = 0; e < 3; e++) { const a = v[e], b = v[(e + 1) % 3]; if (a === b) continue; edges.push(a, b); deg[a + 1]++; deg[b + 1]++; }
  }
  for (let i = 0; i < count; i++) deg[i + 1] += deg[i];
  const nbr = new Int32Array(deg[count]), wlen = new Float32Array(deg[count]), fill = deg.slice(0, count);
  for (let e = 0; e < edges.length; e += 2) {
    const a = edges[e], b = edges[e + 1];
    const l = Math.hypot(pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1], pos[a * 3 + 2] - pos[b * 3 + 2]);
    nbr[fill[a]] = b; wlen[fill[a]++] = l; nbr[fill[b]] = a; wlen[fill[b]++] = l;
  }
  const isCanon = (i) => canon[i] === i;
  // Connected pieces.
  const comp = new Int32Array(count).fill(-1);
  let ncomp = 0;
  for (let s = 0; s < count; s++) {
    if (!isCanon(s) || comp[s] >= 0) continue;
    const stack = [s]; comp[s] = ncomp;
    while (stack.length) { const v = stack.pop(); for (let k = deg[v]; k < deg[v + 1]; k++) { const u = nbr[k]; if (comp[u] < 0) { comp[u] = ncomp; stack.push(u); } } }
    ncomp++;
  }
  // Seeds: the surface closest to each bone, facing away from it.
  const bones = Object.keys(fit.seg);
  const seedOf = new Int16Array(count).fill(-1);
  for (let i = 0; i < count; i++) {
    if (!isCanon(i)) continue;
    const p = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    let best = null, bi = -1;
    for (let b = 0; b < bones.length; b++) { const s = fit.seg[bones[b]]; const d = segDist(p, s[0], s[1]); if (!best || d.d < best.d) { best = d; bi = b; } }
    const name = bones[bi], k = kind(name);
    if (best.d > RADIUS[k]) continue;
    const limb = !TORSO.includes(name) && k !== 'Hand' && k !== 'Toes';
    if (limb && (best.t < 0.08 || best.t > 0.92)) continue;
    const nn = M.norm([nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]]);
    if (best.d > 0.01 && M.dot(nn, M.norm(M.sub(p, best.c))) < -0.15) continue;
    seedOf[i] = bi;
  }
  // Geodesic distance from each bone's seeds.
  const D = bones.map(() => new Float64Array(count).fill(Infinity));
  const heap = new Heap(deg[count] + count);
  for (let b = 0; b < bones.length; b++) {
    const dist = D[b];
    heap.n = 0;
    for (let i = 0; i < count; i++) if (seedOf[i] === b) { dist[i] = 0; heap.push(0, i); }
    while (heap.n) {
      const v = heap.pop(), dv = heap.top;
      if (dv > dist[v]) continue;
      for (let k = deg[v]; k < deg[v + 1]; k++) { const u = nbr[k], du = dv + wlen[k]; if (du < dist[u]) { dist[u] = du; heap.push(du, u); } }
    }
  }
  // Pieces with no seed at all (floating ribbons, ornaments) ride rigidly on the nearest torso bone.
  const compSeed = new Uint8Array(ncomp), compSum = Array.from({ length: ncomp }, () => [0, 0, 0, 0]);
  for (let i = 0; i < count; i++) if (isCanon(i)) { if (seedOf[i] >= 0) compSeed[comp[i]] = 1; const s = compSum[comp[i]]; s[0] += pos[i * 3]; s[1] += pos[i * 3 + 1]; s[2] += pos[i * 3 + 2]; s[3]++; }
  const compBone = new Int16Array(ncomp).fill(-1);
  for (let c = 0; c < ncomp; c++) {
    if (compSeed[c]) continue;
    const s = compSum[c], ctr = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
    let best = Infinity;
    for (const name of rigid.bones || ['Hips', 'Spine', 'Chest', 'UpperChest']) { const g = fit.seg[name]; const d = segDist(ctr, g[0], g[1]).d; if (d < best) { best = d; compBone[c] = bones.indexOf(name); } }
    log(`piece ${c}: ${s[3]} verts, no seed -> ${bones[compBone[c]]}`);
  }
  const joints = new Uint8Array(count * 4), weights = new Uint8Array(count * 4);
  const tmp = new Float64Array(bones.length);
  const caps = bones.map((b) => CAP[kind(b)] ?? Infinity);
  const ebuf = new Float64Array(bones.length);
  for (let i = 0; i < count; i++) {
    const v = canon[i];
    let top;
    if (compBone[comp[v]] >= 0) top = [[compBone[comp[v]], 1]];
    else {
      const p = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
      let dmin = Infinity, emin = Infinity;
      for (let b = 0; b < bones.length; b++) {
        const g = fit.seg[bones[b]], e = segDist(p, g[0], g[1]).d;
        emin = Math.min(emin, e);
        tmp[b] = e > caps[b] ? Infinity : D[b][v];
        if (tmp[b] < dmin) dmin = tmp[b];
      }
      if (dmin === Infinity) for (let b = 0; b < bones.length; b++) { tmp[b] = D[b][v]; dmin = Math.min(dmin, tmp[b]); }
      // Cloth far from any bone blends over a wider band, so it stretches gently instead of tearing.
      const s = sigma + 0.25 * Math.max(0, emin - 0.05);
      const w = new Float64Array(bones.length);
      let wsum = 0;
      for (let b = 0; b < bones.length; b++) { const x = (tmp[b] - dmin) / s; if (x < 4) { w[b] = Math.exp(-x * x); wsum += w[b]; } }
      // Loose cloth and long hair hang from whichever bone is straight above them, not from wherever the
      // surface happens to be stitched to (a sleeve fused to the dress should still follow the arm).
      let owner = 0;
      for (let b = 1; b < bones.length; b++) if (tmp[b] < tmp[owner]) owner = b;
      // Held things (a bow, a sword) stay in the hand that holds them.
      const lam = kind(bones[owner]) === 'Hand' ? 0 : Math.min(1, Math.max(0, (emin - 0.08) / 0.08));
      if (lam > 0) {
        let e2min = Infinity;
        for (let b = 0; b < bones.length; b++) { const g = fit.seg[bones[b]]; ebuf[b] = segDist(p, g[0], g[1]).d; if (ebuf[b] > caps[b] || !(tmp[b] < dmin + 0.2)) ebuf[b] = Infinity; e2min = Math.min(e2min, ebuf[b]); }
        if (e2min < Infinity) {
          const s2 = 0.03 + 0.2 * Math.max(0, e2min - 0.08);
          let esum = 0;
          for (let b = 0; b < bones.length; b++) { const x = (ebuf[b] - e2min) / s2; ebuf[b] = x < 4 ? Math.exp(-x * x) : 0; esum += ebuf[b]; }
          for (let b = 0; b < bones.length; b++) w[b] = (1 - lam) * w[b] / wsum + lam * ebuf[b] / esum;
        }
      }
      top = [];
      for (let b = 0; b < bones.length; b++) if (w[b] > 1e-4) top.push([b, w[b]]);
      top.sort((a, b) => b[1] - a[1]);
      top = top.slice(0, 4);
    }
    // Quantize to bytes that sum to 255.
    const sum = top.reduce((s, x) => s + x[1], 0);
    let left = 255;
    top.forEach(([b, w], k) => {
      const q = k === top.length - 1 ? left : Math.min(left, Math.round((w / sum) * 255));
      joints[i * 4 + k] = IDX[bones[b]]; weights[i * 4 + k] = q; left -= q;
    });
  }
  return { joints, weights, seeds: seedOf, canon, bones };
}
