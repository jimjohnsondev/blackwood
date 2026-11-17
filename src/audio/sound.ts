// Sound effects and the music, made from square waves and noise with Web Audio.
// Browsers only allow sound after the player touches something, so `unlock()`
// is called on the first input.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let musicBus: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let enabled = true;
let music = true;

// Sound and music choices are remembered between visits.
const SETTINGS_KEY = 'blackwood-settings';
try {
  const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
  if (saved.sound === false) enabled = false;
  if (saved.music === false) music = false;
} catch {
  // no storage: defaults
}
function remember(): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ sound: enabled, music }));
  } catch {
    // nothing to do
  }
}

export function unlock(): void {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume();
    return;
  }
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = enabled ? 0.25 : 0;
  master.connect(ctx.destination);
  musicBus = ctx.createGain();
  musicBus.gain.value = music ? 0.25 : 0;
  musicBus.connect(ctx.destination);
  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
}

export function setSound(on: boolean): void {
  enabled = on;
  if (master) master.gain.value = on ? 0.25 : 0;
  remember();
}

export function setMusic(on: boolean): void {
  music = on;
  if (musicBus) musicBus.gain.value = on ? 0.25 : 0;
  remember();
}

export function musicOn(): boolean {
  return music;
}

export function soundOn(): boolean {
  return enabled;
}

/** One square-wave note. Frequencies in Hz, times in seconds from now. */
function tone(freq: number, dur: number, opts: { at?: number; vol?: number; slide?: number; type?: OscillatorType; music?: boolean } = {}): void {
  const out = opts.music ? musicBus : master;
  if (!ctx || !out || !(opts.music ? music : enabled)) return;
  const t = ctx.currentTime + (opts.at ?? 0);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = opts.type ?? 'square';
  osc.frequency.setValueAtTime(freq, t);
  if (opts.slide) osc.frequency.exponentialRampToValueAtTime(opts.slide, t + dur);
  const vol = opts.vol ?? 0.3;
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(gain).connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(dur: number, opts: { at?: number; vol?: number; filter?: number } = {}): void {
  if (!ctx || !master || !noiseBuffer || !enabled) return;
  const t = ctx.currentTime + (opts.at ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = opts.filter ?? 3000;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(opts.vol ?? 0.3, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter).connect(gain).connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

const EFFECTS: Record<string, () => void> = {
  step: () => noise(0.03, { vol: 0.05, filter: 1200 }),
  hit: () => { noise(0.08, { vol: 0.35, filter: 2500 }); tone(110, 0.08, { vol: 0.2, slide: 60 }); },
  miss: () => tone(300, 0.08, { vol: 0.12, slide: 200 }),
  hurt: () => { tone(160, 0.15, { vol: 0.3, slide: 70 }); noise(0.1, { vol: 0.2, filter: 900 }); },
  shoot: () => noise(0.12, { vol: 0.2, filter: 5000 }),
  spell: () => tone(400, 0.25, { vol: 0.15, slide: 1200 }),
  coin: () => { tone(988, 0.06, { vol: 0.15 }); tone(1319, 0.12, { at: 0.06, vol: 0.15 }); },
  door: () => { noise(0.06, { vol: 0.2, filter: 600 }); tone(90, 0.1, { vol: 0.15 }); },
  click: () => tone(1800, 0.03, { vol: 0.1 }),
  equip: () => noise(0.05, { vol: 0.15, filter: 4000 }),
  drink: () => { tone(500, 0.1, { vol: 0.1, slide: 700 }); tone(600, 0.1, { at: 0.1, vol: 0.1, slide: 800 }); },
  rest: () => { tone(392, 0.3, { vol: 0.1 }); tone(330, 0.4, { at: 0.3, vol: 0.1 }); },
  levelup: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.15, { at: i * 0.1, vol: 0.18 })),
  quest: () => [392, 523, 659].forEach((f, i) => tone(f, 0.2, { at: i * 0.15, vol: 0.15 })),
  fanfare: () => [523, 523, 523, 698, 880].forEach((f, i) => tone(f, i === 4 ? 0.5 : 0.12, { at: i * 0.13, vol: 0.18 })),
  death: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, { at: i * 0.25, vol: 0.2 })),
  move: () => tone(880, 0.025, { vol: 0.06 }),
  select: () => { tone(660, 0.05, { vol: 0.12 }); tone(990, 0.08, { at: 0.05, vol: 0.12 }); },
  back: () => tone(440, 0.06, { vol: 0.1, slide: 330 }),
  alarm: () => [880, 660, 880, 660].forEach((f, i) => tone(f, 0.12, { at: i * 0.13, vol: 0.16 })),
};

