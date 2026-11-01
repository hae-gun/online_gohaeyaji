/**
 * Priest's voice: the browser's speech synthesis, male Korean voices only.
 *
 * The priests are men, so a female voice is never used. Browsers do not say which voice is
 * male, so only voices known to be male are picked, by name (MALE_VOICES). Where none is
 * installed (Chrome and Safari on most Macs and phones only have female Korean voices), the
 * priest does not speak and his words appear as text only.
 *
 * Each priest has his own voice: a different male voice when the device has several, and
 * always his own speed and pitch (jin calm, eom low and quick, yu bright, baek slow and deep).
 *
 * TODO: pre-generated audio files (one per sentence and priest, male voices from a cloud TTS),
 * so everyone hears the priests, not only people whose device has a male Korean voice.
 */

/** Known male Korean voices, by name. Microsoft (Edge on Windows): InJoon, Hyunsu, BongJin, GookMin. */
const MALE_VOICES = ['InJoon', 'Hyunsu', 'BongJin', 'GookMin'];

/** Per priest: which male voice he prefers when several exist, and his own speed and pitch. */
const PRIESTS = {
  jin: { prefer: ['InJoon', 'Hyunsu', 'GookMin', 'BongJin'], rate: 0.9, pitch: 0.95 },
  eom: { prefer: ['BongJin', 'GookMin', 'InJoon', 'Hyunsu'], rate: 1.05, pitch: 0.78 },
  yu: { prefer: ['Hyunsu', 'InJoon', 'BongJin', 'GookMin'], rate: 1.0, pitch: 1.15 },
  baek: { prefer: ['GookMin', 'BongJin', 'InJoon', 'Hyunsu'], rate: 0.8, pitch: 0.7 },   // the legendary priest
};

const isKorean = (v) => v && v.lang && v.lang.replace('_', '-').toLowerCase().startsWith('ko');
const maleName = (v) => MALE_VOICES.find((n) => v.name && v.name.toLowerCase().includes(n.toLowerCase()));

export function createVoice() {
  let muted = false;
  let priest = PRIESTS.jin;
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  // the voice list often arrives late (Chrome fills it after the first call)
  let males = [];   // [{ name: 'InJoon', voice }]
  const refresh = () => {
    try {
      males = speechSynthesis.getVoices().filter(isKorean)
        .map((voice) => ({ name: maleName(voice), voice }))
        .filter((m) => m.name);
    } catch (_) { /* ignore */ }
  };
  if (supported) {
    refresh();
    try { speechSynthesis.addEventListener('voiceschanged', refresh); } catch (_) { /* old browsers */ }
  }
  /** The male voice for the current priest, or null if the device has none. */
  const pick = () => {
    if (!males.length) refresh();
    for (const n of priest.prefer) {
      const m = males.find((x) => x.name === n);
      if (m) return m.voice;
    }
    return null;
  };

  return {
    /** queue=true lets the previous phrase finish instead of cutting it off (used for the blessing words). */
    speak(text, { queue = false } = {}) {
      if (muted || !supported) return;
      const voice = pick();
      if (!voice) return;   // no male Korean voice here: text only, never a female voice
      try {
        if (!queue) speechSynthesis.cancel();
        // Chrome can leave speech paused after the tab was in the background; nothing is heard
        // until resume() is called
        speechSynthesis.resume();
        const u = new SpeechSynthesisUtterance(text);
        u.voice = voice;
        u.lang = voice.lang;
        u.rate = priest.rate;
        u.pitch = priest.pitch;
        speechSynthesis.speak(u);
      } catch (_) { /* speech is optional */ }
    },
    /**
     * Call from a click: Safari (iPhone, iPad, Mac) only lets a page speak after speech was first
     * started inside a user gesture. A silent, empty phrase is enough.
     */
    unlock() {
      if (!supported) return;
      try { const u = new SpeechSynthesisUtterance(''); u.volume = 0; speechSynthesis.speak(u); } catch (_) { /* ignore */ }
    },
    stop() { if (supported) try { speechSynthesis.cancel(); } catch (_) { /* ignore */ } },
    /** Which priest is speaking ('jin' | 'eom' | 'yu' | 'baek'). */
    setTone(id) { priest = PRIESTS[id] || PRIESTS.jin; },
    setMuted(m) { muted = m; if (m) this.stop(); },
    /** Whether the priest is heard now: not muted, and a male Korean voice exists here. */
    get speaking() { return !muted && supported && !!pick(); },
    /** Whether this device has any male Korean voice at all. */
    get available() { return supported && !!pick(); },
  };
}
