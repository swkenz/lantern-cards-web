// Draws the sculpt with the joints from joints.json on top, to place them: node tools/rig/joints-view.mjs <id> <out.png> [front,side] [x0 y0 x1 y1] [px]
// Views: front (from +Z), side (from +X), back, right, top. Coordinates: metres, 1.75 m tall, feet at y = 0, facing +Z.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadHeroine } from './mesh.mjs';
import { render, savePng } from './raster.mjs';
import { BONES, NAMES } from './skeleton.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const [id, out, views = 'front,side', x0 = -0.6, y0 = -0.02, x1 = 0.6, y1 = 1.8, px = 900] = process.argv.slice(2);
const m = loadHeroine(path.resolve(here, `../../assets/models/heroines/${id}.fbx`));
const J = JSON.parse(fs.readFileSync(path.join(here, 'joints.json'), 'utf8'))[id];
const joints = J ? NAMES.map((n) => J[n]) : null;
const box = [+x0, +y0, +x1, +y1];
const imgs = views.split(',').map((view) => render(m.pos, m.index, { view, px: +px, box, joints, bones: joints ? BONES : null, grid: box[3] - box[1] > 1 ? 0.1 : 0.05 }));
await savePng(imgs, out);
console.log('wrote', out);
