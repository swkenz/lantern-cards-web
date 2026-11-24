// Renders a rigged heroine .glb in several clips (software skinning), to check the rig without a browser.
// node tools/rig/preview.mjs <id> <out.png> [view] [clip@time,...]
import path from 'path';
import { fileURLToPath } from 'url';
import { readGlb } from './glb.mjs';
import { render, savePng } from './raster.mjs';
import * as M from './math.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const [id, out, view = 'front', list = 'bind,pose@0.6,pose@1.6,attack1@0.2,cleave@0.6,spell@0.25,run@0.3,hit@0.15'] = process.argv.slice(2);
const g = readGlb(path.resolve(here, `../../assets/models/heroines/${id}.glb`));
const j = g.json;
const prim = j.meshes[0].primitives[0];
const pos = g.accessor(prim.attributes.POSITION).data, J = g.accessor(prim.attributes.JOINTS_0).data, Wt = g.accessor(prim.attributes.WEIGHTS_0).data;
const index = g.accessor(prim.indices).data;
const skin = j.skins[0];
const ibm = g.accessor(skin.inverseBindMatrices).data;
const parent = {}; j.nodes.forEach((n, i) => (n.children || []).forEach((c) => (parent[c] = i)));

function sample(times, values, n, t) {
  if (t <= times[0]) return Array.from(values.slice(0, n));
  const last = times.length - 1;
  if (t >= times[last]) return Array.from(values.slice(last * n, last * n + n));
  let k = 0; while (times[k + 1] < t) k++;
  const u = (t - times[k]) / (times[k + 1] - times[k]);
  const a = Array.from(values.slice(k * n, k * n + n)), b = Array.from(values.slice((k + 1) * n, (k + 1) * n + n));
  return n === 4 ? M.qslerp(a, b, u) : M.lerp3(a, b, u);
}
function pose(clipName, time) {
  const local = j.nodes.map((n) => ({ t: n.translation || [0, 0, 0], r: n.rotation || [0, 0, 0, 1] }));
  const clip = j.animations.find((a) => a.name === clipName);
  if (clip) for (const ch of clip.channels) {
    const s = clip.samplers[ch.sampler];
    const times = g.accessor(s.input).data, values = g.accessor(s.output).data;
    if (ch.target.path === 'rotation') local[ch.target.node].r = sample(times, values, 4, time);
    else if (ch.target.path === 'translation') local[ch.target.node].t = sample(times, values, 3, time);
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
  const joints = skin.joints.map((node) => { const m = get(node); return [m[12], m[13], m[14]]; });
  return { pos: out, joints };
}
const bones = skin.joints.map((node, k) => [skin.joints.indexOf(parent[node]), k]).filter(([p]) => p >= 0);
// Colour by the strongest bone (when the clip name ends with "!"), to check who owns which surface.
// One colour per bone: torso warm, head cyan, right side cool, left side green/yellow.
const PALETTE = [[230,70,70],[240,140,60],[250,200,60],[200,120,40],[170,90,200],[60,200,200],[90,90,200],[60,120,255],[120,60,220],[160,160,255],[80,150,80],[60,210,90],[170,230,60],[230,240,120],[90,40,120],[140,80,160],[200,140,220],[250,190,240],[40,100,60],[110,170,110],[160,210,160],[210,240,210],[128,128,128]];
const colors = new Uint8Array(pos.length);
for (let v = 0; v < pos.length / 3; v++) { const c = PALETTE[J[v * 4] % PALETTE.length]; colors.set(c, v * 3); }
const imgs = list.split(',').map((item) => {
  const paint = item.endsWith('!');
  const [clip, t] = item.replace('!', '').split('@');
  const p = pose(clip, Number(t || 0));
  return render(p.pos, index, { view, px: +(process.env.PX || 520), box: [-0.75, -0.05, 0.75, 1.9], joints: p.joints, bones, grid: 0.1, colors: paint ? colors : null });
});
await savePng(imgs, out);
console.log('wrote', out);
