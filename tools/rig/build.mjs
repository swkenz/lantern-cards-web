// Rigs the heroine sculpts with Akari's skeleton and clips: node tools/rig/build.mjs [id ...]
// Reads assets/models/heroines/<id>.fbx and tools/rig/joints.json, writes assets/models/heroines/<id>.glb.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadHeroine } from './mesh.mjs';
import { fitSkeleton } from './fit.mjs';
import { computeWeights } from './weights.mjs';
import { readClips, retarget, poseClip } from './anim.mjs';
import { writeGlb } from './writeglb.mjs';
import { NAMES } from './skeleton.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const config = JSON.parse(fs.readFileSync(path.join(here, 'joints.json'), 'utf8'));
const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(config);
const akari = readClips(path.join(root, 'assets/models/akari.glb'));

for (const id of ids) {
  const t0 = Date.now();
  const J = config[id];
  const mesh = loadHeroine(path.join(root, `assets/models/heroines/${id}.fbx`));
  const fit = fitSkeleton(J);
  const off = NAMES.map((n, i) => [n, fit.err[i]]).filter(([, e]) => e > 0.015).map(([n, e]) => `${n} ${(e * 100).toFixed(1)}cm`);
  console.log(`${id}: ${mesh.count} verts, leg scale ${fit.legScale.toFixed(3)}${off.length ? ', joints moved: ' + off.join(', ') : ''}`);
  const { joints, weights } = computeWeights(mesh, fit, { log: (s) => console.log('  ' + s) });
  const clips = akari.map((c) => retarget(c, fit, J));
  clips.push(poseClip(akari.find((c) => c.name === 'idle'), fit, J, 'pose', 1));
  clips.push(poseClip(akari.find((c) => c.name === 'combat_idle'), fit, J, 'pose_combat', 1));
  const bytes = writeGlb(path.join(root, `assets/models/heroines/${id}.glb`), { mesh, joints, weights, fit, clips, name: id });
  console.log(`  wrote ${id}.glb ${(bytes / 1048576).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
