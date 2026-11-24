// Sound effects and the koto-like background tune, synthesized at start-up (port of AshenVow.Synth).
const RATE = 22050;

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noise(name, duration, volume, low, high) {
  const count = Math.ceil(duration * RATE);
  const data = new Float32Array(count);
  const rng = seeded(name.length * 71);
  let state = 0;
  for (let i = 0; i < count; i++) {
    const t = i / count;
    const cutoff = low + (high - low) * Math.sin(t * Math.PI);
    const a = Math.min(1, Math.max(0, (cutoff * 2 * Math.PI) / RATE));
    state += a * ((rng() * 2 - 1) - state);
    data[i] = state * Math.sin(t * Math.PI) * volume * 2.4;
  }
  return data;
}

function impact(name, frequency, duration, volume) {
  const count = Math.ceil(duration * RATE);
  const data = new Float32Array(count);
  const rng = seeded(name.length * 53);
  let phase = 0;
  for (let i = 0; i < count; i++) {
    const t = i / count;
    phase += (frequency * (1 - t * 0.6)) / RATE;
    const tone = Math.sin(phase * Math.PI * 2);
    const n = (rng() * 2 - 1) * Math.exp(-t * 18);
    data[i] = (tone * 0.8 + n * 0.5) * Math.pow(1 - t, 2.2) * volume;
  }
  return data;
}

function tone(notes, duration, volume) {
  const count = Math.ceil(duration * RATE);
  const data = new Float32Array(count);
  const spacing = notes.length > 1 ? Math.round((count * 0.45) / (notes.length - 1)) : 0;
  notes.forEach((note, n) => {
    const start = n * spacing;
    const step = (note * Math.PI * 2) / RATE;
    for (let i = start; i < count; i++) {
      const j = i - start;
      const t = j / (count - start);
      data[i] += (Math.sin(j * step) + Math.sin(j * step * 2) * 0.2) * Math.min(1, j / 40) * Math.pow(1 - t, 2.3) * volume;
    }
  });
  return data;
}

function pluck(data, start, frequency, length, volume) {
  const count = Math.min(Math.ceil(length * RATE), data.length - start);
  const step = (frequency * Math.PI * 2) / RATE;
  for (let i = 0; i < count; i++) {
    const time = i / RATE;
    const t = Math.sin(i * step) + Math.sin(i * step * 2) * 0.3 + Math.sin(i * step * 3) * 0.08;
    data[start + i] += t * Math.min(1, i / 30) * Math.exp((-time * 5) / length) * (1 - i / count) * volume;
  }
}

function music() {
  const beat = 0.42, beats = 64;
  const total = Math.round(beats * beat * RATE);
  const beatSamples = Math.round(beat * RATE);
  const data = new Float32Array(total);
  const chords = [
    [146.83, 220, 293.66, 369.99],
    [123.47, 185, 246.94, 293.66],
    [98, 196, 246.94, 293.66],
    [110, 220, 277.18, 329.63],
  ];
  const section = Math.floor(total / chords.length);
  chords.forEach((chord, c) => {
    for (let i = 0; i < section; i++) {
      const t = i / section;
      const envelope = Math.sqrt(Math.sin(t * Math.PI));
      let sum = 0;
      for (const f of chord) sum += Math.sin((i * f * Math.PI * 2) / RATE);
      data[c * section + i] += sum * envelope * 0.028;
    }
    for (let b = 0; b < 16; b++) {
      const start = c * section + b * beatSamples;
      if (start < total) pluck(data, start, chord[b % 4] * 2, 0.6, 0.035);
    }
  });
  const scale = [587.33, 659.25, 739.99, 880, 987.77, 1174.66];
  const melody = [
    3, -1, 4, 5, 4, 3, 1, -1, 2, 3, 2, 1, 0, -1, 1, 2,
    3, -1, 5, 4, 3, 1, 2, -1, 1, 0, 1, 2, 3, -1, -1, -1,
    4, -1, 5, 4, 3, -1, 2, 3, 4, 3, 2, 1, 2, -1, 3, -1,
    5, 4, 3, 2, 3, -1, 1, 2, 0, -1, 1, -1, 0, -1, -1, -1,
  ];
  melody.forEach((m, b) => {
    if (m >= 0 && b < beats) pluck(data, b * beatSamples, scale[m], 0.85, 0.085);
  });
  return data;
}

export class Sound {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.muted = localStorage.getItem('lanterncards.muted') === '1';
  }

  /** Browsers only allow audio after a click, so this runs on the first interaction. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(this.ctx.destination);
    const make = (data) => {
      const b = this.ctx.createBuffer(1, data.length, RATE);
      b.copyToChannel(data, 0);
      return b;
    };
    const defs = {
      swing: noise('swing', 0.17, 0.24, 1800, 4600),
      hit: impact('hit', 300, 0.12, 0.42),
      crit: tone([880, 1320, 1760], 0.24, 0.26),
      block: tone([1760, 2637], 0.2, 0.24),
      skill: tone([523, 784, 1047], 0.3, 0.2),
      jump: tone([440, 660], 0.14, 0.14),
      slam: impact('slam', 90, 0.46, 0.72),
      death: tone([1047, 784, 1319, 1568], 0.42, 0.2),
      potion: tone([523, 659, 784, 1047], 0.36, 0.2),
      level: tone([523, 659, 784, 1047, 1319, 1568], 1, 0.26),
      quest: tone([659, 784, 988, 1319], 0.7, 0.22),
      lantern: tone([392, 587, 784, 1175, 1568], 1.3, 0.24),
      coin: tone([1319, 1976], 0.18, 0.18),
      ui: tone([988], 0.07, 0.13),
    };
    for (const [k, v] of Object.entries(defs)) this.buffers[k] = make(v);
    const src = this.ctx.createBufferSource();
    src.buffer = make(music());
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = 0.3;
    src.connect(g).connect(this.master);
    src.start();
  }

  play(name) {
    if (!this.ctx || !this.buffers[name]) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[name];
    src.playbackRate.value = 0.96 + Math.random() * 0.09;
    src.connect(this.master);
    src.start();
  }

  toggleMute() {
    this.muted = !this.muted;
    localStorage.setItem('lanterncards.muted', this.muted ? '1' : '0');
    if (this.master) this.master.gain.value = this.muted ? 0 : 1;
    return this.muted;
  }
}
