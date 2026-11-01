// Admin page. Talks to /admin/api (AdminController). Logged in by the browser's Basic auth prompt.
'use strict';
(() => {
  const $ = (s) => document.querySelector(s);
  // same colours as frontend/src/net/faces.js: 0 empty, 1 black, 2 red, 3 white, 4 pink, 5 picked (":rrggbb" after the grid)
  const PALETTE = [null, '#151010', '#a3231b', '#ffffff', '#f07a8a'];
  const SKIN = '#efc39b';
  const FILTERS = [
    ['all', '전체'], ['reported', '신고 중'], ['banned', '24시간 금지'], ['permanent', '영구 금지'], ['restored', '돌려줌'],
  ];
  let filter = 'all';
  let faces = [];

  const fmtTime = (ms) => (ms ? new Date(ms).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-');
  const fmtDur = (ms) => {
    const m = Math.round(ms / 60000);
    if (m < 60) return `${m}분`;
    const h = Math.floor(m / 60);
    return h < 24 ? `${h}시간 ${m % 60}분` : `${Math.floor(h / 24)}일 ${h % 24}시간`;
  };
  function toast(text) {
    const t = $('#toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 3000);
  }

  async function api(path, opts = {}) {
    const res = await fetch(`/admin/api${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', 'X-Admin': '1', ...(opts.headers || {}) },
      credentials: 'same-origin',
    });
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json();
  }

  function status(e) {
    if (e.banTtlMs === -1) return 'permanent';
    if (e.banTtlMs > 0) return 'banned';
    if (e.restoredAt) return 'restored';
    return 'reported';
  }
  const STATUS_TEXT = { reported: '신고 중', banned: '24시간 금지', permanent: '영구 금지', restored: '돌려줌' };
  const BY_TEXT = { reports: '신고 누적', admin: '관리자', 'admin-permanent': '관리자(영구)' };

  // ------------------------------------------------------------ overview
  async function loadOverview() {
    const o = await api('/overview');
    const stats = [
      [o.sessionsHere, '이 서버 접속'],
      [o.channels.reduce((s, c) => s + c.members, 0), '전체 인원(살아 있는 서버 합계)'],
      [o.channels.length, '열린 채널'],
      [o.serversAlive, '살아 있는 서버'],
      [o.inquiriesOpen, '안 읽은 문의'],
      [o.feedbackTodo, '답변 개선함 할 일'],
      [o.channels.reduce((s, c) => s + c.boothsOccupied, 0), '사용 중 고해소'],
      [Math.round(o.faceReportsTotal), '신고(서버 시작 후)'],
      [Math.round(o.faceBansTotal), '금지(서버 시작 후)'],
      [`${o.heapUsedMb} / ${o.heapMaxMb}MB`, '메모리(JVM)'],
      [fmtDur(o.uptimeMs), '가동 시간'],
    ];
    const box = $('#stats');
    box.textContent = '';
    for (const [v, label] of stats) {
      const d = document.createElement('div');
      d.className = 'stat';
      const b = document.createElement('b'); b.textContent = v;
      const s = document.createElement('span'); s.textContent = label;
      d.append(b, s);
      box.appendChild(d);
    }
    const tb = $('#channels');
    tb.textContent = '';
    for (const c of o.channels) {
      const tr = document.createElement('tr');
      for (const v of [`${c.channelNo}채널`, c.members, c.connectedHere, `${c.boothsOccupied} / ${o.boothCount || 21}`]) {
        const td = document.createElement('td'); td.textContent = v; tr.appendChild(td);
      }
      tb.appendChild(tr);
    }
    if (!o.channels.length) {
      const tr = document.createElement('tr'); const td = document.createElement('td');
      td.colSpan = 4; td.className = 'muted'; td.textContent = '아직 열린 채널이 없습니다.';
      tr.appendChild(td); tb.appendChild(tr);
    }
  }

  // ------------------------------------------------------------ reported drawings
  function drawFace(face) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const c = cv.getContext('2d');
    c.fillStyle = SKIN; c.beginPath(); c.arc(64, 64, 63, 0, Math.PI * 2); c.fill();
    const picked = face.length === 1031 ? `#${face.slice(1025)}` : null;
    for (let i = 0; i < 1024; i++) {
      const d = face.charCodeAt(i) - 48;
      const col = d === 5 ? picked : PALETTE[d];
      if (!col) continue;
      c.fillStyle = col;
      c.fillRect((i % 32) * 4, Math.floor(i / 32) * 4, 4, 4);
    }
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', '신고된 얼굴 그림');
    return cv;
  }

  async function act(hash, action, body, st) {
    const label = { ban: '24시간 금지', permanent: '영구 금지', restore: '돌려주기', delete: '삭제' }[action];
    if (action === 'delete') {
      const banNote = st === 'permanent' ? ' 영구 금지는 그대로 유지되지만, 목록에서 사라지므로 나중에 돌려줄 수 없게 됩니다.'
        : st === 'banned' ? ' 24시간 금지는 남은 시간 동안 그대로 유지됩니다.' : '';
      if (!confirm(`이 그림과 신고 내역(IP 포함)을 완전히 지울까요? 되돌릴 수 없습니다.${banNote}`)) return;
    } else if (action !== 'restore' && !confirm(`이 그림을 ${label}할까요? 지금 쓰고 있는 사람은 바로 기본 얼굴로 돌아갑니다.`)) return;
    const path = { restore: 'restore', delete: 'delete' }[action] || 'ban';
    try {
      const r = await api(`/faces/${hash}/${path}`, { method: 'POST', body: JSON.stringify(body || {}) });
      toast(action === 'restore' ? '돌려줬습니다. 다시 쓸 수 있습니다'
        : action === 'delete' ? '그림과 신고 내역을 지웠습니다'
        : `${label}했습니다${r.takenOffFrom ? `. ${r.takenOffFrom}명에게서 내렸습니다` : ''}`);
      await loadFaces();
    } catch (e) {
      toast(`처리하지 못했습니다 (${e.message})`);
    }
  }

  function renderFaces() {
    const box = $('#faces');
    box.textContent = '';
    const list = faces.filter((e) => filter === 'all' || status(e) === filter);
    $('#empty').hidden = list.length > 0;
    for (const e of list) {
      const st = status(e);
      const card = document.createElement('article');
      card.className = 'face';
      const badge = document.createElement('span');
      badge.className = `badge ${st}`;
      badge.textContent = STATUS_TEXT[st] + (st === 'banned' ? ` (${fmtDur(e.banTtlMs)} 남음)` : '');
      const dl = document.createElement('dl');
      const rows = [
        ['신고', `${e.reports}회`],
        ['처음 신고', fmtTime(e.firstAt)],
        ['마지막 신고', fmtTime(e.lastAt)],
        ['내린 시각', e.bannedAt ? `${fmtTime(e.bannedAt)} (${BY_TEXT[e.bannedBy] || e.bannedBy})` : '-'],
        ['그림 ID', e.hash.slice(0, 12)],
      ];
      for (const [k, v] of rows) {
        const dt = document.createElement('dt'); dt.textContent = k;
        const dd = document.createElement('dd'); dd.textContent = v;
        dl.append(dt, dd);
      }
      const actions = document.createElement('div');
      actions.className = 'actions';
      const btn = (text, cls, on, disabled) => {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = text; if (cls) b.className = cls; b.disabled = !!disabled; b.onclick = on;
        actions.appendChild(b);
      };
      btn('24시간 금지', 'danger', () => act(e.hash, 'ban', { permanent: false }), st === 'banned' || st === 'permanent');
      btn('영구 금지', 'danger', () => act(e.hash, 'permanent', { permanent: true }), st === 'permanent');
      btn('돌려주기', 'ok', () => act(e.hash, 'restore'), st === 'reported' || st === 'restored');
      btn('삭제', '', () => act(e.hash, 'delete', null, st));
      card.append(drawFace(e.face), badge, dl, reportLog(e.log || []), actions);
      box.appendChild(card);
    }
  }

  /** Who reported whom, from where. Folded by default: IPs are personal data, show them only when needed. */
  function reportLog(log) {
    const d = document.createElement('details');
    const sum = document.createElement('summary');
    sum.textContent = `신고 내역 ${log.length}건 (IP 포함)`;
    d.appendChild(sum);
    if (!log.length) return d;
    const t = document.createElement('table');
    t.className = 'log';
    const head = document.createElement('tr');
    for (const h of ['시각', '신고한 사람', '신고된 사람']) { const th = document.createElement('th'); th.textContent = h; head.appendChild(th); }
    t.appendChild(head);
    for (const r of log) {
      const tr = document.createElement('tr');
      const who = (name, ip) => {
        const td = document.createElement('td');
        const n = document.createElement('div'); n.textContent = name || '(이름 없음)';
        const i = document.createElement('div'); i.className = 'ip'; i.textContent = ip || '-';
        td.append(n, i);
        return td;
      };
      const time = document.createElement('td'); time.textContent = fmtTime(r.at);
      tr.append(time, who(r.reporterName, r.reporterIp), who(r.targetName, r.targetIp));
      t.appendChild(tr);
    }
    d.appendChild(t);
    return d;
  }

  // ------------------------------------------------------------ inquiry box (신께 알리기)
  const KIND_TEXT = { question: '질문', request: '문의', idea: '제안', bug: '오류 신고' };
  let inquiries = [];
  let inquiryFilter = 'open';

  async function loadInquiries() {
    inquiries = await api('/inquiries');
    renderInquiries();
  }

  async function inquiryAct(id, action) {
    if (action === 'delete' && !confirm('이 문의를 지울까요? 되돌릴 수 없습니다.')) return;
    try {
      await api(`/inquiries/${id}/${action}`, { method: 'POST', body: '{}' });
      toast({ done: '처리함으로 표시했습니다', reopen: '안 읽음으로 되돌렸습니다', delete: '지웠습니다' }[action]);
      await Promise.all([loadInquiries(), loadOverview()]);
    } catch (e) {
      toast(`처리하지 못했습니다 (${e.message})`);
    }
  }

  function renderInquiries() {
    const box = $('#inquiries');
    box.textContent = '';
    const list = inquiries.filter((e) => inquiryFilter === 'all' || !e.done);
    $('#inquiryEmpty').hidden = list.length > 0;
    for (const e of list) {
      const card = document.createElement('article');
      card.className = `inquiry${e.done ? ' done' : ''}`;
      const head = document.createElement('div');
      head.className = 'ihead';
      const kind = document.createElement('span');
      kind.className = `badge kind-${e.kind}`;
      kind.textContent = KIND_TEXT[e.kind] || e.kind;
      const meta = document.createElement('span');
      meta.className = 'muted';
      meta.textContent = `${fmtTime(e.at)}  ${e.channelNo}채널  ${e.name || '(이름 없음)'}`;
      head.append(kind, meta);
      // plain text only: whatever people typed is never read as HTML
      const text = document.createElement('p');
      text.className = 'itext';
      text.textContent = e.text;
      const actions = document.createElement('div');
      actions.className = 'actions';
      const btn = (label, cls, action) => {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = label; if (cls) b.className = cls;
        b.onclick = () => inquiryAct(e.id, action);
        actions.appendChild(b);
      };
      if (e.done) btn('안 읽음으로', '', 'reopen'); else btn('처리함', 'ok', 'done');
      btn('삭제', 'danger', 'delete');
      card.append(head, text, actions);
      box.appendChild(card);
    }
  }

  const inquiryFiltersEl = $('#inquiryFilters');
  for (const [id, label] of [['open', '안 읽은 것'], ['all', '전체']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.dataset.id = id;
    b.onclick = () => { inquiryFilter = id; markInquiryFilters(); renderInquiries(); };
    inquiryFiltersEl.appendChild(b);
  }
  function markInquiryFilters() {
    for (const b of inquiryFiltersEl.children) b.setAttribute('aria-pressed', String(b.dataset.id === inquiryFilter));
  }
  markInquiryFilters();

  // ------------------------------------------------------------ answer improvement box
  const PRIEST = { jin: '진 신부님(진지)', eom: '엄 신부님(꾸짖음)', yu: '유 신부님(유머)', baek: '백 신부님(전설)' };
  const REASON = { wrong: '주제를 잘못 알아들음', bland: '너무 뻔한 답' };
  const FB_STATUS = { todo: '할 일', wrong: '카테고리 잘못', new: '새 주제', ignore: '무시' };
  let feedback = [];
  let feedbackFilter = 'todo';

  async function loadFeedback() {
    feedback = await api('/feedback');
    renderFeedback();
  }

  async function feedbackAct(id, action) {
    if (action === 'delete' && !confirm('이 고해를 지울까요? 되돌릴 수 없습니다.')) return;
    try {
      await api(action === 'delete' ? `/feedback/${id}/delete` : `/feedback/${id}/mark/${action}`, { method: 'POST', body: '{}' });
      await Promise.all([loadFeedback(), loadOverview()]);
    } catch (e) {
      toast(`처리하지 못했습니다 (${e.message})`);
    }
  }

  function renderFeedback() {
    const box = $('#feedbackList');
    box.textContent = '';
    const list = feedback.filter((e) => feedbackFilter === 'all' || e.status === feedbackFilter);
    $('#feedbackEmpty').hidden = list.length > 0;
    for (const e of list) {
      const card = document.createElement('article');
      card.className = `inquiry${e.status === 'ignore' ? ' done' : ''}`;
      const head = document.createElement('div');
      head.className = 'ihead';
      const badge = document.createElement('span');
      badge.className = `badge fb-${e.status}`;
      badge.textContent = FB_STATUS[e.status] || e.status;
      const meta = document.createElement('span');
      meta.className = 'muted';
      meta.textContent = `${fmtTime(e.at)}  ${PRIEST[e.persona] || e.persona}  판단: ${e.category === 'generic' ? '기본 답변(어느 주제에도 안 걸림)' : e.category}  사유: ${REASON[e.reason] || e.reason}`;
      head.append(badge, meta);
      const q = document.createElement('p'); q.className = 'itext'; q.textContent = `고해: ${e.text}`;
      const a = document.createElement('p'); a.className = 'itext muted'; a.textContent = `나간 답: ${e.answer}`;
      const actions = document.createElement('div');
      actions.className = 'actions';
      for (const [st, label] of [['wrong', '카테고리 잘못'], ['new', '새 주제'], ['ignore', '무시'], ['todo', '할 일로']]) {
        if (st === e.status) continue;
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = label;
        b.onclick = () => feedbackAct(e.id, st);
        actions.appendChild(b);
      }
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'danger'; del.textContent = '삭제';
      del.onclick = () => feedbackAct(e.id, 'delete');
      actions.appendChild(del);
      card.append(head, q, a, actions);
      box.appendChild(card);
    }
  }

  /** The text to paste into an AI chat: the data format, the tone, and the marked confessions. */
  function buildPrompt(items) {
    const lines = items.map((e, i) => `${i + 1}. [${FB_STATUS[e.status]}] 신부님: ${e.persona} / 판단한 카테고리: ${e.category} / 사유: ${REASON[e.reason] || e.reason}
   고해: "${e.text}"
   나간 답: "${e.answer}"`);
    return `고해야지(일상의 작은 실패를 털어놓는 패러디 고해소)의 답변 데이터 answers.json을 개선하려고 합니다.
아래는 사용자가 "답이 엉뚱해요"를 누르고 동의해서 보낸 고해들입니다.

[answers.json 형식]
- categories: [{ "id": "영문 소문자", "word": "대표 단어", "keys": [...], "empathy": [...] 또는 { "jin": [...], "eom": [...], "yu": [...] }, "penance": [...], "closing": [...] 또는 { "jin": [...], "eom": [...], "yu": [...] } }]
- keys: 고해에 이 말이 들어 있으면 이 카테고리. "A|B"는 A와 B가 모두 들어 있을 때
- empathy와 penance 문장의 {k}, {k은}, {k이}, {k을} 자리에는 걸린 키워드가 조사와 함께 들어감. closing에는 쓰지 않음
- 신부님: jin(진지하고 다정), eom(엄하게 꾸짖지만 끝은 따뜻), yu(유머), baek(백 년 된 전설의 신부님, 드물게 등장)
- penance(보속)는 오늘 바로 할 수 있는 작고 구체적인 행동 하나

[요청]
1. [카테고리 잘못]은 원래 가야 했던 카테고리와, 그쪽에 추가할 keys
2. [새 주제]는 새 카테고리 전체. empathy와 closing은 jin, eom, yu 각각 3개 이상, penance 3개 이상
3. [할 일]은 위 둘 중 맞는 쪽으로 판단
4. 톤: 실제 고해성사를 흉내 내지 않고, 일상의 작은 실패를 웃으며 다독이는 패러디. 종교와 사람을 조롱하지 않기. 위기 상황(자해, 자살 등)은 다루지 않기
5. 결과는 JSON 하나로만:
{ "addKeys": [{ "category": "기존 id", "keys": ["..."] }], "newCategories": [ { 위 형식의 카테고리 } ] }

[고해 목록]
${lines.join('\n')}
`;
  }

  $('#feedbackExport').onclick = async () => {
    const items = feedback.filter((e) => e.status === 'wrong' || e.status === 'new' || e.status === 'todo');
    const ta = $('#feedbackPrompt');
    if (!items.length) { toast('넘길 고해가 없습니다'); return; }
    ta.value = buildPrompt(items);
    ta.hidden = false;
    ta.select();
    try { await navigator.clipboard.writeText(ta.value); $('#feedbackExportNote').textContent = `${items.length}건을 복사했습니다. AI 대화창에 붙여 넣으세요`; }
    catch (_) { $('#feedbackExportNote').textContent = `${items.length}건. 아래 내용을 복사해 AI 대화창에 붙여 넣으세요`; }
  };

  const feedbackFiltersEl = $('#feedbackFilters');
  for (const [id, label] of [['todo', '할 일'], ['wrong', '카테고리 잘못'], ['new', '새 주제'], ['ignore', '무시'], ['all', '전체']]) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label; b.dataset.id = id;
    b.onclick = () => { feedbackFilter = id; markFeedbackFilters(); renderFeedback(); };
    feedbackFiltersEl.appendChild(b);
  }
  function markFeedbackFilters() {
    for (const b of feedbackFiltersEl.children) b.setAttribute('aria-pressed', String(b.dataset.id === feedbackFilter));
  }
  markFeedbackFilters();

  async function loadFaces() {
    faces = await api('/faces');
    renderFaces();
  }

  const filtersEl = $('#filters');
  for (const [id, label] of FILTERS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.onclick = () => { filter = id; markFilters(); renderFaces(); };
    filtersEl.appendChild(b);
  }
  function markFilters() {
    [...filtersEl.children].forEach((b, i) => b.setAttribute('aria-pressed', String(FILTERS[i][0] === filter)));
  }
  markFilters();

  async function refresh() {
    try {
      await Promise.all([loadOverview(), loadFaces(), loadInquiries(), loadFeedback()]);
      $('#updated').textContent = `${new Date().toLocaleTimeString('ko-KR')} 기준, 10초마다 새로고침`;
    } catch (e) {
      $('#updated').textContent = `불러오지 못했습니다 (${e.message})`;
    }
  }
  refresh();
  setInterval(refresh, 10_000);
})();
