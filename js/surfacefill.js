// Carries colours across a mesh surface (no three.js, so tools can run it in Node too).
// Every vertex without a colour takes the colour of the nearest coloured vertex, counted in edges along the
// surface, then the filled area is smoothed. Used for the back of the heroine sculpts: the back of the head
// takes the hair colour from the top and sides of the head, not the face from the same spot in the picture.

/**
 * positions: xyz per vertex. index: triangle corners (null: every 3 vertices are a triangle).
 * colours: rgb per vertex, read where known[i] is 1 and written everywhere else that the surface reaches.
 * Returns a Uint8Array: 1 where a vertex ended up with a colour (known or carried).
 */
export function fillSurfaceColours(positions, index, colours, known, { smoothing = 8, penalty = null } = {}) {
  const n = positions.length / 3;
  // Vertices at the same spot are one surface point (seams, and the unshared corners of FBX meshes).
  const canon = new Int32Array(n);
  const seen = new Map();
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n * 3; i++) { lo[i % 3] = Math.min(lo[i % 3], positions[i]); hi[i % 3] = Math.max(hi[i % 3], positions[i]); }
  const q = (i, a) => Math.round(((positions[i * 3 + a] - lo[a]) / ((hi[a] - lo[a]) || 1)) * 131071); // 17 bits per axis
  for (let i = 0; i < n; i++) {
    const key = (q(i, 0) * 131072 + q(i, 1)) * 131072 + q(i, 2);
    const j = seen.get(key);
    if (j === undefined) {
      seen.set(key, i);
      canon[i] = i;
    } else canon[i] = j;
  }
  const corners = index ? index.length : n;
  const corner = index ? (k) => canon[index[k]] : (k) => canon[k];
  // Neighbours (CSR).
  const count = new Int32Array(n + 1);
  for (let k = 0; k + 2 < corners; k += 3) {
    for (let e = 0; e < 3; e++) {
      const a = corner(k + e), b = corner(k + ((e + 1) % 3));
      if (a !== b) { count[a + 1]++; count[b + 1]++; }
    }
  }
  for (let i = 0; i < n; i++) count[i + 1] += count[i];
  const nbr = new Int32Array(count[n]);
  const fill = count.slice(0, n);
  for (let k = 0; k + 2 < corners; k += 3) {
    for (let e = 0; e < 3; e++) {
      const a = corner(k + e), b = corner(k + ((e + 1) % 3));
      if (a !== b) { nbr[fill[a]++] = b; nbr[fill[b]++] = a; }
    }
  }
  // Known colours, merged onto the shared points.
  const col = new Float32Array(n * 3);
  const weight = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!known[i]) continue;
    const c = canon[i];
    col[c * 3] += colours[i * 3]; col[c * 3 + 1] += colours[i * 3 + 1]; col[c * 3 + 2] += colours[i * 3 + 2];
    weight[c]++;
  }
  const state = new Uint8Array(n); // 0 unreached, 1 known, 2 carried
  // Nearest known colour along the surface wins (Dijkstra on edge lengths). A known vertex can start
  // "further away" (penalty, in model units) so its colour only spreads when nothing else is close.
  const dist = new Float64Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const heap = new MinHeap(count[n] + n);
  for (let i = 0; i < n; i++) {
    if (canon[i] !== i || !weight[i]) continue;
    col[i * 3] /= weight[i]; col[i * 3 + 1] /= weight[i]; col[i * 3 + 2] /= weight[i];
    state[i] = 1;
    dist[i] = penalty ? penalty[i] : 0;
    from[i] = i;
    heap.push(dist[i], i);
  }
  const len = (a, b) => Math.hypot(positions[a * 3] - positions[b * 3], positions[a * 3 + 1] - positions[b * 3 + 1], positions[a * 3 + 2] - positions[b * 3 + 2]);
  while (heap.size) {
    const d = heap.topKey(), v = heap.pop();
    if (d > dist[v]) continue;
    for (let k = count[v]; k < count[v + 1]; k++) {
      const u = nbr[k];
      if (state[u] === 1) continue;
      const du = d + len(v, u);
      if (du < dist[u]) { dist[u] = du; from[u] = from[v]; heap.push(du, u); }
    }
  }
  for (let v = 0; v < n; v++) {
    if (state[v] || from[v] < 0) continue;
    const s = from[v];
    state[v] = 2;
    col[v * 3] = col[s * 3]; col[v * 3 + 1] = col[s * 3 + 1]; col[v * 3 + 2] = col[s * 3 + 2];
  }
  // Soften the borders between carried patches (known colours stay as they are).
  const next = new Float32Array(n * 3);
  for (let it = 0; it < smoothing; it++) {
    next.set(col);
    for (let v = 0; v < n; v++) {
      if (state[v] !== 2) continue;
      let r = col[v * 3], g = col[v * 3 + 1], b = col[v * 3 + 2], m = 1;
      for (let k = count[v]; k < count[v + 1]; k++) {
        const u = nbr[k];
        if (!state[u]) continue;
        r += col[u * 3]; g += col[u * 3 + 1]; b += col[u * 3 + 2]; m++;
      }
      next[v * 3] = r / m; next[v * 3 + 1] = g / m; next[v * 3 + 2] = b / m;
    }
    col.set(next);
  }
  const reached = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const c = canon[i];
    if (!state[c]) continue;
    reached[i] = 1;
    if (!known[i]) { colours[i * 3] = col[c * 3]; colours[i * 3 + 1] = col[c * 3 + 1]; colours[i * 3 + 2] = col[c * 3 + 2]; }
  }
  return reached;
}

class MinHeap {
  constructor(capacity) { this.keys = new Float64Array(capacity); this.vals = new Int32Array(capacity); this.size = 0; }
  topKey() { return this.keys[0]; }
  push(key, val) {
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= key) break;
      this.keys[i] = this.keys[p]; this.vals[i] = this.vals[p]; i = p;
    }
    this.keys[i] = key; this.vals[i] = val;
  }
  pop() {
    const val = this.vals[0], key = this.keys[--this.size], v = this.vals[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.keys[c + 1] < this.keys[c]) c++;
      if (this.keys[c] >= key) break;
      this.keys[i] = this.keys[c]; this.vals[i] = this.vals[c]; i = c;
    }
    this.keys[i] = key; this.vals[i] = v;
    return val;
  }
}

/** Light peach colours (anime skin), from 0..255 sRGB values. Skin should not spread onto hair or clothes. */
export function looksLikeSkin(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max < 140 || max !== r) return false;
  const s = (max - min) / max;
  const h = g >= b ? ((g - b) / (max - min || 1)) * 60 : 0;
  return s > 0.08 && s < 0.6 && h > 5 && h < 50;
}
