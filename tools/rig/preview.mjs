// Renders a rigged heroine .glb in several clips (software skinning), to check the rig without a browser.
// node tools/rig/preview.mjs <id> <out.png> [view] [clip@time,...]   ("!" after an item colours the surface by bone)
import { loadRig, pose } from './pose.mjs';
import { render, savePng } from './raster.mjs';

const [id, out, view = 'front', list = 'bind!,pose@0.6,attack1@0.2,cleave@0.6,spell@0.25'] = process.argv.slice(2);
const rig = loadRig(id);
// One colour per bone: torso warm, head cyan, right side blue/purple, left side green/yellow.
const PALETTE = [[230,70,70],[240,140,60],[250,200,60],[200,120,40],[170,90,200],[60,200,200],[90,90,200],[60,120,255],[120,60,220],[160,160,255],[80,150,80],[60,210,90],[170,230,60],[230,240,120],[90,40,120],[140,80,160],[200,140,220],[250,190,240],[40,100,60],[110,170,110],[160,210,160],[210,240,210],[128,128,128]];
const colors = new Uint8Array(rig.pos.length);
for (let v = 0; v < rig.pos.length / 3; v++) colors.set(PALETTE[rig.joints[v * 4] % PALETTE.length], v * 3);
const imgs = list.split(',').map((item) => {
  const paint = item.endsWith('!');
  const [clip, t] = item.replace('!', '').split('@');
  const p = pose(rig, clip, Number(t || 0));
  return render(p.pos, rig.index, { view, px: +(process.env.PX || 520), box: [-0.75, -0.05, 0.75, 1.9], joints: p.joints, bones: rig.bones, grid: 0.1, colors: paint ? colors : null });
});
await savePng(imgs, out);
console.log('wrote', out);
