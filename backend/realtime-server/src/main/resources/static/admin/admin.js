// Admin page. Talks to /admin/api (AdminController). Logged in by the browser's Basic auth prompt.
'use strict';
(() => {
  const $ = (s) => document.querySelector(s);
  // same colours as frontend/src/net/faces.js: 0 empty, 1 black, 2 red, 3 white, 4 pink
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
      [o.channels.reduce((s, c) => s + c.members, 0), '전체 인원(채널 합계)'],
      [o.channels.length, '열린 채널'],
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
      for (const v of [`${c.channelNo}채널`, c.members, c.connectedHere, `${c.boothsOccupied} / 20`]) {
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
    for (let i = 0; i < 1024; i++) {
      const col = PALETTE[face.charCodeAt(i) - 48];
      if (!col) continue;
      c.fillStyle = col;
      c.fillRect((i % 32) * 4, Math.floor(i / 32) * 4, 4, 4);
    }
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', '신고된 얼굴 그림');
    return cv;
  }

  async function act(hash, action, body) {
    const label = { ban: '24시간 금지', permanent: '영구 금지', restore: '돌려주기' }[action];
    if (action !== 'restore' && !confirm(`이 그림을 ${label}할까요? 지금 쓰고 있는 사람은 바로 기본 얼굴로 돌아갑니다.`)) return;
    try {
      const r = await api(`/faces/${hash}/${action === 'restore' ? 'restore' : 'ban'}`, { method: 'POST', body: JSON.stringify(body || {}) });
      toast(action === 'restore' ? '돌려줬습니다. 다시 쓸 수 있습니다' : `${label}했습니다${r.takenOffFrom ? `. ${r.takenOffFrom}명에게서 내렸습니다` : ''}`);
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
      card.append(drawFace(e.face), badge, dl, actions);
      box.appendChild(card);
    }
  }

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
      await Promise.all([loadOverview(), loadFaces()]);
      $('#updated').textContent = `${new Date().toLocaleTimeString('ko-KR')} 기준, 10초마다 새로고침`;
    } catch (e) {
      $('#updated').textContent = `불러오지 못했습니다 (${e.message})`;
    }
  }
  refresh();
  setInterval(refresh, 10_000);
})();