export function sfx(name: string): void {
  EFFECTS[name]?.();
}

// ---------- music ----------
// Short looping tunes, one per kind of place. Notes are MIDI numbers, 0 = rest.
// Each tune is a melody (one note per step) over a bass line (one note per four steps).

export type Tune = 'title' | 'village' | 'road' | 'night' | 'dungeon' | 'blight' | 'boss' | 'ending';

interface Song { melody: number[]; bass: number[]; step: number; vol: number; wave?: OscillatorType }

const SONGS: Record<Tune, Song> = {
  // A slow minor-key melody over a walking bass.
  title: {
    melody: [
      69, 0, 72, 71, 69, 0, 64, 0, 65, 0, 69, 67, 65, 64, 62, 0,
      64, 0, 69, 0, 72, 74, 76, 0, 74, 72, 71, 0, 69, 0, 0, 0,
      76, 0, 74, 72, 71, 0, 72, 74, 72, 71, 69, 0, 68, 0, 64, 0,
      65, 0, 67, 69, 71, 0, 72, 71, 69, 0, 68, 0, 69, 0, 0, 0,
    ],
    bass: [45, 52, 45, 52, 41, 48, 41, 48, 43, 50, 43, 50, 40, 47, 40, 47],
    step: 0.2, vol: 0.09,
  },
  // Home: warm and unhurried, in a major key.
  village: {
    melody: [
      67, 0, 71, 0, 74, 0, 71, 0, 72, 0, 69, 0, 67, 0, 0, 0,
      66, 0, 69, 0, 74, 0, 72, 0, 71, 0, 69, 0, 67, 0, 0, 0,
      71, 0, 74, 0, 79, 0, 78, 0, 76, 0, 72, 0, 74, 0, 0, 0,
      72, 0, 71, 0, 69, 0, 66, 0, 67, 0, 0, 0, 0, 0, 0, 0,
    ],
    bass: [43, 50, 48, 43, 50, 45, 43, 43, 43, 52, 48, 50, 48, 50, 43, 43],
    step: 0.24, vol: 0.06, wave: 'triangle',
  },
  // The open road by day: a walking tune.
  road: {
    melody: [
      62, 0, 65, 67, 69, 0, 67, 65, 62, 0, 60, 0, 62, 0, 0, 0,
      65, 0, 69, 72, 74, 0, 72, 69, 67, 0, 65, 0, 67, 0, 0, 0,
      69, 0, 72, 74, 77, 0, 76, 74, 72, 0, 69, 0, 67, 0, 65, 0,
      62, 0, 65, 67, 65, 0, 62, 60, 62, 0, 0, 0, 0, 0, 0, 0,
    ],
    bass: [38, 45, 38, 45, 41, 48, 43, 50, 41, 48, 45, 43, 38, 45, 38, 38],
    step: 0.21, vol: 0.06,
  },
  // The road by night: few notes, long silences.
  night: {
    melody: [
      69, 0, 0, 0, 0, 0, 72, 0, 0, 0, 71, 0, 0, 0, 0, 0,
      64, 0, 0, 0, 0, 0, 0, 0, 67, 0, 0, 0, 65, 0, 0, 0,
      69, 0, 0, 0, 0, 0, 76, 0, 0, 0, 74, 0, 0, 0, 0, 0,
      72, 0, 0, 0, 68, 0, 0, 0, 69, 0, 0, 0, 0, 0, 0, 0,
    ],
    bass: [33, 0, 33, 0, 29, 0, 31, 0, 33, 0, 36, 0, 28, 0, 33, 0],
    step: 0.3, vol: 0.05, wave: 'triangle',
  },
  // Underground: low, close, creeping by half-steps.
  dungeon: {
    melody: [
      52, 0, 0, 53, 0, 0, 52, 0, 0, 0, 47, 0, 0, 0, 0, 0,
      52, 0, 0, 55, 0, 0, 54, 0, 0, 0, 51, 0, 0, 0, 0, 0,
      59, 0, 0, 58, 0, 0, 55, 0, 0, 0, 53, 0, 52, 0, 0, 0,
      47, 0, 0, 0, 48, 0, 0, 0, 47, 0, 0, 0, 0, 0, 0, 0,
    ],
    bass: [28, 28, 28, 28, 27, 27, 28, 28, 31, 31, 29, 29, 28, 28, 28, 28],
    step: 0.28, vol: 0.07,
  },
  // The Blight: a sour drone that never resolves.
  blight: {
    melody: [
      57, 0, 0, 0, 63, 0, 0, 0, 0, 0, 62, 0, 0, 0, 0, 0,
      56, 0, 0, 0, 0, 0, 63, 0, 0, 0, 0, 0, 58, 0, 0, 0,
      57, 0, 0, 0, 66, 0, 0, 0, 65, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 62, 0, 0, 0, 56, 0, 57, 0, 0, 0, 0, 0, 0, 0,
    ],
    bass: [33, 33, 39, 33, 32, 32, 39, 34, 33, 33, 30, 30, 33, 32, 33, 33],
    step: 0.32, vol: 0.06, wave: 'sawtooth',
  },
  // A lieutenant or the villain: fast and driving.
  boss: {
    melody: [
      64, 64, 0, 67, 0, 64, 71, 0, 70, 0, 67, 0, 64, 0, 62, 0,
      64, 64, 0, 67, 0, 64, 72, 0, 71, 0, 67, 0, 66, 0, 64, 0,
      76, 0, 75, 0, 71, 0, 67, 0, 72, 0, 71, 0, 67, 0, 64, 0,
      62, 62, 0, 64, 0, 66, 67, 0, 71, 0, 70, 0, 64, 0, 0, 0,
    ],
    bass: [40, 40, 40, 43, 40, 40, 45, 43, 36, 36, 38, 38, 35, 35, 40, 40],
    step: 0.13, vol: 0.08,
  },
  // The ending: the title tune's shape, turned to major.
  ending: {
    melody: [
      69, 0, 73, 71, 69, 0, 64, 0, 66, 0, 69, 68, 66, 64, 62, 0,
      64, 0, 69, 0, 73, 74, 76, 0, 74, 73, 71, 0, 69, 0, 0, 0,
      76, 0, 74, 73, 71, 0, 73, 74, 73, 71, 69, 0, 68, 0, 64, 0,
      66, 0, 68, 69, 71, 0, 73, 71, 69, 0, 68, 0, 69, 0, 0, 0,
    ],
    bass: [45, 52, 45, 52, 42, 49, 38, 45, 45, 52, 38, 45, 40, 47, 45, 45],
    step: 0.22, vol: 0.08, wave: 'triangle',
  },
};

