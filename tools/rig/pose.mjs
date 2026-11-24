// Software skinning of a rigged heroine .glb, for previews and checks outside the browser.
import path from 'path';
import { fileURLToPath } from 'url';
import { readGlb } from './glb.mjs';
import * as M from './math.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

function sample(times, values, n, t) {
  if (t <= times[0]) return Array.from(values.slice(0, n));
  const last = times.length - 1;
  if (t >= times[last]) return Array.from(values.slice(last * n, last * n + n));
  let k = 0; while (times[k + 1] < t) k++;
  const u = (t - times[k]) / (times[k + 1] - times[k]);
  const a = Array.from(values.slice(k * n, k * n + n)), b = Array.from(values.slice((k + 1) * n, (k + 1) * n + n));
  return n === 4 ? M.qslerp(a, b, u) : M.lerp3(a, b, u);
}

export function loadRig(id) {
  const g = readGlb(path.resolve(here, `../../assets/models/heroines/${id}.glb`));
  const j = g.json;
  const prim = j.meshes[0].primitives[0];
  const rig = {
    json: j,
    pos: g.accessor(prim.attributes.POSITION).data,
    joints: g.accessor(prim.attributes.JOINTS_0).data,
    weights: g.accessor(prim.attributes.WEIGHTS_0).data,
    index: g.accessor(prim.indices).data,
    skin: j.skins[0],
    ibm: g.accessor(j.skins[0].inverseBindMatrices).data,
    parent: {},
    clips: {},
  };
  j.nodes.forEach((n, i) => (n.children || []).forEach((c) => (rig.parent[c] = i)));
  for (const a of j.animations) {
    rig.clips[a.name] = {
      duration: Math.max(...a.channels.map((ch) => { const d = g.accessor(a.samplers[ch.sampler].input).data; return d[d.length - 1]; })),
      channels: a.channels.map((ch) => ({ node: ch.target.node, path: ch.target.path, times: g.accessor(a.samplers[ch.sampler].input).data, values: g.accessor(a.samplers[ch.sampler].output).data })),
    };
  }
  rig.bones = rig.skin.joints.map((node, k) => [rig.skin.joints.indexOf(rig.parent[node]), k]).filter(([p]) => p >= 0);
  return rig;
}

/** Skinned vertex positions and joint positions of `clip` at `time` ("bind" or an unknown name: rest pose). */
export function pose(rig, clipName, time) {
  const { json: j, parent, skin, ibm, pos, joints: J, weights: Wt } = rig;
  const local = j.nodes.map((n) => ({ t: n.translation || [0, 0, 0], r: n.rotation || [0, 0, 0, 1] }));
  const clip = rig.clips[clipName];
  if (clip) for (const ch of clip.channels) {
    if (ch.path === 'rotation') local[ch.node].r = sample(ch.times, ch.values, 4, time);
    else if (ch.path === 'translation') local[ch.node].t = sample(ch.times, ch.values, 3, time);
  }
  const world = [];
  const get = (i) => {
    if (world[i]) return world[i];
    const m = M.mat(local[i].r, local[i].t);
    return (world[i] = parent[i] === undefined ? m : M.matMul(get(parent[i]), m));
  };
  const skinM = skin.joints.map((node, k) => M.matMul(get(node), Array.from(ibm.slice(k * 16, k * 16 + 16))));
  const out = new Float32Array(pos.length);
  for (let v = 0; v < pos.length / 3; v++) {
    const p = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 4; k++) {
      const w = Wt[v * 4 + k] / 255; if (!w) continue;
      const q = M.matApply(skinM[J[v * 4 + k]], p); x += q[0] * w; y += q[1] * w; z += q[2] * w;
    }
    out[v * 3] = x; out[v * 3 + 1] = y; out[v * 3 + 2] = z;
  }
  return { pos: out, joints: skin.joints.map((node) => { const m = get(node); return [m[12], m[13], m[14]]; }) };
}
