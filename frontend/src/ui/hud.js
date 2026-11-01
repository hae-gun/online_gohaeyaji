export const $ = (sel) => document.querySelector(sel);

let toastTimer;
export function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

export function fade(on) {
  $('#fade').style.opacity = on ? 1 : 0;
}

/** Speech bubble above the priest with a typewriter effect. */
const TYPE_MS = 38;
// browser TTS at rate 0.82 says roughly one Korean syllable per 0.15 s
const SPEAK_SEC_PER_CHAR = 0.15;

export function createBubble(voice) {
  let typer;
  let full = '';

  function typeTo(target, from) {
    const el = $('#bubbleText');
    clearInterval(typer);
    let i = from;
    el.textContent = target.slice(0, i);
    typer = setInterval(() => {
      i += 1;
      el.textContent = target.slice(0, i);
      if (i >= target.length) clearInterval(typer);
    }, TYPE_MS);
  }

  /** Seconds the priest's mouth should move for this text. */
  function talkSeconds(text, silent) {
    if (silent || !voice.speaking) return Math.max(0.6, text.length * TYPE_MS / 1000);
    return Math.max(0.6, text.replace(/[\s.,!?…]/g, '').length * SPEAK_SEC_PER_CHAR);
  }

  return {
    /** Replaces the bubble text. Returns how long the priest talks, in seconds. */
    say(text, { safety = false, silent = false } = {}) {
      const bubble = $('#bubble');
      bubble.hidden = false;
      bubble.classList.toggle('safety', safety);
      full = text;
      typeTo(full, 0);
      if (!silent) voice.speak(text);
      return talkSeconds(text, silent);
    },
    /** Adds a phrase after what is already shown and speaks only that phrase. */
    append(text) {
      const bubble = $('#bubble');
      if (bubble.hidden) { bubble.hidden = false; bubble.classList.remove('safety'); full = ''; }
      const from = full.length;
      full = full ? `${full} ${text}` : text;
      typeTo(full, from);
      voice.speak(text, { queue: true });
      return talkSeconds(text, false);
    },
    stop() { clearInterval(typer); voice.stop(); },
  };
}

/** "나의 고해 기록" panel. Clearing asks for a second tap instead of a confirm() dialog. */
export function initHistoryPanel(history) {
  let armed = false;
  const clearBtn = $('#clearBtn');

  function render() {
    const list = history.load().slice().reverse();
    const box = $('#histList');
    box.textContent = '';
    if (!list.length) {
      const p = document.createElement('p');
      p.textContent = '아직 고해한 기록이 없습니다. 성당 안 오른쪽 고해소 방에서 빈 고해소에 들어가 보세요.';
      box.appendChild(p);
      return;
    }
    for (const r of list) {
      const article = document.createElement('article');
      const time = document.createElement('time');
      const q = document.createElement('p');
      const a = document.createElement('p');
      const d = new Date(r.t);
      time.textContent = `${d.toLocaleDateString('ko-KR')} ${d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`;
      q.className = 'q'; q.textContent = r.q;
      a.className = 'a'; a.textContent = `보속: ${r.p}`;
      article.append(time, q, a);
      box.appendChild(article);
    }
  }

  $('#histBtn').onclick = () => {
    render();
    armed = false;
    clearBtn.textContent = '기록 모두 지우기';
    $('#histPanel').hidden = false;
  };
  $('#histClose').onclick = () => { $('#histPanel').hidden = true; };
  clearBtn.onclick = () => {
    if (!armed) { armed = true; clearBtn.textContent = '한 번 더 누르면 지워집니다'; return; }
    history.clear();
    armed = false;
    clearBtn.textContent = '기록 모두 지우기';
    render();
  };
}
