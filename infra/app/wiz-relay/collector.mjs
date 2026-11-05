// Temporary Korean Series collector for the Magic Wiz Park page. Delete after the series.
// One process reads KBO's public game centre, then Nginx serves the result as a static file,
// so visitor count never changes how often koreabaseball.com is called.
// Play text is rebuilt from facts here; the source wording is not republished.
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.UPSTREAM || 'https://www.koreabaseball.com';
const OUT = process.env.OUT_DIR || '/srv/wiz';
const TEAM = process.env.TEAM_CODE || 'KT';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const HEARTBEAT_MS = 30_000;
const MAX_BACKOFF_MS = 120_000;
const MAX_HTML = 2_000_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kstDate = () => new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 10).replaceAll('-', '');

async function post(path, body, headers, referer) {
  const res = await fetch(BASE + path, {
    method: 'POST', body, signal: AbortSignal.timeout(8000),
    headers: { 'user-agent': UA, referer, ...headers },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
  const text = await res.text();
  if (text.length > MAX_HTML) throw new Error(`oversized ${path}`);
  return text;
}

async function fetchGames(date) {
  const text = await post('/ws/Main.asmx/GetKboGameList',
    JSON.stringify({ leId: '1', srId: '0,1,3,4,5,7,9', date }),
    { 'content-type': 'application/json; charset=utf-8', 'x-requested-with': 'XMLHttpRequest' },
    'https://www.koreabaseball.com/Schedule/Schedule.aspx');
  // ASP.NET can append an HTML error page after the JSON body
  const end = text.indexOf('}<!');
  const data = JSON.parse(end > 0 ? text.slice(0, end + 1) : text);
  if (!Array.isArray(data.game)) throw new Error('game list schema');
  return data.game;
}

async function fetchViews(raw) {
  const body = new URLSearchParams({ leagueId: '1', seriesId: String(raw.SR_ID), gameId: raw.G_ID, gyear: raw.G_ID.slice(0, 4) }).toString();
  return Promise.all([1, 2].map((n) => post(`/Game/LiveTextView${n}.aspx`, body,
    { 'content-type': 'application/x-www-form-urlencoded' }, 'https://www.koreabaseball.com/')));
}

const clean = (s) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/\s+/g, ' ').trim();
const cells = (s) => [...s.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => clean(m[1]));
const rows = (s) => [...(s.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i)?.[1] ?? '').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => cells(m[1]));
const table = (s, id) => s.match(new RegExp(`<table\\b[^>]*id="${id}"[^>]*>([\\s\\S]*?)<\\/table>`, 'i'))?.[1] ?? '';
const count = (s) => (/^\d+$/.test(s) ? Number(s) : 0);

const RESULTS = [
  [/홈런/, '홈런'], [/3루타/, '3루타'], [/2루타/, '2루타'], [/안타|1루타/, '안타'],
  [/삼진/, '삼진'], [/볼넷/, '볼넷'], [/몸에 맞/, '몸에 맞는 공'], [/병살/, '병살타'],
  [/뜬공|땅볼|플라이|직선타|아웃/, '아웃'],
];

export function ownText(source) {
  const text = source.trim();
  const pitch = text.match(/^(\d+)구\s+(.+)$/);
  if (pitch) return pitch[2].includes('타격') ? null : `${pitch[1]}구 ${pitch[2]}`;
  const up = text.match(/^(\d+)번타자\s+(\S+)$/);
  if (up) return `${up[1]}번 타자 ${up[2]}`;
  if (/교체/.test(text)) return '선수 교체';
  const hit = RESULTS.find(([re]) => re.test(text));
  if (!hit) return /홈인/.test(text) ? '득점' : null;
  const name = text.match(/^([^\s:]+)\s*:/)?.[1];
  const label = /홈인/.test(text) && hit[1] !== '홈런' ? `${hit[1]}, 득점` : hit[1];
  return name ? `${name} ${label}` : label;
}

export function parsePlays(html) {
  const groups = new Map();
  for (const m of html.matchAll(/<span\b[^>]*id="rptLiveText(\d+)_spanLiveText_\d+"[^>]*>([\s\S]*?)<\/span>/g)) {
    const n = Number(m[1]);
    const text = clean(m[2]).replace(/^\s*-\s*/, '').replace(/\s*-{3,}$/, '').trim();
    groups.set(n, [...(groups.get(n) ?? []), text]);
  }
  const plays = [];
  let inn = 1;
  let half = '0';
  for (const [, texts] of [...groups].sort((a, b) => a[0] - b[0])) {
    for (const text of [...texts].reverse()) {
      const head = text.match(/^(\d+)회(초|말)\s+.+?\s+공격$/);
      if (head) { inn = Number(head[1]); half = head[2] === '초' ? '0' : '1'; continue; }
      const own = ownText(text);
      if (own) plays.push({ inn, homeOrAway: half, text: own });
    }
  }
  return plays.slice(-14).map((p, i) => ({
    no: plays.length - Math.min(14, plays.length) + i + 1, inn: p.inn, homeOrAway: p.homeOrAway,
    textOptions: [{ seqno: 1, text: p.text }],
  }));
}

const POS = { 1: '투수', 2: '포수', 3: '1루수', 4: '2루수', 5: '3루수', 6: '유격수', 7: '좌익수', 8: '중견수', 9: '우익수', D: '지명타자', H: '대타', R: '대주자' };

