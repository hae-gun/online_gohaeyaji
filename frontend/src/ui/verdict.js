/**
 * 보속 판결: the penance is handed down like a sentence, so the end of a confession is a moment
 * worth watching (and sharing on the card).
 *
 *   죄목     the keyword that was caught ("쇼츠")
 *   도장     how often this browser confessed that sin: 초범, 재범, 상습범, 고해소 단골
 *            (the legendary priest: 전설의 사면)
 *   보속     a few penances of the category roll like a slot machine and stop on the real one
 *            the moment the priest says it, with a stamp sound
 *   한마디   one line of the verdict in the priest's own voice
 *
 * Only the category's own penance lines and dictionary keywords are shown, never the person's text.
 */

/** @returns {{ label: string, cls: string, repeat: boolean }} */
export function gradeOf(nth, legend) {
  if (legend) return { label: '전설의 사면', cls: 'legend', repeat: false };
  if (nth >= 5) return { label: '고해소 단골', cls: 'g4', repeat: true };
  if (nth >= 3) return { label: '상습범', cls: 'g3', repeat: true };
  if (nth === 2) return { label: '재범', cls: 'g2', repeat: true };
  return { label: '초범', cls: 'g1', repeat: false };
}

const LINES = {
  jin: {
    first: ['용서합니다. 오늘은 여기까지 하지요.', '털어놓은 것만으로 절반은 이미 갚았습니다.', '처음이니 마음 편히 돌아가셔도 됩니다.'],
    repeat: ['또 오셨군요. 그래도 오신 것이 다행입니다.', '같은 죄도 말할수록 조금씩 가벼워집니다.', '넘어진 횟수보다 다시 온 횟수를 세겠습니다.'],
  },
  eom: {
    first: ['초범이니 이번만 경고로 끝냅니다!', '엄중 경고 처분입니다!', '처음이라 봐드립니다. 두 번은 없습니다!'],
    repeat: ['상습입니다! 보속을 무겁게 매깁니다!', '다음에 또 오시면 그땐 두 배입니다!', '이 정도면 고해소에 이름표를 붙여 드려야겠습니다!'],
  },
  yu: {
    first: ['훈방 조치입니다. 웃으면서 나가셔도 됩니다.', '벌금은 없습니다. 보속으로 대신하지요.', '초범 할인이 적용되었습니다.'],
    repeat: ['단골 할인은 없습니다. 보속은 정가입니다.', '이 정도면 적립 카드를 만들어 드려야겠습니다.', '도장 열 개 모으면 신부님이 박수 쳐 드립니다.'],
  },
  baek: {
    first: ['백 년 동안 이런 죄는 수없이 보았습니다. 모두 용서받았지요.'],
    repeat: ['백 년 동안 이런 죄는 수없이 보았습니다. 모두 용서받았지요.'],
  },
};

export function verdictLine(persona, grade, random = Math.random) {
  const set = LINES[persona] || LINES.jin;
  const list = grade.repeat ? set.repeat : set.first;
  return list[Math.floor(random() * list.length)];
}

/**
 * Plays the verdict in the penance box.
 * @param {{ box: HTMLElement, crime: string, grade: ReturnType<typeof gradeOf>, line: string,
 *           penance: string, choices: string[], stampAt: number, onStamp?: () => void }} o
 *   stampAt: seconds from now when the priest says the penance
 * @returns {() => void} cancel (a new confession or leaving the booth)
 */
export function playVerdict(o) {
  const { box } = o;
  const q = (s) => box.querySelector(s);
  const text = q('#penanceText'), stamp = q('#verdictStamp'), crime = q('#verdictCrime'), line = q('#verdictLine');
  const timers = [];
  const later = (ms, fn) => timers.push(setTimeout(fn, ms));
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

  box.classList.remove('stamped', 'rolling');
  stamp.className = `stamp ${o.grade.cls}`;
  stamp.textContent = o.grade.label;
  crime.textContent = o.crime;
  line.textContent = '';
  text.textContent = '보속을 정하는 중입니다';
  box.hidden = false;

  const stampMs = Math.max(600, o.stampAt * 1000);
  const pool = o.choices.length ? o.choices : [o.penance];
  if (!calm && pool.length > 1) {
    // roll faster and faster, then slower just before the stamp
    const rollStart = Math.max(200, stampMs - 1600);
    let t = rollStart, i = 0, gap = 70;
    later(rollStart, () => box.classList.add('rolling'));
    while (t < stampMs - 120) {
      const s = pool[i++ % pool.length];
      later(t, () => { text.textContent = s; });
      t += gap;
      if (t > stampMs - 700) gap = Math.min(260, gap * 1.35);
    }
  }
  later(stampMs, () => {
    box.classList.remove('rolling');
    text.textContent = o.penance;
    box.classList.add('stamped');
    if (o.onStamp) o.onStamp();
  });
  later(stampMs + 700, () => { line.textContent = o.line; });
  return () => { timers.forEach(clearTimeout); box.classList.remove('rolling'); };
}
