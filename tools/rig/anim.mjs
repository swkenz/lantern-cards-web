// Akari's animation clips, retargeted onto a fitted heroine skeleton.
import { readGlb } from './glb.mjs';
import { NAMES, OFFSET, IDX, PARENT } from './skeleton.mjs';
import * as M from './math.mjs';

export function readClips(glbPath) {
  const g = readGlb(glbPath);
  const j = g.json;
  return j.animations.map((a) => {
    const tracks = [];
    for (const ch of a.channels) {
      const bone = j.nodes[ch.target.node].name;
      if (IDX[bone] === undefined) continue;
      const s = a.samplers[ch.sampler];
      tracks.push({ bone, path: ch.target.path, times: Float32Array.from(g.accessor(s.input).data), values: Float32Array.from(g.accessor(s.output).data) });
    }
    const duration = Math.max(...tracks.map((t) => t.times[t.times.length - 1]));
    return { name: a.name, duration, tracks };
  });
}


// How far each body part goes from the sculpt's own pose toward Akari's (1 = all the way).
// Heroines act mostly with the upper body: legs and hips stay near the sculpt so long dresses keep their shape.
export const AMOUNT = { arm: 0.6, spine: 0.5, head: 0.5, hips: 0.15, leg: 0.1, hipsMove: 0.1 };
function amountFor(bone, A) {
  if (/Shoulder|Arm|Hand/.test(bone)) return (bone.startsWith('Left') ? A.leftArm : A.rightArm) ?? A.arm;
  if (/Leg|Foot|Toes/.test(bone)) return A.leg;
  if (bone === 'Hips') return A.hips;
  if (bone === 'Neck' || bone === 'Head') return A.head;
  if (bone === 'SkirtRoot') return 0;
  return A.spine;
}

/** Full clip: Akari's rotations (the rest pose shares her bone directions), blended with the sculpt's pose. */
export function retarget(clip, fit, J, A = AMOUNT) {
  const s = fit.legScale, O = OFFSET[IDX.Hips];
  const tracks = clip.tracks.map((tr) => {
    const v = new Float32Array(tr.values.length);
    if (tr.path === 'translation') {
      for (let k = 0; k < v.length; k += 3) {
        const full = [J.Hips[0] + (tr.values[k] - O[0]) * s, tr.values[k + 1] * s, J.Hips[2] + (tr.values[k + 2] - O[2]) * s];
        v.set(M.lerp3(J.Hips, full, A.hipsMove), k);
      }
    } else {
      const bind = fit.r[IDX[tr.bone]], k0 = amountFor(tr.bone, A);
      for (let k = 0; k < v.length; k += 4) v.set(M.qslerp(bind, [tr.values[k], tr.values[k + 1], tr.values[k + 2], tr.values[k + 3]], k0), k);
    }
    return { ...tr, values: v };
  });
  const has = new Set(tracks.filter((t) => t.path === 'rotation').map((t) => t.bone));
  for (const b of NAMES) if (!has.has(b)) {
    const q = M.qslerp(fit.r[IDX[b]], M.QI, amountFor(b, A));
    tracks.push({ bone: b, path: 'rotation', times: Float32Array.of(0, clip.duration), values: Float32Array.of(...q, ...q) });
  }
  const out = { name: clip.name, duration: clip.duration, tracks };
  ground(out, fit);
  return out;
}

function sample(tr, t, n) {
  const T = tr.times, V = tr.values, last = T.length - 1;
  if (t <= T[0]) return Array.from(V.slice(0, n));
  if (t >= T[last]) return Array.from(V.slice(last * n, last * n + n));
  let k = 0; while (T[k + 1] < t) k++;
  const u = (t - T[k]) / (T[k + 1] - T[k]);
  const a = Array.from(V.slice(k * n, k * n + n)), b = Array.from(V.slice((k + 1) * n, (k + 1) * n + n));
  return n === 4 ? M.qslerp(a, b, u) : M.lerp3(a, b, u);
}

/** Keeps the lower foot on the ground: moves the hips up or down so neither foot sinks or floats. */
function ground(clip, fit) {
  const hipsT = clip.tracks.find((t) => t.bone === 'Hips' && t.path === 'translation');
  if (!hipsT) return;
  const rot = Object.fromEntries(clip.tracks.filter((t) => t.path === 'rotation').map((t) => [t.bone, t]));
  const legs = ['Left', 'Right'].map((s) => [s + 'UpperLeg', s + 'LowerLeg', s + 'Foot', s + 'Toes']);
  const groundY = Math.min(...legs.flat().slice(0).filter((n) => /Foot|Toes/.test(n)).map((n) => fit.P[IDX[n]][1]));
  for (let k = 0; k < hipsT.times.length; k++) {
    const t = hipsT.times[k];
    const hp = [hipsT.values[k * 3], hipsT.values[k * 3 + 1], hipsT.values[k * 3 + 2]];
    const hq = rot.Hips ? sample(rot.Hips, t, 4) : fit.r[IDX.Hips];
    let low = Infinity;
    for (const chain of legs) {
      let p = hp, q = hq;
      for (const b of chain) {
        p = M.add(p, M.qrot(q, fit.t[IDX[b]]));
        q = M.qmul(q, rot[b] ? sample(rot[b], t, 4) : fit.r[IDX[b]]);
        if (/Foot|Toes/.test(b)) low = Math.min(low, p[1]);
      }
    }
    hipsT.values[k * 3 + 1] += groundY - low;
  }
}

