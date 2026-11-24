// Lists the heaviest meshes, textures and node usage in a .glb (used to keep exported arenas small).
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const buf = readFileSync(file);
const jsonLength = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8'));
const views = gltf.bufferViews || [];
const accessors = gltf.accessors || [];
const bytesOf = (a) => views[accessors[a].bufferView]?.byteLength ?? 0;

const uses = new Map();
for (const n of gltf.nodes) if (n.mesh !== undefined) uses.set(n.mesh, (uses.get(n.mesh) || 0) + 1);

const meshes = (gltf.meshes || []).map((m, i) => {
  let bytes = 0, verts = 0;
  const seen = new Set();
  for (const p of m.primitives) {
    for (const a of Object.values(p.attributes)) if (!seen.has(a)) { seen.add(a); bytes += bytesOf(a); }
    if (p.indices !== undefined) bytes += bytesOf(p.indices);
    verts = accessors[p.attributes.POSITION].count;
  }
  const mats = m.primitives.map((p) => gltf.materials?.[p.material]?.name).join('+');
  return { i, name: m.name, verts, kb: Math.round(bytes / 1024), uses: uses.get(i) || 0, mats };
}).sort((a, b) => b.kb - a.kb);

console.log('file MB', (buf.length / 1048576).toFixed(1), 'nodes', gltf.nodes.length, 'meshes', meshes.length);
for (const m of meshes.slice(0, Number(process.argv[3] || 12))) console.log(`${m.kb} KB  verts=${m.verts}  uses=${m.uses}  ${m.name}  [${m.mats}]`);
const images = (gltf.images || []).map((im) => ({ name: im.name, kb: Math.round(views[im.bufferView].byteLength / 1024), mime: im.mimeType })).sort((a, b) => b.kb - a.kb);
for (const im of images.slice(0, 8)) console.log(`img ${im.kb} KB ${im.name} ${im.mime}`);
