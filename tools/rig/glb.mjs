import fs from 'fs';
export function readGlb(path) {
  const b = fs.readFileSync(path);
  const jl = b.readUInt32LE(12);
  const json = JSON.parse(b.toString('utf8', 20, 20 + jl));
  const bo = 20 + jl;
  const bl = b.readUInt32LE(bo);
  const bin = b.subarray(bo + 8, bo + 8 + bl);
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  const ctor = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array, 5122: Int16Array, 5120: Int8Array };
  function accessor(i) {
    const a = json.accessors[i]; const bv = json.bufferViews[a.bufferView];
    const n = comps[a.type], C = ctor[a.componentType];
    const off = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const stride = bv.byteStride || n * C.BYTES_PER_ELEMENT;
    const out = new C(a.count * n);
    const view = new DataView(bin.buffer, bin.byteOffset + off);
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) {
      const p = k * stride + c * C.BYTES_PER_ELEMENT;
      out[k * n + c] = C === Float32Array ? view.getFloat32(p, true) : C === Uint32Array ? view.getUint32(p, true) : C === Uint16Array ? view.getUint16(p, true) : C === Int16Array ? view.getInt16(p, true) : C === Int8Array ? view.getInt8(p) : view.getUint8(p);
    }
    return { data: out, n, normalized: a.normalized, type: a.componentType, min: a.min, max: a.max };
  }
  return { json, bin, accessor };
}
