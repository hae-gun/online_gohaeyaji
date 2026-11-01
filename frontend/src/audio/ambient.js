/**
 * Synthesized ambience (bells and birds) with Web Audio, so there are no sound files yet.
 * Browsers only allow audio after a user gesture, so start() is called from the entry button.
 *
 * Volume follows where the player is: yard is loudest, inside the cathedral a little quieter,
 * inside a confessional almost silent.
 */
const LEVEL = { yard: 0.6, hall: 0.4, room: 0.05 };

export function createAmbient() {
  let ac = null, master = null, muted = false, place = 'yard';

  function apply() {
    if (!master) return;
    master.gain.setTargetAtTime(muted ? 0 : LEVEL[place], ac.currentTime, 0.4);
  }

  function bell(out = master) {
    if (!ac) return;
    const t = ac.currentTime;
    [[220, 0.35], [440 * 1.19, 0.14], [220 * 2.76, 0.12], [220 * 5.4, 0.05]].forEach(([f, v]) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 5);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + 5.1);
    });
  }

  function birds() {
    if (!ac) return;
    let t = ac.currentTime;
    const n = 2 + Math.floor(Math.random() * 3), base = 2300 + Math.random() * 900;
    for (let i = 0; i < n; i++) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(base, t);
      o.frequency.exponentialRampToValueAtTime(base * 1.6, t + 0.06);
      o.frequency.exponentialRampToValueAtTime(base * 1.1, t + 0.13);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.16);
      t += 0.18 + Math.random() * 0.08;
    }
  }

  return {
    start() {
      if (ac) return;
      try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { return; }
      master = ac.createGain();
      master.gain.value = LEVEL[place];
      master.connect(ac.destination);
      const loopBell = () => { bell(); setTimeout(loopBell, 9000 + Math.random() * 7000); };
      const loopBirds = () => { birds(); setTimeout(loopBirds, 2500 + Math.random() * 4500); };
      setTimeout(loopBell, 600);
      setTimeout(loopBirds, 1500);
    },
    /**
     * Rings the bell n times, straight to the speakers so it is heard even inside the quiet
     * booth. Used when the legendary priest appears.
     */
    peal(n = 3) {
      if (!ac || muted) return;
      const loud = ac.createGain(); loud.gain.value = 0.55; loud.connect(ac.destination);
      for (let i = 0; i < n; i++) setTimeout(() => bell(loud), i * 1300);
    },
    /** Two small coins landing in the offering box. */
    coin() {
      if (!ac || muted) return;
      const t = ac.currentTime;
      [[2637, 0], [3136, 0.09], [2349, 0.2]].forEach(([f, d]) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = 'triangle'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + d);
        g.gain.exponentialRampToValueAtTime(0.12, t + d + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.25);
        o.connect(g); g.connect(ac.destination); o.start(t + d); o.stop(t + d + 0.3);
      });
    },
    /** A soft rising chime: a candle lit, a letter sent up. */
    chime() {
      if (!ac || muted) return;
      const t = ac.currentTime;
      [523, 659, 784, 1047].forEach((f, i) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = 'sine'; o.frequency.value = f;
        const d = i * 0.11;
        g.gain.setValueAtTime(0.0001, t + d);
        g.gain.exponentialRampToValueAtTime(0.07, t + d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d + 1.2);
        o.connect(g); g.connect(ac.destination); o.start(t + d); o.stop(t + d + 1.3);
      });
    },
    /** @param {'yard'|'hall'|'room'} p */
    setPlace(p) { place = p; apply(); },
    setMuted(m) { muted = m; apply(); },
  };
}