export function parseTeams(html) {
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map((m) => m[1]);
  const bat = tables.filter((t) => /<th[^>]*>\s*병살\s*<\/th>/.test(t));
  const pit = tables.filter((t) => /<th[^>]*>\s*투구\s*<\/th>/.test(t));
  const lineup = tables.filter((t) => /<caption>[^<]* 타자<\/caption>/.test(t));
  const side = (i) => ({
    batter: rows(bat[i] ?? '').filter((c) => c[0]).map((c) => {
      const slot = rows(lineup[i] ?? '').find((l) => l[2] === c[0]);
      return { pcode: c[0], name: c[0], posName: POS[slot?.[1]] ?? '', batOrder: Number(slot?.[0]) || undefined, ab: count(c[1]), hit: count(c[3]) };
    }),
    pitcher: rows(pit[i] ?? '').filter((c) => c[0]).map((c) => ({ pcode: c[0], name: c[0], inn: c[1], kk: count(c[9]) })),
  });
  return { away: side(0), home: side(1) };
}

export function parseScore(html) {
  const innings = rows(table(html, 'tblScoreBoard2'));
  const totals = rows(table(html, 'tblScoreBoard3'));
  if (innings.length !== 2 || totals.length !== 2) return null;
  const line = (r) => Object.fromEntries(r.map((v, i) => [i + 1, v]).filter(([, v]) => /^\d+$/.test(v)));
  const t = (i) => ({ h: totals[i][1] ?? '0', e: totals[i][2] ?? '0' });
  return { away: line(innings[0]), home: line(innings[1]), a: t(0), b: t(1) };
}

const STATUS = { 2: 'STARTED', 3: 'RESULT' };

export function mapGame(raw) {
  return {
    gameId: raw.G_ID, homeTeamName: raw.HOME_NM, awayTeamName: raw.AWAY_NM, homeTeamCode: raw.HOME_ID, awayTeamCode: raw.AWAY_ID,
    statusCode: STATUS[raw.GAME_STATE_SC] ?? 'BEFORE', gameDateTime: `${raw.G_DT.slice(0, 4)}-${raw.G_DT.slice(4, 6)}-${raw.G_DT.slice(6, 8)}T${raw.G_TM || ''}:00`,
    homeStarterName: raw.B_PIT_P_NM?.trim(), awayStarterName: raw.T_PIT_P_NM?.trim(),
  };
}

export function pickGame(games, team = TEAM) {
  const mine = (games || []).filter((g) => (g.HOME_ID === team || g.AWAY_ID === team) && !(Number(g.CANCEL_SC_ID) > 0));
  return mine.find((g) => String(g.GAME_STATE_SC) === '2') || mine[0] || null;
}

export function buildRelay(raw, view1, view2) {
  const top = raw.GAME_TB_SC === 'T';
  const score = parseScore(view1);
  const teams = parseTeams(view2);
  const pad = (v) => (Number(v) > 0 ? String(v) : '0');
  return {
    inn: raw.GAME_INN_NO || 1, homeOrAway: top ? '0' : '1',
    inningScore: { home: score?.home ?? {}, away: score?.away ?? {} },
    currentGameState: {
      homeScore: String(parseInt(raw.B_SCORE_CN, 10) || 0), awayScore: String(parseInt(raw.T_SCORE_CN, 10) || 0),
      homeHit: score?.b.h ?? '0', awayHit: score?.a.h ?? '0', homeError: score?.b.e ?? '0', awayError: score?.a.e ?? '0',
      ball: String(raw.BALL_CN ?? 0), strike: String(raw.STRIKE_CN ?? 0), out: String(raw.OUT_CN ?? 0),
      base1: pad(raw.B1_BAT_ORDER_NO), base2: pad(raw.B2_BAT_ORDER_NO), base3: pad(raw.B3_BAT_ORDER_NO),
      batter: (top ? raw.T_P_NM : raw.B_P_NM)?.trim() || '', pitcher: (top ? raw.B_P_NM : raw.T_P_NM)?.trim() || '',
    },
    homeLineup: teams.home, awayLineup: teams.away, homeEntry: teams.home, awayEntry: teams.away,
    textRelays: parsePlays(view2),
  };
}

const delayFor = (g) => {
  if (!g) return 600_000;
  if (g.statusCode === 'STARTED') return 8_000;
  if (g.statusCode === 'RESULT') return 300_000;
  return 60_000;
};

let lastBody = '';
let lastWrite = 0;
function publish(game, relay) {
  const body = JSON.stringify({ game, relay });
  const now = Date.now();
  // unchanged content keeps the same ETag, so browsers get a cheap 304 between pitches
  if (body === lastBody && now - lastWrite < HEARTBEAT_MS) return;
  lastBody = body;
  lastWrite = now;
  const file = join(OUT, 'state.json');
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify({ checkedAt: now, game, relay }), { mode: 0o644 });
  renameSync(tmp, file); // atomic, so Nginx never serves half a file
}

export async function tick(previous) {
  const raw = pickGame(await fetchGames(kstDate()));
  const game = raw ? mapGame(raw) : null;
  let relay = previous?.game?.gameId === game?.gameId ? previous?.relay ?? null : null;
  if (game && game.statusCode !== 'BEFORE') {
    const [view1, view2] = await fetchViews(raw);
    relay = buildRelay(raw, view1, view2);
  }
  publish(game, relay);
  return { game, relay };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  let state = null;
  let failures = 0;
  for (;;) {
    try {
      state = await tick(state);
      failures = 0;
      await sleep(delayFor(state.game));
    } catch (e) {
      failures += 1;
      const wait = Math.min(5_000 * 2 ** failures, MAX_BACKOFF_MS);
      console.error(new Date().toISOString(), e.message, `retry in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) main();
