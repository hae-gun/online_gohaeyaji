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
};

export function createVoice() {
  let muted = false;
  let tone = TONES.jin;
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  return {
    /** queue=true lets the previous phrase finish instead of cutting it off (used for the blessing words). */
    speak(text, { queue = false } = {}) {
      if (muted || !supported) return;
      try {
        if (!queue) speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'ko-KR';
        u.rate = tone.rate;
        u.pitch = tone.pitch;
        const ko = speechSynthesis.getVoices().find((v) => v.lang && v.lang.startsWith('ko'));
        if (ko) u.voice = ko;
        speechSynthesis.speak(u);
      } catch (_) { /* speech is optional */ }
    },
    stop() { if (supported) try { speechSynthesis.cancel(); } catch (_) { /* ignore */ } },
    /** Which priest is speaking ('jin' | 'eom' | 'yu'). */
    setTone(id) { tone = TONES[id] || TONES.jin; },
    setMuted(m) { muted = m; if (m) this.stop(); },
    get speaking() { return !muted && supported; },
  };
}
