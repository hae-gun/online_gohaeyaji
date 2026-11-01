/**
 * Priest's voice: the browser's speech synthesis.
 *
 * Browsers do not say which voice is male or female, so male Korean voices known by name
 * (MALE_VOICES, Microsoft voices in Edge on Windows) are used when there is one. Chrome and
 * Safari only have female Korean voices ("Google 한국의", Yuna, Heami); there the priests speak
 * with that voice, pitched down. Chrome is the main target, so its Google voice comes first
 * among the others.
 *
 * Each priest has his own voice: a different male voice when the device has several, and
 * always his own speed and pitch (jin calm, eom low and quick, yu bright, baek slow and deep).
 *
 * TODO: pre-generated audio files (one per sentence and priest, male voices from a cloud TTS),
 * so everyone hears the same male priests.
 */

/** Known male Korean voices, by name. Microsoft (Edge on Windows): InJoon, Hyunsu, BongJin, GookMin. */
const MALE_VOICES = ['InJoon', 'Hyunsu', 'BongJin', 'GookMin'];

/**
 * Per priest: which male voice he prefers when several exist, his speed, and his pitch with a
 * male voice (pitch) or with a female voice (lowPitch, pulled down to sound older and lower).
 */
const PRIESTS = {
  jin: { prefer: ['InJoon', 'Hyunsu', 'GookMin', 'BongJin'], rate: 0.9, pitch: 0.95, lowPitch: 0.6 },
  eom: { prefer: ['BongJin', 'GookMin', 'InJoon', 'Hyunsu'], rate: 1.05, pitch: 0.78, lowPitch: 0.4 },
  yu: { prefer: ['Hyunsu', 'InJoon', 'BongJin', 'GookMin'], rate: 1.0, pitch: 1.15, lowPitch: 0.85 },
  baek: { prefer: ['GookMin', 'BongJin', 'InJoon', 'Hyunsu'], rate: 0.8, pitch: 0.7, lowPitch: 0.35 },   // the legendary priest
};

const isKorean = (v) => v && v.lang && v.lang.replace('_', '-').toLowerCase().startsWith('ko');
const maleName = (v) => MALE_VOICES.find((n) => v.name && v.name.toLowerCase().includes(n.toLowerCase()));

export function createVoice() {
  let muted = false;
  let priest = PRIESTS.jin;
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  // the voice list often arrives late (Chrome fills it after the first call)
  let males = [];   // [{ name: 'InJoon', voice }]
  let other = null; // the best non-male Korean voice: Chrome's Google voice first
  const refresh = () => {
    try {
      const ko = speechSynthesis.getVoices().filter(isKorean);
      males = ko.map((voice) => ({ name: maleName(voice), voice })).filter((m) => m.name);
      other = ko.find((v) => /google/i.test(v.name)) || ko.find((v) => !maleName(v)) || null;
    } catch (_) { /* ignore */ }
  };
  if (supported) {
    refresh();
    try { speechSynthesis.addEventListener('voiceschanged', refresh); } catch (_) { /* old browsers */ }
  }
  /** { voice, male }: the current priest's male voice, else the best other Korean voice. */
  const pick = () => {
    if (!males.length && !other) refresh();
    for (const n of priest.prefer) {
      const m = males.find((x) => x.name === n);
      if (m) return { voice: m.voice, male: true };
    }
    return { voice: other, male: false };
  };

  return {
    /** queue=true lets the previous phrase finish instead of cutting it off (used for the blessing words). */
    speak(text, { queue = false } = {}) {
      if (muted || !supported) return;
      const { voice, male } = pick();
      try {
        if (!queue) speechSynthesis.cancel();
        // Chrome can leave speech paused after the tab was in the background; nothing is heard
        // until resume() is called
        speechSynthesis.resume();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'ko-KR';
        if (voice) { u.voice = voice; u.lang = voice.lang; }
        u.rate = priest.rate;
        u.pitch = male ? priest.pitch : priest.lowPitch;
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
    get speaking() { return !muted && supported; },
  };
}
