/**
 * Priest's voice.
 *
 * TODO: replace with pre-generated audio files served from the CDN.
 * The answer is assembled from a fixed set of template pieces, so every sentence
 * can be synthesized once offline (one file per full sentence, keyword included,
 * so intonation stays natural). Browser speech synthesis is only a placeholder:
 * the voice differs on every OS and some devices have no Korean voice at all.
 */
// each priest sounds a little different: jin calm, eom low and quick, yu bright
const TONES = {
  jin: { rate: 0.82, pitch: 0.55 },
  eom: { rate: 0.98, pitch: 0.35 },
  yu: { rate: 0.92, pitch: 0.85 },
  baek: { rate: 0.72, pitch: 0.45 },   // the legendary priest: slow and low
};

export function createVoice() {
  let muted = false;
  let tone = TONES.jin;
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  // the Korean voice list often arrives late (Chrome fills it after the first call)
  let ko = null;
  const findKo = () => {
    try { ko = speechSynthesis.getVoices().find((v) => v.lang && v.lang.replace('_', '-').startsWith('ko')) || ko; } catch (_) { /* ignore */ }
  };
  if (supported) {
    findKo();
    try { speechSynthesis.addEventListener('voiceschanged', findKo); } catch (_) { /* old browsers */ }
  }

  return {
    /** queue=true lets the previous phrase finish instead of cutting it off (used for the blessing words). */
    speak(text, { queue = false } = {}) {
      if (muted || !supported) return;
      try {
        if (!queue) speechSynthesis.cancel();
        // Chrome can leave speech paused after the tab was in the background; nothing is heard
        // until resume() is called
        speechSynthesis.resume();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'ko-KR';
        u.rate = tone.rate;
        u.pitch = tone.pitch;
        if (!ko) findKo();
        if (ko) u.voice = ko;
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
    /** Which priest is speaking ('jin' | 'eom' | 'yu'). */
    setTone(id) { tone = TONES[id] || TONES.jin; },
    setMuted(m) { muted = m; if (m) this.stop(); },
    get speaking() { return !muted && supported; },
  };
}
