/* ============================================================
   Fi一把 · 游戏核心（纯逻辑，DOM 无关）
   玩法参照「弗一把」三态模型：绿=命中 / 黄=接近 / 黑=未中，年份与热度带 ↑↓ 箭头
   ============================================================ */

import { SONGS, ARTISTS, REGION_GROUP, HEAT_MAX } from './bank.js';

export const MAX_ATTEMPTS = 20; // 20 次机会（曲库扩容后原 8 次不够用）
const EPOCH = '2026-11-17'; // 第 1 期起点

/* —— 期号与每日题目（确定性种子，所有设备同一天同一题） —— */

function localDateKey(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function dateKeyNow() { return localDateKey(); }

export function episodeNo(key = dateKeyNow()) {
  const diff = Math.floor((new Date(key + 'T00:00:00') - new Date(EPOCH + 'T00:00:00')) / 86400000);
  return Math.max(1, diff + 1);
}

// 每日题：确定性散列 → 池内取题（答案池=热度≥3，保证每日题的大众性）
function hashSeed(key) {
  let h = 2166136261;
  for (const c of key) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/* —— 答案唯一性守卫 ——
   判定只有六项属性，若两首歌六项全同，玩家猜中"孪生歌"也会看到全绿却不获胜 → 混淆。
   因此：出题只在「六项组合在全库唯一」的曲目里选（口径与判定一致：流派取集合）。 */

const signatureOf = s => [s.ar, s.rg, s.lg, [...s.gn].sort().join('+'), s.yr, s.ht, s.alb || '', titleLen(s.t)].join('|');
let _sigCount = null;

function isUniqueAnswer(s) {
  if (!_sigCount) {
    _sigCount = new Map();
    for (const x of SONGS) { const k = signatureOf(x); _sigCount.set(k, (_sigCount.get(k) || 0) + 1); }
  }
  return _sigCount.get(signatureOf(s)) === 1;
}

// 过滤出唯一答案；若过滤后为空（极窄范围）则回退为原池，保证有题可出
// 另：八项属性要齐全（专辑已抓到）才能当答案——否则答案的专辑格永远是"—"，八项信息不完整
export function uniqify(pool) {
  const withAlb = pool.filter(s => s.alb);
  const base = withAlb.length ? withAlb : pool;
  const u = base.filter(isUniqueAnswer);
  return u.length ? u : base;
}

/* —— 公平池：热度≥4 且年份已核实（q=0）—— 每日与标准模式共用；无限练习才吃全库 —— */

export function standardPool() { return uniqify(SONGS.filter(s => s.ht >= 4 && !s.q)); }

export function dailyAnswer(key = dateKeyNow()) {
  const pool = standardPool();
  return pool[hashSeed('fi:' + key) % pool.length];
}

export function randomAnswer(rng = Math.random) {
  return SONGS[Math.floor(rng() * SONGS.length)];
}

export function randomArtist(rng = Math.random) {
  return ARTISTS[Math.floor(rng() * ARTISTS.length)];
}

/* —— 简单模式：热度满档（5）且 1996 年之后的国民级歌 —— */

/* —— 简单模式：国民级歌（1996 年后）——
   热度满档（5）的全部收录，另加「热 4 且国语」——国语是绝大多数人最熟的语种，
   这样池子从 ~48 首扩到 ~230 首，仍是"耳熟能详"的难度 */
export function simplePool() {
  return uniqify(SONGS.filter(s =>
    s.yr > 1995 && (s.ht === 5 || (s.ht === 4 && s.lg === '国语'))
  ));
}

export function simpleAnswer(rng = Math.random) {
  const pool = simplePool();
  return pool[Math.floor(rng() * pool.length)];
}

/* —— 自定义范围：答题前固定 年代/地区/语言/流派/最低热度 —— */

function decadeOf(year) { return Math.floor(year / 10) * 10; }

export function scopePool(scope = {}) {
  const { decades = [], regions = [], langs = [], genres = [], minHeat = 0 } = scope;
  return uniqify(SONGS.filter(s =>
    // 「70 前」chip（值 1970）按标签语义覆盖一切 1980 年前的曲目（含古典），否则古典年份被筛成空
    (!decades.length || decades.includes(decadeOf(s.yr)) || (decades.includes(1970) && s.yr < 1970)) &&
    (!regions.length || regions.includes(s.rg)) &&
    (!langs.length || langs.includes(s.lg)) &&
    (!genres.length || s.gn.some(g => genres.includes(g))) &&
    (!minHeat || s.ht >= minHeat)
  ));
}

export function scopeAnswer(scope, rng = Math.random) {
  const pool = scopePool(scope);
  if (!pool.length) return null;
  return pool[Math.floor(rng() * pool.length)];
}

/* —— 标准池：热度≥4 的高传唱度曲（每日与标准模式共用，公平性灯下黑最少）+ 会话战绩，可反复开局 —— */

// 出题避开最近抽过的（recent 由会话战绩维护）
export function standardAnswer(rng = Math.random, recent = []) {
  const fresh = standardPool().filter(s => !recent.includes(s.id));
  const list = fresh.length ? fresh : standardPool();
  return list[Math.floor(rng() * list.length)];
}

const DEFAULT_STD = { streak: 0, best: 0, played: 0, won: 0, sumWon: 0, recent: [] };

export function loadStd() { return { ...DEFAULT_STD, ...(store.get('std', null) || {}) }; }
export function saveStd(std) { store.set('std', std); }

export function applyStdResult(std, won, answerId, attempts = 0) {
  const streak = won ? (std.streak || 0) + 1 : 0;
  return {
    streak,
    best: Math.max(std.best || 0, streak),
    played: (std.played || 0) + 1,
    won: (std.won || 0) + (won ? 1 : 0),
    sumWon: (std.sumWon || 0) + (won ? attempts : 0),   // 命中局步数之和 → 平均步数
    recent: [answerId, ...(std.recent || [])].slice(0, 6),
  };
}

// 局实体池与查找（UI 恢复历史 / 判定共用）
function poolOf(kind) { return kind === 'artist' ? ARTISTS : SONGS; }
export function entityById(kind, id) { return poolOf(kind).find(x => x.id === id) || null; }
// 六属性键序（分享格与渲染共用）——现为八项
function attrKeys(kind) {
  return kind === 'artist'
    ? ['sex', 'rg', 'lg', 'gn', 'yr', 'count']
    : ['sex', 'rg', 'lg', 'gn', 'yr', 'ht', 'alb', 'len'];
}

/* —— 单属性判定：返回 {s: 'hit'|'near'|'miss', arrow?: 1|-1} —— */
// arrow: 1 = 答案数值更大(更晚/更热/更多)，-1 = 更小

function judgeNumeric(guessVal, answerVal, band) {
  const diff = answerVal - guessVal;
  if (diff === 0) return { s: 'hit' };
  const arrow = diff > 0 ? 1 : -1;
  if (Math.abs(diff) <= band) return { s: 'near', arrow };
  return { s: 'miss', arrow };
}

function judgeSex(guess, answer) {
  return { s: guess.sex === answer.sex ? 'hit' : 'miss' };
}

// 猜歌第一格「歌手」：同名=绿（强信号，锁定到该歌手的作品）
// 同性别=黄（弱信号）；性别也分属不同则黑
function judgeArtistName(guess, answer) {
  if (guess.ar === answer.ar) return { s: 'hit' };
  if (guess.sex === answer.sex) return { s: 'near' };
  return { s: 'miss' };
}

function judgeRegion(guess, answer) {
  if (guess.rg === answer.rg) return { s: 'hit' };
  if (REGION_GROUP[guess.rg] === REGION_GROUP[answer.rg]) return { s: 'near' };
  return { s: 'miss' };
}

function judgeLang(guess, answer) {
  return { s: guess.lg === answer.lg ? 'hit' : 'miss' };
}

// 流派·主流派口径（用于猜歌手：歌手流派是并集，集合口径几乎永远不绿）
function judgeGenrePrimary(guess, answer) {
  const gSet = new Set(guess.gn);
  if (guess.gn[0] === answer.gn[0]) return { s: 'hit' };
  if (answer.gn.some(x => gSet.has(x))) return { s: 'near' };
  return { s: 'miss' };
}

// 流派·集合口径（用于猜歌：完全一致才绿，有交集为黄）——能区分"同主流派不同副流派"的歌
function judgeGenreSet(guess, answer) {
  const key = arr => [...arr].sort().join('+');
  if (key(guess.gn) === key(answer.gn)) return { s: 'hit' };
  const gSet = new Set(guess.gn);
  if (answer.gn.some(x => gSet.has(x))) return { s: 'near' };
  return { s: 'miss' };
}

// 曲名字数：去掉空白与标点后的字符数（中英一致口径）
export function titleLen(t) {
  return [...String(t).replace(/[\s·・,，.。!！?？'"“”‘’()（）\-—–_/\\[\]]+/g, '')].length;
}

// 猜歌：歌手（同名绿/同性别黄）、流派（集合口径）、年份/热度/字数 邻档黄、专辑（同名绿否则黑）
function judgeSong(guess, answer) {
  return {
    sex: judgeArtistName(guess, answer),
    rg: judgeRegion(guess, answer),
    lg: judgeLang(guess, answer),
    gn: judgeGenreSet(guess, answer),
    yr: judgeNumeric(guess.yr, answer.yr, 1),
    ht: judgeNumeric(guess.ht, answer.ht, 1),
    alb: { s: guess.alb && answer.alb && guess.alb === answer.alb ? 'hit' : 'miss' },
    len: judgeNumeric(titleLen(guess.t), titleLen(answer.t), 1),
  };
}

// 猜歌手：年代放宽到 ±2 黄（库内最早作品年份本身是近似值），曲量 ±1 黄
function judgeArtist(guess, answer) {
  return {
    sex: judgeSex(guess, answer),
    rg: judgeRegion(guess, answer),
    lg: judgeLang(guess, answer),
    gn: judgeGenrePrimary(guess, answer),
    yr: judgeNumeric(guess.yr, answer.yr, 2),
    count: judgeNumeric(guess.count, answer.count, 1),
  };
}

// 六属性判定（顺序即 UI 色块顺序；按实体类型分派）
export function judge(guess, answer) {
  return answer.kind === 'artist' ? judgeArtist(guess, answer) : judgeSong(guess, answer);
}

function isWin(guess, answer) { return guess.id === answer.id; }

/* —— 局状态机（内存态；持久化由宿主适配层完成） ——
   round = { mode: 'daily'|'free', episode, answerId, guesses: [songId], done, won, startedAt } */

export function newRound(mode, answer, episode = null) {
  return { mode, kind: answer.kind, episode, answerId: answer.id, guesses: [], done: false, won: false };
}

export function applyGuess(round, guess, answer) {
  if (round.done || round.guesses.length >= MAX_ATTEMPTS) return round;
  const win = isWin(guess, answer);
  const next = { ...round, guesses: [...round.guesses, guess.id] };
  if (win) { next.done = true; next.won = true; }
  else if (next.guesses.length >= MAX_ATTEMPTS) { next.done = true; next.won = false; }
  return next;
}

export function giveUp(round) {
  return { ...round, done: true, won: false };
}

/* —— 战绩格（Wordle 式 emoji，分享文本用） —— */

const CELL = { hit: '🟩', near: '🟨', miss: '⬛' };
const ARROW = { 1: '↑', '-1': '↓' };

export function shareGrid(round, answer, judgeFn = judge) {
  const rows = [];
  const keys = attrKeys(round.kind);
  for (const id of round.guesses) {
    const g = entityById(round.kind, id);
    if (!g) continue;
    const j = judgeFn(g, answer);
    let line = '';
    for (const k of keys) {
      line += CELL[j[k].s];
      if (j[k].arrow) line += ARROW[j[k].arrow];
    }
    rows.push(line);
  }
  return rows;
}

export function shareText(round, answer, grid) {
  const result = round.won
    ? (round.mode === 'daily' ? round.guesses.length + '/' + MAX_ATTEMPTS : round.guesses.length + ' 次猜中')
    : (round.mode === 'daily' ? 'X/' + MAX_ATTEMPTS : '未猜中');
  const MODE_LABEL = { daily: '每日挑战', artist: '猜歌手', standard: '标准模式', simple: '简单模式', custom: '自定义范围', free: '无限练习' };
  const head = round.mode === 'daily'
    ? `Fi一把 第${round.episode}期 ${result}`
    : `Fi一把 ${MODE_LABEL[round.mode] || '无限练习'} ${result}`;
  return [head, ...grid].join('\n');
}

/* —— 持久化适配层：浏览器 localStorage 起步，后续换 hb-sdk storage —— */

const store = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem('fi_' + key); return v == null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('fi_' + key, JSON.stringify(value)); } catch { /* 配额/隐私模式静默 */ }
  },
};

export function loadDaily(key) { return store.get('daily_' + key, null); }
export function saveDaily(key, round) { store.set('daily_' + key, round); }
export function loadStats() { return store.get('stats', { streak: 0, best: 0, played: 0, won: 0 }); }
export function saveStats(st) { store.set('stats', st); }

// 结算后更新连胜（只在每日题生效；自由模式不进连胜）
export function applyDailyResult(stats, won) {
  const next = { ...stats, played: stats.played + 1 };
  if (won) { next.won = stats.won + 1; next.streak = stats.streak + 1; next.best = Math.max(next.best, next.streak); }
  else next.streak = 0;
  return next;
}