function meanQuat(values) {
  const ref = [values[0], values[1], values[2], values[3]];
  const acc = [0, 0, 0, 0];
  for (let k = 0; k < values.length; k += 4) {
    const sgn = values[k] * ref[0] + values[k + 1] * ref[1] + values[k + 2] * ref[2] + values[k + 3] * ref[3] < 0 ? -1 : 1;
    for (let c = 0; c < 4; c++) acc[c] += values[k + c] * sgn;
  }
  return M.qnorm(acc);
}

/**
 * Pose clip: the sculpt's own pose, moved by how Akari's clip moves around its average pose
 * (breathing, weight shifts, sway). amount scales the motion.
 */
export function poseClip(clip, fit, J, name, amount = 1) {
  const s = fit.legScale;
  const tracks = clip.tracks.map((tr) => {
    const v = new Float32Array(tr.values.length);
    if (tr.path === 'translation') {
      const mean = [0, 0, 0];
      for (let k = 0; k < v.length; k += 3) for (let c = 0; c < 3; c++) mean[c] += tr.values[k + c] / (v.length / 3);
      for (let k = 0; k < v.length; k += 3) for (let c = 0; c < 3; c++) v[k + c] = J.Hips[c] + (tr.values[k + c] - mean[c]) * s * amount;
    } else {
      const m = M.qconj(meanQuat(tr.values));
      const bind = fit.r[IDX[tr.bone]];
      for (let k = 0; k < v.length; k += 4) {
        const d = M.qslerp(M.QI, M.qmul(m, [tr.values[k], tr.values[k + 1], tr.values[k + 2], tr.values[k + 3]]), amount);
        const q = M.qnorm(M.qmul(bind, d));
        v.set(q, k);
      }
    }
    return { ...tr, values: v };
  });
  return { name, duration: clip.duration, tracks };
}

function eulerDeg([x, y, z]) {
  const h = Math.PI / 360;
  const qx = [Math.sin(x * h), 0, 0, Math.cos(x * h)], qy = [0, Math.sin(y * h), 0, Math.cos(y * h)], qz = [0, 0, Math.sin(z * h), Math.cos(z * h)];
  return M.qmul(qz, M.qmul(qy, qx));
}
const smoothstep = (u) => u * u * (3 - 2 * u);

/**
 * A hand-made clip on top of the sculpt's pose. keys: [{ t, rot: { Bone: [x, y, z] }, move: [x, y, z] }]
 * rot turns a bone (and what hangs from it) about the character's own axes, in degrees
 * (X right, Y up, Z toward the enemy); move shifts the hips in metres. Missing values are 0 (the sculpt's pose).
 */
export function customClip(name, keys, fit, J, fps = 30) {
  const bones = [...new Set(keys.flatMap((k) => Object.keys(k.rot || {})))];
  const duration = keys[keys.length - 1].t;
  const times = [];
  for (let i = 0; i <= Math.round(duration * fps); i++) times.push(i / fps);
  const at = (t, get) => {
    let k = 0;
    while (k < keys.length - 2 && keys[k + 1].t < t) k++;
    const a = keys[k], b = keys[k + 1];
    const u = smoothstep(Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))));
    const va = get(a) || [0, 0, 0], vb = get(b) || [0, 0, 0];
    return M.lerp3(va, vb, u);
  };
  const tracks = bones.map((bone) => {
    const i = IDX[bone], p = PARENT[i];
    const Wp = p < 0 ? M.QI : fit.W[p];
    const values = new Float32Array(times.length * 4);
    times.forEach((t, n) => {
      const off = eulerDeg(at(t, (k) => k.rot?.[bone]));
      values.set(M.qnorm(M.qmul(M.qmul(M.qconj(Wp), M.qmul(off, Wp)), fit.r[i])), n * 4);
    });
    return { bone, path: 'rotation', times: Float32Array.from(times), values };
  });
  const hips = new Float32Array(times.length * 3);
  times.forEach((t, n) => hips.set(M.add(J.Hips, at(t, (k) => k.move)), n * 3));
  tracks.push({ bone: 'Hips', path: 'translation', times: Float32Array.from(times), values: hips });
  return { name, duration, tracks };
}
