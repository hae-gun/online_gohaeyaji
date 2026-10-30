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
export function createBubble(voice) {
  let typer;
  return {
    say(text, { safety = false, silent = false } = {}) {
      const bubble = $('#bubble'), el = $('#bubbleText');
      bubble.hidden = false;
      bubble.classList.toggle('safety', safety);
      clearInterval(typer);
      el.textContent = '';
      let i = 0;
      typer = setInterval(() => {
        i += 1;
        el.textContent = text.slice(0, i);
        if (i >= text.length) clearInterval(typer);
      }, 38);
      if (!silent) voice.speak(text);
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
      p.textContent = '아직 고해한 기록이 없습니다. 복도의 빈 고해소에 들어가 보세요.';
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
