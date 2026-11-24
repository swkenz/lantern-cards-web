// Akari's skeleton as exported from Unity (assets/models/akari.glb). Every rest rotation is identity,
// so a bone's rest offset is also its direction in world space.
export const SKEL = [
  ['Hips', -1, [0, 0.98, -0.02]], ['Spine', 0, [0, 0.1, 0]], ['Chest', 1, [0, 0.14, 0.01]], ['UpperChest', 2, [0, 0.11, -0.005]],
  ['Neck', 3, [0, 0.12, -0.02]], ['Head', 4, [0, 0.08, 0.005]],
  ['RightShoulder', 3, [-0.05, 0.075, -0.015]], ['RightUpperArm', 6, [-0.075, -0.018, -0.005]], ['RightLowerArm', 7, [-0.13, -0.153, 0]], ['RightHand', 8, [-0.145, -0.153, 0.005]],
  ['LeftShoulder', 3, [0.05, 0.075, -0.015]], ['LeftUpperArm', 10, [0.075, -0.018, -0.005]], ['LeftLowerArm', 11, [0.13, -0.153, 0]], ['LeftHand', 12, [0.145, -0.153, 0.005]],
  ['RightUpperLeg', 0, [-0.085, -0.06, 0.005]], ['RightLowerLeg', 14, [0.007, -0.4, 0.005]], ['RightFoot', 15, [0.01, -0.395, -0.04]], ['RightToes', 16, [0, -0.1, 0.11]],
  ['LeftUpperLeg', 0, [0.085, -0.06, 0.005]], ['LeftLowerLeg', 18, [-0.007, -0.4, 0.005]], ['LeftFoot', 19, [-0.01, -0.395, -0.04]], ['LeftToes', 20, [0, -0.1, 0.11]],
  ['SkirtRoot', 0, [0, -0.05, 0]],
];
export const NAMES = SKEL.map((s) => s[0]);
export const PARENT = SKEL.map((s) => s[1]);
export const OFFSET = SKEL.map((s) => s[2]);
export const IDX = Object.fromEntries(NAMES.map((n, i) => [n, i]));
/** Lines to draw for previews: [parent, child]. */
export const BONES = SKEL.map((s, i) => [s[1], i]).filter(([p, i]) => p >= 0 && NAMES[i] !== 'SkirtRoot');
/** Extra targets that only orient a bone (they are not joints). */
export const TIPS = { Head: 'HeadTop', RightHand: 'RightHandTip', LeftHand: 'LeftHandTip' };
