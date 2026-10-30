/**
 * Priest's voice.
 *
 * TODO: replace with pre-generated audio files served from the CDN.
 * The answer is assembled from a fixed set of template pieces, so every sentence
 * can be synthesized once offline (one file per full sentence, keyword included,
 * so intonation stays natural). Browser speech synthesis is only a placeholder:
 * the voice differs on every OS and some devices have no Korean voice at all.
 */
export function createVoice() {
  let muted = false;
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  return {
    speak(text) {
      if (muted || !supported) return;
      try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'ko-KR';
        u.rate = 0.82;
        u.pitch = 0.55;
        const ko = speechSynthesis.getVoices().find((v) => v.lang && v.lang.startsWith('ko'));
        if (ko) u.voice = ko;
        speechSynthesis.speak(u);
      } catch (_) { /* speech is optional */ }
    },
    stop() { if (supported) try { speechSynthesis.cancel(); } catch (_) { /* ignore */ } },
    setMuted(m) { muted = m; if (m) this.stop(); },
  };
}
