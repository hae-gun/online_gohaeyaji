/**
 * Synthesized ambience (bells and birds) with Web Audio, so there are no sound files yet.
 * Browsers only allow audio after a user gesture, so start() is called from the entry button.
 *
 * Volume follows where the player is: yard is loudest, the corridor a little quieter,
 * inside a confessional almost silent.
 */
const LEVEL = { yard: 0.6, hall: 0.4, room: 0.05 };

export function createAmbient() {
  let ac = null, master = null, muted = false, place = 'yard';

  function apply() {
    if (!master) return;
    master.gain.setTargetAtTime(muted ? 0 : LEVEL[place], ac.currentTime, 0.4);
  }

  function bell() {
    if (!ac) return;
    const t = ac.currentTime;
    [[220, 0.35], [440 * 1.19, 0.14], [220 * 2.76, 0.12], [220 * 5.4, 0.05]].forEach(([f, v]) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 5);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 5.1);
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
    /** @param {'yard'|'hall'|'room'} p */
    setPlace(p) { place = p; apply(); },
    setMuted(m) { muted = m; apply(); },
  };
}
