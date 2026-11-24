// Writes a skinned, animated heroine as a .glb (positions, indices, joints, weights, skin, clips).
import fs from 'fs';
import { NAMES, PARENT } from './skeleton.mjs';

export function writeGlb(file, { mesh, joints, weights, fit, clips, name }) {
  const chunks = [], views = [], accessors = [];
  let offset = 0;
  const view = (typed, target) => {
    const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const pad = (4 - (buf.length % 4)) % 4;
    chunks.push(buf, Buffer.alloc(pad));
    views.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, ...(target ? { target } : {}) });
    offset += buf.length + pad;
    return views.length - 1;
  };
  const accessor = (typed, componentType, type, count, extra = {}) => {
    accessors.push({ bufferView: view(typed, extra.target), componentType, type, count, ...(extra.normalized ? { normalized: true } : {}), ...(extra.min ? { min: extra.min, max: extra.max } : {}) });
    return accessors.length - 1;
  };
  const n = mesh.count;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], mesh.pos[i * 3 + a]); max[a] = Math.max(max[a], mesh.pos[i * 3 + a]); }
  const POSITION = accessor(Float32Array.from(mesh.pos), 5126, 'VEC3', n, { min, max, target: 34962 });
  const JOINTS_0 = accessor(joints, 5121, 'VEC4', n, { target: 34962 });
  const WEIGHTS_0 = accessor(weights, 5121, 'VEC4', n, { normalized: true, target: 34962 });
  const indices = accessor(Uint32Array.from(mesh.index), 5125, 'SCALAR', mesh.index.length, { target: 34963 });
  const ibm = accessor(Float32Array.from(fit.ibm.flat()), 5126, 'MAT4', NAMES.length);

  const jointNode = (i) => i + 1;
  const nodes = [{ name, children: [1, NAMES.length + 1] }];
  NAMES.forEach((nm, i) => {
    const kids = NAMES.map((_, c) => c).filter((c) => PARENT[c] === i).map(jointNode);
    const r = fit.r[i].map((x) => +x.toFixed(7)), t = fit.t[i].map((x) => +x.toFixed(6));
    nodes.push({ name: nm, translation: t, rotation: r, ...(kids.length ? { children: kids } : {}) });
  });
  nodes.push({ name: name + 'Body', mesh: 0, skin: 0 });

  const animations = clips.map((clip) => {
    const samplers = [], channels = [];
    for (const tr of clip.tracks) {
      const tmin = tr.times[0], tmax = tr.times[tr.times.length - 1];
      const input = accessor(tr.times, 5126, 'SCALAR', tr.times.length, { min: [tmin], max: [tmax] });
      const output = accessor(tr.values, 5126, tr.path === 'rotation' ? 'VEC4' : 'VEC3', tr.times.length);
      samplers.push({ input, output, interpolation: 'LINEAR' });
      channels.push({ sampler: samplers.length - 1, target: { node: jointNode(NAMES.indexOf(tr.bone)), path: tr.path } });
    }
    return { name: clip.name, samplers, channels };
  });

  const json = {
    asset: { version: '2.0', generator: 'lantern-cards tools/rig' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    meshes: [{ name: name + 'Body', primitives: [{ attributes: { POSITION, JOINTS_0, WEIGHTS_0 }, indices, mode: 4 }] }],
    skins: [{ joints: NAMES.map((_, i) => jointNode(i)), inverseBindMatrices: ibm, skeleton: 1 }],
    animations,
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: offset }],
  };
  let js = Buffer.from(JSON.stringify(json));
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const bin = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  fs.writeFileSync(file, Buffer.concat([header, jh, js, bh, bin]));
  return 12 + 8 + js.length + 8 + bin.length;
}
