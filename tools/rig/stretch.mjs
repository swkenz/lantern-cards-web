// How much a clip stretches the surface: node tools/rig/stretch.mjs <id> [clip,...]
// For every frame (30 fps) measures each edge against its bind length. Reports the worst frame, how much of
// the surface stretches past 1.5x, and which bone pairs own the stretched edges.
import { loadRig, pose } from './pose.mjs';
import { NAMES } from './skeleton.mjs';

const [id, list = 'pose,attack1,cleave,spell,block'] = process.argv.slice(2);
const rig = loadRig(id);
const I = rig.index, P0 = rig.pos;
const edges = new Map();
for (let f = 0; f < I.length; f += 3) for (let e = 0; e < 3; e++) {
  const a = I[f + e], b = I[f + (e + 1) % 3], k = a < b ? a * 1e6 + b : b * 1e6 + a;
  if (!edges.has(k)) edges.set(k, [Math.min(a, b), Math.max(a, b)]);
}
const E = [...edges.values()];
const L0 = E.map(([a, b]) => Math.hypot(P0[a * 3] - P0[b * 3], P0[a * 3 + 1] - P0[b * 3 + 1], P0[a * 3 + 2] - P0[b * 3 + 2]) || 1e-6);
const owner = (v) => NAMES[rig.joints[v * 4]];
for (const clip of list.split(',')) {
  const c = rig.clips[clip];
  if (!c) { console.log(clip, 'missing'); continue; }
  let worst = { frac: 0 }, pairs = new Map();
  for (let t = 0; t <= c.duration + 1e-6; t += 1 / 30) {
    const { pos } = pose(rig, clip, t);
    let bad = 0;
    E.forEach(([a, b], i) => {
      const l = Math.hypot(pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1], pos[a * 3 + 2] - pos[b * 3 + 2]);
      if (l / L0[i] > 1.5 && l - L0[i] > 0.01) { bad++; const k = [owner(a), owner(b)].sort().join('/'); pairs.set(k, (pairs.get(k) || 0) + 1); }
    });
    if (bad / E.length > worst.frac) worst = { frac: bad / E.length, t };
  }
  const top = [...pairs.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([k, n]) => `${k} ${n}`).join(', ');
  console.log(`${id} ${clip.padEnd(8)} worst ${(worst.frac * 100).toFixed(2)}% at ${worst.t?.toFixed(2)}s  ${top}`);
}
