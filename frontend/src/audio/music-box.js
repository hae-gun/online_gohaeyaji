/**
 * A music box playing in the nave, synthesized with Web Audio: no sound files, no recordings.
 *
 * The tunes are old hymns and carols whose composers died long ago, so the melodies are in the
 * public domain, and the sound is made here, so there is no recording to license either:
 *   Stille Nacht (Franz Gruber, 1818), Amazing Grace (tune "New Britain", 1829),
 *   Ode an die Freude (Beethoven, 1824, sung in churches as "Joyful, Joyful").
 *
 * Tune format: notes as "G3 A1 G2", a letter with optional # or b, ' for an octave up and , for
 * an octave down from the 4th octave, then the length in eighth notes. `chords` gives the bass
 * note for each bar (after the pickup), struck on the first beat and softly again mid-bar.
 */
const TUNES = [
  {
    name: 'Stille Nacht', eighth: 0.3, bar: 6, pickup: 0,
    notes: `G3 A1 G2 E6 G3 A1 G2 E6 D'4 D'2 B6 C'4 C'2 G6 A4 A2 C'3 B1 A2 G3 A1 G2 E6
            A4 A2 C'3 B1 A2 G3 A1 G2 E6 D'4 D'2 F'3 D'1 B2 C'6 E'6 C'3 G1 E2 G3 F1 D2 C12`,
    chords: 'C C C C G G C C F F C C F F C C G G C C C G C C',
  },
  {
    name: 'Amazing Grace', eighth: 0.3, bar: 6, pickup: 2,
    notes: `D2 G4 B1 G1 B4 A2 G4 E2 D4 D2 G4 B1 G1 B4 A2 D'10 B2
            D'3 B1 D'1 B1 G4 D2 E3 G1 G1 E1 D4 D2 G4 B1 G1 B4 A2 G12`,
    chords: 'G G C G G G D D G G C G G D G G',
  },
  {
    name: 'Ode an die Freude', eighth: 0.26, bar: 8, pickup: 0,
    notes: `E2 E2 F2 G2 G2 F2 E2 D2 C2 C2 D2 E2 E3 D1 D4
            E2 E2 F2 G2 G2 F2 E2 D2 C2 C2 D2 E2 D3 C1 C4
            D2 D2 E2 C2 D2 E1 F1 E2 C2 D2 E1 F1 E2 D2 C2 D2 G,4
            E2 E2 F2 G2 G2 F2 E2 D2 C2 C2 D2 E2 D3 C1 C4`,
    chords: 'C G C G C G C C G C G C C G C C',
  },
];

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** "F#'" -> midi number (C4 = 60), or NaN. */
export function midiOf(name) {
  const m = /^([A-G])([#b]?)([',]*)$/.exec(name);
  if (!m) return NaN;
  let n = 60 + PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  for (const c of m[3]) n += c === "'" ? 12 : -12;
  return n;
}
/** "G3 A1" -> [[midi, eighths], ...] */
export function parseTune(text) {
  return text.trim().split(/\s+/).map((tok) => {
    const m = /^(.+?)(\d+)$/.exec(tok);
    return [midiOf(m[1]), Number(m[2])];
  });
}
export const TUNE_LIST = TUNES;

const UP = 12;                         // a music box sits an octave or two above the voice
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

/**
 * @param {AudioContext} ac
 * @returns {{ setOn(on: boolean): void, setMuted(m: boolean): void }}
 */
export function createMusicBox(ac) {
  // a little room around it: a short reverb made from decaying noise
  const verb = ac.createConvolver();
  const len = Math.floor(ac.sampleRate * 2.6);
  const ir = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  }
  verb.buffer = ir;
  const out = ac.createGain();           // fades in and out with the place
  out.gain.value = 0;
  const wet = ac.createGain(); wet.gain.value = 0.35;
  out.connect(ac.destination);
  out.connect(verb); verb.connect(wet); wet.connect(ac.destination);

  let on = false, muted = false, bus = null, timer = 0, next = 0;
  const LEVEL = 0.5;

  /** One plucked tine: a bright attack that rings down, quicker for high notes. */
  function tine(dest, midi, t, vel) {
    const f = hz(midi);
    const ring = Math.max(0.7, 2.4 - (midi - 72) * 0.05);
    [[1, 1], [2, 0.22], [4.1, 0.06]].forEach(([mul, v], i) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine';
      o.frequency.value = f * mul;
      o.detune.value = i === 0 ? (Math.random() - 0.5) * 6 : 0;
      const decay = i === 0 ? ring : ring * 0.3;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v * vel, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      o.connect(g); g.connect(dest);
      o.start(t); o.stop(t + decay + 0.05);
    });
  }

  /** Schedules a whole tune on `dest` from time t0; returns its length in seconds. */
  function play(tune, dest, t0) {
    const e = tune.eighth;
    let t = t0;
    for (const [midi, n] of parseTune(tune.notes)) {
      tine(dest, midi + UP, t, 0.16);
      t += n * e;
    }
    // bass on each bar after the pickup: root on the first beat, again softly mid-bar
    tune.chords.split(/\s+/).forEach((c, i) => {
      const bt = t0 + (tune.pickup + i * tune.bar) * e;
      const root = midiOf(c) - 12 + UP;
      tine(dest, root, bt, 0.1);
      tine(dest, root + 7, bt + (tune.bar / 2) * e, 0.05);
    });
    return t - t0;
  }

  function loop() {
    if (!on || !bus) return;
    const tune = TUNES[next % TUNES.length];
    next++;
    const dur = play(tune, bus, ac.currentTime + 0.1);
    // a pause between tunes, like a music box being wound again
    timer = setTimeout(loop, (dur + 4 + Math.random() * 4) * 1000);
  }

  function start() {
    // each time a new bus: notes still scheduled on the old one fade out with it
    bus = ac.createGain();
    bus.connect(out);
    out.gain.cancelScheduledValues(ac.currentTime);
    out.gain.setTargetAtTime(muted ? 0 : LEVEL, ac.currentTime, 0.8);
    loop();
  }
  function stop() {
    clearTimeout(timer);
    const old = bus;
    bus = null;
    out.gain.cancelScheduledValues(ac.currentTime);
    out.gain.setTargetAtTime(0, ac.currentTime, 0.5);
    if (old) setTimeout(() => { try { old.disconnect(); } catch (_) { /* gone */ } }, 3000);
  }

  return {
    /** Plays while true (the player is in the nave), fades out when false. */
    setOn(v) {
      if (v === on) return;
      on = v;
      if (on) start(); else stop();
    },
    setMuted(m) {
      muted = m;
      if (bus) out.gain.setTargetAtTime(m ? 0 : LEVEL, ac.currentTime, 0.3);
    },
  };
}