let musicTimer: number | undefined;
let nextTime = 0;
let stepIndex = 0;
let current: Tune | null = null;

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** Start a tune, or carry on if it's already the one playing. */
export function playMusic(tune: Tune = 'title'): void {
  if (!ctx) return;
  if (current === tune && musicTimer !== undefined) return;
  stopMusic();
  current = tune;
  nextTime = ctx.currentTime + 0.4; // a breath between tunes
  stepIndex = 0;
  musicTimer = window.setInterval(schedule, 50);
}

export function stopMusic(): void {
  if (musicTimer !== undefined) clearInterval(musicTimer);
  musicTimer = undefined;
  current = null;
}

function schedule(): void {
  if (!ctx || !current) return;
  const song = SONGS[current];
  // If the tab was asleep, don't play the missed notes all at once.
  if (nextTime < ctx.currentTime - 0.5) nextTime = ctx.currentTime + 0.1;
  while (nextTime < ctx.currentTime + 0.3) {
    const at = Math.max(0, nextTime - ctx.currentTime);
    const note = song.melody[stepIndex % song.melody.length];
    if (note) tone(hz(note), song.step * 1.6, { at, vol: song.vol, type: song.wave, music: true });
    if (stepIndex % 4 === 0) {
      const bass = song.bass[(stepIndex / 4) % song.bass.length];
      if (bass) tone(hz(bass), song.step * 3.5, { at, vol: song.vol * 0.8, type: 'triangle', music: true });
    }
    nextTime += song.step;
    stepIndex++;
  }
}
