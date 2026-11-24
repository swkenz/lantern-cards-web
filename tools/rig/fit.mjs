// Fits Akari's skeleton into a heroine sculpt.
// Rest pose (what Akari's clips animate): Akari's bone directions with the heroine's bone lengths.
// Bind pose (where the mesh is attached): the same skeleton bent so every joint sits on the sculpt.
import { NAMES, PARENT, OFFSET, IDX, TIPS } from './skeleton.mjs';
import * as M from './math.mjs';

// The child each bone points at (null: the bone just follows its parent).
const MAIN_CHILD = {
  Spine: 'Chest', Chest: 'UpperChest', Neck: 'Head', Head: 'HeadTop',
  RightShoulder: 'RightUpperArm', RightUpperArm: 'RightLowerArm', RightLowerArm: 'RightHand', RightHand: 'RightHandTip',
  LeftShoulder: 'LeftUpperArm', LeftUpperArm: 'LeftLowerArm', LeftLowerArm: 'LeftHand', LeftHand: 'LeftHandTip',
  RightUpperLeg: 'RightLowerLeg', RightLowerLeg: 'RightFoot', RightFoot: 'RightToes',
  LeftUpperLeg: 'LeftLowerLeg', LeftLowerLeg: 'LeftFoot', LeftFoot: 'LeftToes',
};
// Rest direction of the virtual tips.
const TIP_DIR = { HeadTop: [0, 1, 0.05], RightHandTip: OFFSET[IDX.RightHand], LeftHandTip: OFFSET[IDX.LeftHand] };
const restDir = (name) => M.norm(TIP_DIR[name] || OFFSET[IDX[name]]);

export function fitSkeleton(J) {
  const n = NAMES.length;
  const P = [], W = [], t = [], r = [];
  for (let i = 0; i < n; i++) {
    const name = NAMES[i], p = PARENT[i];
    if (p < 0) { t[i] = J.Hips.slice(); P[i] = J.Hips.slice(); }
    else {
      const branch = (NAMES[p] === 'Hips' && name !== 'Spine') || (NAMES[p] === 'UpperChest' && name !== 'Neck');
      if (name === 'SkirtRoot') t[i] = OFFSET[i].slice();
      // Leg and shoulder roots sit exactly where they were placed (in the parent's frame).
      else if (branch) t[i] = M.qrot(M.qconj(W[p]), M.sub(J[name], P[p]));
      else if (!t[i]) t[i] = M.scale(M.norm(OFFSET[i]), M.len(M.sub(J[name], J[NAMES[p]])));
      P[i] = M.add(P[p], M.qrot(W[p], t[i]));
    }
    const Wp = p < 0 ? M.QI : W[p];
    if (name === 'Hips' || name === 'UpperChest') {
      // Orientation from the spine direction and the left-right axis of the legs / shoulders.
      const [up, l, rgt] = name === 'Hips' ? ['Spine', 'LeftUpperLeg', 'RightUpperLeg'] : ['Neck', 'LeftShoulder', 'RightShoulder'];
      const fRest = M.frame(OFFSET[IDX[up]], M.sub(OFFSET[IDX[l]], OFFSET[IDX[rgt]]));
      const fTarget = M.frame(M.sub(J[up], P[i]), M.sub(J[l], J[rgt]));
      W[i] = M.qnorm(M.qmul(fTarget, M.qconj(fRest)));
    } else if (MAIN_CHILD[name]) {
      const c = MAIN_CHILD[name];
      const to = M.sub(J[c], P[i]);
      if (IDX[c] !== undefined) t[IDX[c]] = M.scale(restDir(c), M.len(to));
      const cur = M.norm(M.qrot(Wp, restDir(c)));
      W[i] = M.qnorm(M.qmul(M.qFromUnit(cur, M.norm(to)), Wp));
    } else W[i] = Wp;
    r[i] = M.qnorm(M.qmul(M.qconj(Wp), W[i]));
  }
  const ibm = P.map((p, i) => M.matInvRigid(M.mat(W[i], p)));
  const legLen = (s) => M.len(t[IDX[s + 'LowerLeg']]) + M.len(t[IDX[s + 'Foot']]);
  const legScale = (legLen('Left') + legLen('Right')) / 2 / (M.len(OFFSET[IDX.LeftLowerLeg]) + M.len(OFFSET[IDX.LeftFoot]));
  // Segments that "own" the surface around them, for skin weights.
  const seg = {};
  const at = (k) => P[IDX[k]];
  seg.Hips = [M.lerp3(at('LeftUpperLeg'), at('RightUpperLeg'), 0.5), at('Spine')];
  seg.Spine = [at('Spine'), at('Chest')];
  seg.Chest = [at('Chest'), at('UpperChest')];
  seg.UpperChest = [at('UpperChest'), at('Neck')];
  seg.Neck = [at('Neck'), at('Head')];
  seg.Head = [at('Head'), J.HeadTop];
  for (const s of ['Left', 'Right']) {
    seg[s + 'Shoulder'] = [at(s + 'Shoulder'), at(s + 'UpperArm')];
    seg[s + 'UpperArm'] = [at(s + 'UpperArm'), at(s + 'LowerArm')];
    seg[s + 'LowerArm'] = [at(s + 'LowerArm'), at(s + 'Hand')];
    seg[s + 'Hand'] = [at(s + 'Hand'), J[s + 'HandTip']];
    seg[s + 'UpperLeg'] = [at(s + 'UpperLeg'), at(s + 'LowerLeg')];
    seg[s + 'LowerLeg'] = [at(s + 'LowerLeg'), at(s + 'Foot')];
    seg[s + 'Foot'] = [at(s + 'Foot'), at(s + 'Toes')];
    seg[s + 'Toes'] = [at(s + 'Toes'), M.add(at(s + 'Toes'), M.scale(M.norm(M.sub(at(s + 'Toes'), at(s + 'Foot'))), 0.05))];
  }
  const err = NAMES.map((nm, i) => (J[nm] ? M.len(M.sub(J[nm], P[i])) : 0));
  return { P, W, t, r, ibm, legScale, seg, err };
}
