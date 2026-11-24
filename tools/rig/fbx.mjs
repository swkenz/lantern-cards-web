// Minimal binary FBX reader: returns a node tree with properties.
import fs from 'fs';
import zlib from 'zlib';
export function readFbx(path) {
  const b = fs.readFileSync(path);
  if (b.toString('latin1', 0, 20) !== 'Kaydara FBX Binary  ') throw new Error('not binary fbx');
  const version = b.readUInt32LE(23);
  const wide = version >= 7500;
  let o = 27;
  const rd = () => { const v = wide ? Number(b.readBigUInt64LE(o)) : b.readUInt32LE(o); o += wide ? 8 : 4; return v; };
  function prop() {
    const t = String.fromCharCode(b[o]); o += 1;
    switch (t) {
      case 'Y': { const v = b.readInt16LE(o); o += 2; return v; }
      case 'C': { const v = b[o] !== 0; o += 1; return v; }
      case 'I': { const v = b.readInt32LE(o); o += 4; return v; }
      case 'F': { const v = b.readFloatLE(o); o += 4; return v; }
      case 'D': { const v = b.readDoubleLE(o); o += 8; return v; }
      case 'L': { const v = Number(b.readBigInt64LE(o)); o += 8; return v; }
      case 'S': case 'R': { const n = b.readUInt32LE(o); o += 4; const v = t === 'S' ? b.toString('utf8', o, o + n) : b.subarray(o, o + n); o += n; return v; }
      case 'f': case 'd': case 'l': case 'i': case 'b': {
        const len = b.readUInt32LE(o), enc = b.readUInt32LE(o + 4), clen = b.readUInt32LE(o + 8); o += 12;
        let data = b.subarray(o, o + clen); o += clen;
        if (enc === 1) data = zlib.inflateSync(data);
        const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        if (t === 'f') return new Float32Array(ab, 0, len);
        if (t === 'd') return new Float64Array(ab, 0, len);
        if (t === 'i') return new Int32Array(ab, 0, len);
        if (t === 'l') return new BigInt64Array(ab, 0, len);
        return new Uint8Array(ab, 0, len);
      }
      default: throw new Error('bad prop ' + t + ' at ' + o);
    }
  }
  function node() {
    const end = rd(), np = rd(); rd();
    const nl = b[o]; o += 1;
    if (end === 0) return null;
    const name = b.toString('latin1', o, o + nl); o += nl;
    const props = [];
    for (let i = 0; i < np; i++) props.push(prop());
    const children = [];
    while (o < end) { const c = node(); if (!c) break; children.push(c); }
    o = end;
    return { name, props, children };
  }
  const root = [];
  while (o < b.length - 200) { const n = node(); if (!n) break; root.push(n); }
  return { version, root };
}
export const child = (n, name) => n.children.find((c) => c.name === name);
export const childs = (n, name) => n.children.filter((c) => c.name === name);
export function props70(n) {
  const p = child(n, 'Properties70'); const out = {};
  if (p) for (const c of p.children) out[c.props[0]] = c.props.slice(4);
  return out;
}
