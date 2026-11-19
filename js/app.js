/* ============================================================
   Fi一把 · UI 装配（DOM 层）
   视图切换=瞬时（承接上项目红线 14）；动效只挂在交互时刻
   ============================================================ */

import hbSDK, { AuthorFollowStatus } from '@heybox/hb-sdk';
import AUDIO_MAP from './audio-map.js';
import { playClip, playTap, resetTapScale, stopSound, soundEnabled, setSoundEnabled, tapEnabled, setTapEnabled, tapTuneId, setTapTune, TAP_TUNE_LIST } from './audio.js';
import { SONGS, ARTISTS, HEAT_MAX, REGIONS, LANGS, GENRES, lookupSong, searchSongs, lookupArtist, searchArtists } from './bank.js';
import {
  MAX_ATTEMPTS, episodeNo, dateKeyNow, dailyAnswer, randomAnswer, randomArtist,
  judge, newRound, applyGuess, giveUp, loadDaily, saveDaily,
  loadStats, saveStats, applyDailyResult, shareGrid, shareText, entityById,
  standardAnswer, loadStd, saveStd, applyStdResult,
  simplePool, simpleAnswer, scopePool, scopeAnswer, titleLen,
} from './game.js';

const $ = id => document.getElementById(id);

/* —— 局类型配置：猜歌 / 猜歌手 共用同一套六格 UI —— */

const KINDS = {
  song: {
    search: searchSongs,
    lookup: lookupSong,
    pool: () => SONGS,
    attrs: [
      ['sex', '歌手'], ['rg', '地区'], ['lg', '语言'], ['gn', '流派'],
      ['yr', '年份'], ['ht', '热度'], ['alb', '专辑'], ['len', '字数'],
    ],
    placeholder: '从曲库中选择一首歌…',
    poolLabel: '曲库曲量',
    toastInvalid: '请从曲库列表中选择',
  },
  artist: {
    search: searchArtists,
    lookup: lookupArtist,
    pool: () => ARTISTS,
    attrs: [['sex', '性别'], ['rg', '地区'], ['lg', '语言'], ['gn', '流派'], ['yr', '年代'], ['count', '曲量']],
    placeholder: '从歌手库中选择一位歌手…',
    poolLabel: '歌手库规模',
    toastInvalid: '请从歌手库列表中选择',
  },
};

function kindCfg(kind) { return KINDS[kind] || KINDS.song; }
function currentKind() { return (round && round.kind) === 'artist' ? 'artist' : 'song'; }

// 属性值 → 展示文本（猜歌第一格是歌手本体；猜歌手第一格是性别）
function attrValue(kind, key, e) {
  switch (key) {
    case 'sex': return kind === 'song' ? e.ar : e.sex;
    case 'rg': return e.rg;
    case 'lg': return e.lg;
    // 猜歌：流派格显示完整集合（集合判定才读得懂，如「流行·R&B」）；猜歌手：只显示主流派（并集太长）
    case 'gn': return kind === 'song' ? e.gn.join('·') : e.gn[0];
    case 'yr': return String(e.yr);
    case 'ht': return heatDots(e.ht);
    case 'alb': return kind === 'song' ? (e.alb || '—') : '';
    case 'len': return String(titleLen(e.t));
    case 'count': return e.count + ' 首';
    default: return '';
  }
}

// 小注：猜歌「歌手」格标出该歌手性别（黄=同性别的判读依据）
function attrSub(kind, key, e) {
  return kind === 'song' && key === 'sex' ? e.sex : '';
}

// 行副标题：猜歌的歌手名已进首格，副标题留空；猜歌手给 流派 · 曲量
function rowSecondary(kind, e) {
  return kind === 'artist' ? `${e.gn[0]} · 曲库 ${e.count} 首` : '';
}

// 补全列表副标题：必须显示歌手名——同名歌（如两首《朋友》）靠它区分
function acSecondary(kind, e) {
  return kind === 'artist' ? `${e.gn[0]} · 曲库 ${e.count} 首` : e.ar;
}

/* —— 状态 —— */
let round = null;            // 当前局
let roundAnswer = null;      // 当前局答案（内存；持久化只存 round）
let acItems = [];            // 补全候选
let acIndex = -1;
let pickedId = null;         // 补全中选定的实体 id（同名歌消歧：选中即锁定，不靠文本反查）

/* —— 视图切换（瞬时） —— */
function showView(name) {
  for (const v of document.querySelectorAll('.view')) v.classList.remove('view--active');
  $('view' + name).classList.add('view--active');
}

/* —— toast —— */
let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('toast--show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('toast--show'), 1800);
}

/* —— 优雅过渡工具 —— */

// 浮层关闭：先播 200ms 沉底淡出，再移除 open（避免 display 瞬断）
function closeMask(mask, after) {
  if (mask.classList.contains('mask-closing')) return; // 关闭动画进行中：忽略重复触发（✕ 与点蒙层可同时到达）
  const isOpen = mask.classList.contains('result-mask--open') || mask.classList.contains('sheet-mask--open');
  if (!isOpen) { if (after) after(); return; }
  mask.classList.add('mask-closing');
  setTimeout(() => {
    mask.classList.remove('result-mask--open', 'sheet-mask--open', 'mask-closing');
    if (after) after();
  }, 210);
}

// 历史行插入：FLIP——旧行平滑下移让位，新行自带入场
function prependRow(rowEl) {
  const list = $('history');
  const prev = [...list.children].map(el => ({ el, top: el.getBoundingClientRect().top }));
  list.prepend(rowEl);
  for (const { el, top } of prev) {
    const d = top - el.getBoundingClientRect().top;
    if (d) {
      el.style.transition = 'none';
      el.style.transform = `translateY(${d}px)`;
    }
  }
  requestAnimationFrame(() => requestAnimationFrame(() => {
    for (const { el } of prev) {
      if (el.style.transform) {
        el.style.transition = 'transform 300ms cubic-bezier(.22,1,.36,1)';
        el.style.transform = '';
      }
    }
    setTimeout(() => { for (const { el } of prev) { el.style.transition = ''; } }, 340);
  }));
}

// 数字滚动（结算统计），非数字保持原样；decimals 支持小数（平均步数）
function countUp(el, to, dur = 520, decimals = 0) {
  if (!Number.isFinite(to)) return;
  const t0 = performance.now();
  const step = t => {
    const p = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = (to * e).toFixed(decimals);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// 连胜徽章跳动
function bumpStreak() {
  const chip = $('streakChip');
  chip.classList.remove('bump');
  void chip.offsetWidth; // 重置动画
  chip.classList.add('bump');
  setTimeout(() => chip.classList.remove('bump'), 460);
}

/* —— 触摸涟漪：手指按下的地方光波向四周扩散 ——
   性能方案（真机两轮崩溃后重写为**元素池**）：
   · 启动时一次性创建 3 个涟漪元素，之后只改 style + 重启动画，**不再 createElement / remove**
   · 直径封顶 1400px（原来按「最远角×2.6」可达 3300px）
   · 60ms 节流；连点复用最老的那个元素
   · 每个涟漪 2 个子元素；无 box-shadow、无 mix-blend-mode */

const RIPPLE_COLORS = ['124,92,255', '34,211,238', '244,114,182', '251,191,36'];
const RIPPLE_POOL_SIZE = 3;
const RIPPLE_MAX_SIZE = 1400;
const RIPPLE_MIN_INTERVAL = 60;
const RIPPLE_LIFE = 2100;
let rippleHue = 0;
let rippleCursor = 0;
let lastRippleAt = 0;
const rippleLayer = $('rippleLayer');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// —— 池：一次性建好，永久复用 ——
const ripplePool = [];
if (rippleLayer) {
  for (let i = 0; i < RIPPLE_POOL_SIZE; i++) {
    const el = document.createElement('div');
    el.className = 'ripple';
    el.style.opacity = '0';
    el.innerHTML = '<i class="ripple__disc"></i><i class="ripple__ring"></i>';
    rippleLayer.appendChild(el);
    ripplePool.push(el);
  }
}

function spawnRipple(x, y) {
  if (!ripplePool.length) return;

  const el = ripplePool[rippleCursor];
  rippleCursor = (rippleCursor + 1) % RIPPLE_POOL_SIZE;

  const w = window.innerWidth, h = window.innerHeight;
  const far = Math.max(
    Math.hypot(x, y), Math.hypot(w - x, y),
    Math.hypot(x, h - y), Math.hypot(w - x, h - y)
  );
  const size = Math.min(far * 2.2, RIPPLE_MAX_SIZE);

  el.style.left = (x - size / 2).toFixed(0) + 'px';
  el.style.top = (y - size / 2).toFixed(0) + 'px';
  el.style.width = size.toFixed(0) + 'px';
  el.style.height = size.toFixed(0) + 'px';
  el.style.setProperty('--rc', RIPPLE_COLORS[rippleHue++ & 3]);

  // 重启动画：先摘掉 class 触发回流，再加回去（比 replaceChild 便宜）
  el.classList.remove('ripple--on');
  void el.offsetWidth;
  el.classList.add('ripple--on');
}

document.addEventListener('pointerdown', e => {
  if (reduceMotion.matches) return;
  const now = performance.now();
  if (now - lastRippleAt < RIPPLE_MIN_INTERVAL) return;
  lastRippleAt = now;
  spawnRipple(e.clientX, e.clientY);
  playTap(); // 与涟漪同源触发：第 n 次点击 = 第 n 个音 = 第 n 种涟漪色
}, { capture: true, passive: true });

/* ================= 主页 ================= */

function dotsHTML(round) {
  let html = '';
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    let cls = 'dots__dot';
    if (round && i < round.guesses.length) cls += ' dots__dot--used';
    else if (round && !round.done && i === round.guesses.length) cls += ' dots__dot--now';
    html += `<i class="${cls}"></i>`;
  }
  return html;
}

function renderHome() {
  const key = dateKeyNow();
  const ep = episodeNo(key);
  const saved = loadDaily(key);
  const stats = loadStats();

  $('streakNum').textContent = stats.streak;
  $('heroEpisode').textContent = `第 ${ep} 期`;

  const vinyl = $('heroVinyl');
  const eq = $('heroEq');
  eq.classList.remove('eq--live');
  $('heroDots').className = 'dots' + (MAX_ATTEMPTS > 10 ? ' dots--many' : '');
  $('heroDots').innerHTML = dotsHTML(saved);

  const cta = $('heroCta');
  cta.onclick = null;

  if (!saved) {
    $('heroStatus').textContent = `今日歌曲待猜 · ${MAX_ATTEMPTS} 次机会`;
    cta.textContent = '开始挑战';
    cta.disabled = false;
    cta.onclick = () => startDaily();
  } else if (!saved.done) {
    eq.classList.add('eq--live');
    $('heroStatus').textContent = `继续挑战 · 已猜 ${saved.guesses.length}/${MAX_ATTEMPTS}`;
    cta.textContent = '继续挑战';
    cta.disabled = false;
    cta.onclick = () => resumeDaily(saved);
  } else {
    $('heroStatus').textContent = saved.won
      ? `今日已答对 · 用了 ${saved.guesses.length}/${MAX_ATTEMPTS} 次`
      : '今日未答出 · 明天再来';
    cta.textContent = '查看战绩';
    cta.disabled = false;
    cta.onclick = () => { openDailyResult(saved); };
  }

  // 已完成的局：唱片亮起答对流光（克制：只换阴影色，不加新动画）
  if (saved && saved.done && saved.won) {
    vinyl.style.boxShadow = '0 0 0 1px rgba(52,211,153,.5), 0 14px 34px rgba(52,211,153,.2), inset 0 0 30px rgba(0,0,0,.6)';
  } else {
    vinyl.style.boxShadow = '';
  }
}

/* 每日倒计时：到当地零点重置 */
let lastDateKey = dateKeyNow();
function tickCountdown() {
  // 跨零点检测：新一期开始时自动刷新主页状态
  // （否则倒计时走到 00:00:00 后，卡片仍显示"今日已答对/未答出"，要手动刷新页面）
  const key = dateKeyNow();
  if (key !== lastDateKey) {
    lastDateKey = key;
    renderHome();
  }
  const now = new Date();
  const next = new Date(now); next.setHours(24, 0, 0, 0);
  const s = Math.max(0, Math.floor((next - now) / 1000));
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor(s % 3600 / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  $('heroCountdown').textContent = `下一期 ${h}:${m}:${sec} 后`;
}
setInterval(tickCountdown, 1000);

/* ================= 开局 ================= */

function startDaily() {
  const key = dateKeyNow();
  round = newRound('daily', dailyAnswer(key), episodeNo(key));
  roundAnswer = dailyAnswer(key);
  saveDaily(key, round);
  enterRound();
}

function resumeDaily(saved) {
  round = saved;
  // 答案以存档为准（池子扩容后重算会漂移）
  roundAnswer = entityById('song', saved.answerId) || dailyAnswer(dateKeyNow());
  enterRound();
}

function startFree() {
  round = newRound('free', randomAnswer());
  roundAnswer = entityById('song', round.answerId);
  enterRound();
}

function startArtist() {
  round = newRound('artist', randomArtist());
  roundAnswer = entityById('artist', round.answerId);
  enterRound();
}

// 标准模式：标准池随机（避开最近出过的），反复开局并记录本模式连胜/胜率
function startStandard() {
  round = newRound('standard', standardAnswer(Math.random, loadStd().recent));
  roundAnswer = entityById('song', round.answerId);
  enterRound();
}

// 简单模式：热度满档且 1996 年后的国民级歌
function startSimple() {
  round = newRound('simple', simpleAnswer());
  round.poolSize = simplePool().length;
  roundAnswer = entityById('song', round.answerId);
  enterRound();
}

/* —— 自定义范围：答题前固定 年代/地区/语言/流派/热度 —— */

const SCOPE_GROUPS = [
  { key: 'decades', label: '年代', items: [[1970, '70 前'], [1980, '80 年代'], [1990, '90 年代'], [2000, '00 年代'], [2010, '10 年代'], [2020, '20 年代']] },
  { key: 'regions', label: '地区', items: REGIONS.map(r => [r, r]) },
  { key: 'langs', label: '语言', items: LANGS.map(l => [l, l]) },
  { key: 'genres', label: '流派', items: GENRES.map(g => [g, g]) },
];
const HEAT_CHOICES = [[0, '不限'], [4, '≥ 4'], [5, '仅 5']];

const scope = { decades: [], regions: [], langs: [], genres: [], minHeat: 0 };
let lastScope = null;

function renderScope() {
  const chip = (g, v, label, on) =>
    `<button class="scope-chip${on ? ' scope-chip--on' : ''}" data-g="${g}" data-v="${v}">${label}</button>`;
  $('scopeGroups').innerHTML = SCOPE_GROUPS.map(g => `
    <div class="scope-group">
      <div class="scope-label">${g.label}</div>
      <div class="scope-chips">${g.items.map(([v, l]) => chip(g.key, v, l, scope[g.key].includes(v))).join('')}</div>
    </div>`).join('') + `
    <div class="scope-group">
      <div class="scope-label">热度</div>
      <div class="scope-chips">${HEAT_CHOICES.map(([v, l]) => chip('minHeat', v, l, scope.minHeat === v)).join('')}</div>
    </div>`;
  const n = scopePool(scope).length;
  $('scopeCount').textContent = n + ' 首';
  $('scopeStart').disabled = n === 0;
}

function startCustom(useLast = false) {
  if (useLast && lastScope) { launchScopeRound(lastScope); return; }
  renderScope();
  $('scopeMask').classList.add('sheet-mask--open');
}

function launchScopeRound(s) {
  const answer = scopeAnswer(s);
  if (!answer) { toast('该范围没有题目，放宽条件试试'); return; }
  lastScope = { decades: [...s.decades], regions: [...s.regions], langs: [...s.langs], genres: [...s.genres], minHeat: s.minHeat };
  round = newRound('custom', answer);
  round.poolSize = scopePool(s).length;
  roundAnswer = entityById('song', round.answerId);
  closeMask($('scopeMask'), () => enterRound());
}

function enterRound() {
  const kind = currentKind();
  resetTapScale(); // 每局点击音从 C5 起步，音阶循环不跨局累积
  $('roundMode').textContent = kind === 'artist'
    ? '猜歌手'
    : round.mode === 'daily' ? `每日挑战 · 第 ${round.episode} 期`
      : round.mode === 'standard' ? '标准模式'
        : round.mode === 'simple' ? '简单模式'
          : round.mode === 'custom' ? '自定义范围' : '无限练习';
  input.placeholder = kindCfg(kind).placeholder;
  $('history').innerHTML = '';
  $('giveupWrap').style.display = 'none';
  $('resultReopenWrap').style.display = 'none';
  setSubmitEnabled(false);
  input.value = '';
  pickedId = null;
  closeAC();
  showView('Round');
  // 逐条恢复历史（静默渲染，不重播揭示动画）
  const answer = roundAnswer;
  for (const id of round.guesses) {
    const g = entityById(kind, id);
    if (!g) continue;
    $('history').appendChild(buildGuessRow(g, answer, judge(g, answer), false));
  }
  if (!round.done && round.guesses.length > 0) $('giveupWrap').style.display = '';
  if (round.done) openResult();
}

/* ================= 输入与补全 ================= */

const input = $('guessInput');
const acBox = $('acList');

function closeAC() { acBox.classList.remove('ac--open'); acItems = []; acIndex = -1; }

function renderAC(list) {
  acItems = list; acIndex = list.length ? 0 : -1;
  if (!list.length) { closeAC(); return; }
  const kind = currentKind();
  acBox.innerHTML = list.map((s, i) => `
    <div class="ac__item${i === acIndex ? ' ac__item--hl' : ''}" data-id="${s.id}">
      <span class="ac__title">${esc(s.t)}</span>
      <span class="ac__artist">${esc(acSecondary(kind, s))}</span>
    </div>`).join('');
  acBox.classList.add('ac--open');
}

acBox.addEventListener('click', e => {
  const item = e.target.closest('.ac__item');
  if (!item) return;
  chooseAC(item.dataset.id);
});

function chooseAC(id) {
  const entity = entityById(currentKind(), id);
  if (!entity) return;
  pickedId = entity.id;          // 锁定所选实体（同名歌消歧）
  input.value = entity.t;
  closeAC();
  setSubmitEnabled(true);
  input.focus();
}

function setSubmitEnabled(on) { $('btnSubmit').disabled = !on; }

input.addEventListener('input', () => {
  pickedId = null;
  setSubmitEnabled(false);
  renderAC(kindCfg(currentKind()).search(input.value));
});

input.addEventListener('keydown', e => {
  // 中文输入法组合中：回车/方向键是选词操作，不能当作提交或补全导航
  // （否则打「周杰伦」选字时按回车上屏，会直接把半截拼音提交成猜测）
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!acItems.length) return;
    e.preventDefault();
    acIndex = (acIndex + (e.key === 'ArrowDown' ? 1 : -1) + acItems.length) % acItems.length;
    acBox.querySelectorAll('.ac__item').forEach((el, i) => el.classList.toggle('ac__item--hl', i === acIndex));
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (acItems.length && acBox.classList.contains('ac--open')) chooseAC(acItems[Math.max(0, acIndex)].id);
    else submitGuess();
  } else if (e.key === 'Escape') {
    closeAC();
  }
});

document.addEventListener('click', e => {
  if (!e.target.closest('.guess-field')) closeAC();
});

/* ================= 提交与渲染 ================= */

$('btnSubmit').addEventListener('click', submitGuess);

function submitGuess() {
  const kind = currentKind();
  const entity = (pickedId && entityById(kind, pickedId)) || kindCfg(kind).lookup(input.value);
  if (!entity) { toast(kindCfg(kind).toastInvalid); return; }
  pickedId = null;
  round = applyGuess(round, entity, roundAnswer);
  if (round.mode === 'daily') saveDaily(dateKeyNow(), round);

  input.value = '';
  closeAC();
  setSubmitEnabled(false);

  const j = judge(entity, roundAnswer);
  const rowEl = buildGuessRow(entity, roundAnswer, j, true);
  prependRow(rowEl);
  if (!round.done) $('giveupWrap').style.display = '';

  // 猜中：立刻播该曲片段（此刻仍在点击手势内，不会被自动播放策略拦截）
  if (round.done && round.won) playAnswerClip(roundAnswer);

  if (round.done) setTimeout(() => openResult(), 520);
}

function buildGuessRow(guess, answer, j, animate) {
  const kind = currentKind();
  const win = guess.id === answer.id;
  const row = document.createElement('div');
  row.className = 'guess-row';
  row.innerHTML = `
    <div class="guess-row__head">
      <span class="guess-row__song${win ? ' guess-row__song--answer' : ''}">${esc(guess.t)}${win ? ' ✓' : ''}</span>
      <span class="guess-row__no">${esc(rowSecondary(kind, guess))}</span>
    </div>
    <div class="chips${kindCfg(kind).attrs.length > 6 ? ' chips--4' : ''}">
      ${kindCfg(kind).attrs.map(([k, label]) => chip(
        label,
        attrValue(kind, k, guess),
        j[k],
        attrSub(kind, k, guess),
        k === 'alb' ? ' chip--album' : (kind === 'song' && k === 'sex' ? ' chip--name' : '')
      )).join('')}
    </div>`;

  if (animate) {
    // 揭示波：JS 逐个点亮（判定时刻核心反馈）；歌词纪律=无任何歌词内容
    const chips = row.querySelectorAll('.chip');
    chips.forEach((c, i) => setTimeout(() => c.classList.add('lit'), 60 + i * 55));
  } else {
    row.querySelectorAll('.chip').forEach(c => c.classList.add('lit'));
  }
  return row;
}

function chip(label, val, j, sub = '', extraClass = '') {
  const arrow = j.arrow ? `<span class="chip__arrow">${j.arrow > 0 ? '↑' : '↓'}</span>` : '';
  const subEl = sub ? `<span class="chip__sub">${esc(sub)}</span>` : '';
  return `<div class="chip chip--${j.s}${extraClass}">
    <div class="chip__label">${label}</div>
    <div class="chip__val num">${esc(val)}${arrow}${subEl}</div>
  </div>`;
}

function heatDots(ht) {
  return '●'.repeat(ht) + '·'.repeat(HEAT_MAX - ht);
}

function esc(x) {
  return String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ================= 放弃 ================= */

$('btnGiveup').addEventListener('click', () => {
  if (!round || round.done) return;
  round = giveUp(round);
  if (round.mode === 'daily') saveDaily(dateKeyNow(), round);
  playAnswerClip(roundAnswer); // 放弃揭晓同样播答案片段（与赢局一致）
  openResult();
});

// 离开局内/回主页时停掉正在播的片段
['btnBack', 'btnHome'].forEach(id => {
  const el = $(id);
  if (el) el.addEventListener('click', stopSound);
});

/* ================= 规则浮层 ================= */

$('btnHelp').addEventListener('click', () => $('sheetMask').classList.add('sheet-mask--open'));
$('btnCloseSheet').addEventListener('click', () => closeMask($('sheetMask')));
$('sheetMask').addEventListener('click', e => { if (e.target === $('sheetMask')) closeMask($('sheetMask')); });

/* ================= 设置浮层 =================
   版本号 __APP_VERSION__ 由 vite.config define 在构建期从 package.json 注入；
   关注作者走平台绑定关系（hbSDK.user.requestFollowAuthor，无需权限声明），
   必须在点击事件中直接调用（SDK 手势要求）。 */

function renderFollowState(status) {
  const btn = $('btnFollow');
  if (status === AuthorFollowStatus.Following) {
    btn.textContent = '已关注 ✓';
    btn.classList.add('set-follow--done');
    btn.disabled = true;
  } else if (status === AuthorFollowStatus.Self) {
    btn.textContent = '作者本人';
    btn.classList.add('set-follow--done');
    btn.disabled = true;
  } else {
    btn.textContent = '关注作者';
    btn.classList.remove('set-follow--done');
    btn.disabled = false;
  }
}

// 开浮层时静默查询关注状态（不触发登录、不弹框、不耗弹窗额度）
async function refreshFollowStatus() {
  try {
    renderFollowState(await hbSDK.user.getFollowStatus());
  } catch { /* 查询失败保持当前展示 */ }
}

// 音效开关展示：两个独立开关，开=绿 pill 样式、关=普通
function renderSoundState() {
  const pairs = [
    ['btnSound', soundEnabled()],
    ['btnTapSound', tapEnabled()],
  ];
  for (const [id, on] of pairs) {
    const btn = $(id);
    btn.textContent = on ? '开启' : '关闭';
    btn.classList.toggle('set-follow--done', on);
  }
  // 旋律 chip 高亮
  const cur = tapTuneId();
  for (const el of document.querySelectorAll('.tune-chip')) {
    el.classList.toggle('tune-chip--on', el.dataset.tune === cur);
  }
}

$('btnSettings').addEventListener('click', () => {
  $('setVersion').textContent = __APP_VERSION__;
  renderSoundState();
  $('setMask').classList.add('sheet-mask--open');
  refreshFollowStatus();
});

$('btnSound').addEventListener('click', () => {
  const next = !soundEnabled();
  setSoundEnabled(next);
  renderSoundState();
  toast(next ? '猜中音效已开启，揭晓后播放 5 秒片段' : '猜中音效已关闭');
});

$('btnTapSound').addEventListener('click', () => {
  const next = !tapEnabled();
  setTapEnabled(next);
  renderSoundState();
  if (next) playTap({ force: true }); // 开启时立刻试听一声，确认音量与手感
  toast(next ? '点击音效已开启' : '点击音效已关闭');
});

// 点击旋律切换：换曲后立刻试听旋律开头两个音（间隔 200ms 模拟连点）
$('tuneChips').addEventListener('click', e => {
  const el = e.target.closest('.tune-chip');
  if (!el || el.classList.contains('tune-chip--on')) return;
  const tune = TAP_TUNE_LIST.find(t => t.id === el.dataset.tune);
  if (!tune) return;
  setTapTune(tune.id);
  resetTapScale();
  renderSoundState();
  playTap({ force: true, index: 0 });
  setTimeout(() => playTap({ force: true, index: 1 }), 220);
  toast(`点击旋律：${tune.name}`);
});
$('btnCloseSet').addEventListener('click', () => closeMask($('setMask')));
$('setMask').addEventListener('click', e => { if (e.target === $('setMask')) closeMask($('setMask')); });

$('btnFollow').addEventListener('click', async () => {
  try {
    const status = await hbSDK.user.requestFollowAuthor();
    renderFollowState(status);
    if (status === AuthorFollowStatus.Following) toast('感谢关注！');
  } catch (e) {
    const code = e && e.code;
    if (code === 'FOLLOW_CANCELLED') return; // 用户主动取消，不打扰
    if (code === 'FOLLOW_GUIDANCE_LIMIT_REACHED') toast('今天的关注弹窗次数用完了，明天再来');
    else if (code === 'METHOD_NOT_FOUND' || code === 'METHOD_FORBIDDEN') toast('当前环境暂不支持，请在小黑盒 APP 内使用');
    else toast('关注未完成，稍后再试试');
  }
});

/* ================= 结算 ================= */

const NOTES = ['🎵', '🎶', '♪', '♫'];

// 猜中播片段：只对收录了音频的曲目（古典 86 + 简单池 448）生效；
// 须在用户手势的同一个任务里调用，否则会被自动播放策略拦截（点击"猜一猜"即手势）
function playAnswerClip(answer) {
  if (!answer) return;
  if (document.documentElement.getAttribute('data-fx') === 'off') return; // 光效关=静音
  const clip = AUDIO_MAP[answer.id];
  if (clip) playClip(clip);
}

function fillResult(roundLocal, answer, statsAfter) {
  const card = $('resultCard');
  card.classList.remove('result-card--win');
  $('notesBurst').innerHTML = '';

  $('resultState').textContent = roundLocal.won
    ? (roundLocal.guesses.length <= 3 ? '神了！这么快就锁定了' : '答对了！')
    : '很遗憾，下次一定';
  $('resultState').className = 'result-head__state ' + (roundLocal.won ? 'grad-text' : '');

  $('resultSub').textContent = roundLocal.mode === 'daily'
    ? `第 ${roundLocal.episode} 期 · ${roundLocal.won ? `${roundLocal.guesses.length}/${MAX_ATTEMPTS} 次命中` : `${MAX_ATTEMPTS} 次未能命中`}`
    : roundLocal.mode === 'standard'
      ? `标准模式 · ${roundLocal.won ? `${roundLocal.guesses.length}/${MAX_ATTEMPTS} 次命中` : `${MAX_ATTEMPTS} 次未能命中`}`
      : (roundLocal.won ? `${roundLocal.guesses.length} 次猜中` : '未猜中');

  $('answerTitle').textContent = answer.kind === 'artist' ? `${answer.t} 🎤` : answer.t;
  $('answerArtist').textContent = answer.kind === 'artist'
    ? `代表作《${answer.topSong}》 · 曲库收录 ${answer.count} 首`
    : `${answer.ar} · ${answer.yr} · ${answer.rg} · ${answer.gn.join('·')}`;

  // 战绩格（逐行浮现）
  const grid = shareGrid(roundLocal, answer);
  $('shareGrid').innerHTML = grid.map((line, i) =>
    `<div class="share-row" style="animation-delay:${i * 50}ms">${[...line].map(ch => {
      const cls = ch === '🟩' ? 'share-cell--hit' : ch === '🟨' ? 'share-cell--near' : 'share-cell--miss';
      return `<div class="share-cell ${cls}"></div>`;
    }).join('')}</div>`).join('');

  if (roundLocal.won) countUp($('statTries'), roundLocal.guesses.length);
  else $('statTries').textContent = '—';

  const kind = roundLocal.kind === 'artist' ? 'artist' : 'song';
  if (roundLocal.mode === 'standard') {
    // 标准模式：本模式连胜 + 平均步数（20 次机会下比胜率更有信息量）
    const std = loadStd();
    countUp($('statStreak'), std.streak);
    $('statStreakLabel').textContent = '本模式连胜';
    if (std.won > 0) countUp($('statBank'), std.sumWon / std.won, 520, 1);
    else $('statBank').textContent = '—';
    $('statBankLabel').textContent = '平均步数';
  } else if (roundLocal.mode === 'simple' || roundLocal.mode === 'custom') {
    // 休闲模式：展示曲库规模与本局出题范围
    countUp($('statStreak'), SONGS.length);
    $('statStreakLabel').textContent = '曲库曲量';
    countUp($('statBank'), roundLocal.poolSize || SONGS.length);
    $('statBankLabel').textContent = '范围内曲目';
  } else if (roundLocal.mode === 'free') {
    // 无限练习不计连胜：展示曲库曲量与答案年份，避免与每日连胜混淆
    countUp($('statStreak'), SONGS.length);
    $('statStreakLabel').textContent = '曲库曲量';
    countUp($('statBank'), answer.yr);
    $('statBankLabel').textContent = '答案年份';
  } else if (roundLocal.kind === 'artist') {
    // 猜歌手同样不计连胜：歌手库规模与答案年代
    countUp($('statStreak'), ARTISTS.length);
    $('statStreakLabel').textContent = '歌手库规模';
    countUp($('statBank'), answer.yr);
    $('statBankLabel').textContent = '答案年代';
  } else {
    // 每日挑战：全局连胜
    const stats = loadStats();
    countUp($('statStreak'), stats.streak);
    $('statStreakLabel').textContent = '当前连胜';
    countUp($('statBank'), kindCfg(kind).pool().length);
    $('statBankLabel').textContent = kindCfg(kind).poolLabel;
  }

  if (roundLocal.won) {
    card.classList.add('result-card--win');
    $('notesBurst').innerHTML = NOTES.map(n => `<span class="note-p">${n}</span>`).join('');
  }

  $('btnShare').onclick = () => {
    const text = shareText(roundLocal, answer, grid);
    copyText(text);
  };
  const again = roundLocal.kind === 'artist'
    ? { label: '再来一局（猜歌手）', run: startArtist }
    : roundLocal.mode === 'standard'
      ? { label: '再来一局（标准模式）', run: startStandard }
      : roundLocal.mode === 'simple'
        ? { label: '再来一局（简单模式）', run: startSimple }
        : roundLocal.mode === 'custom'
          ? { label: '再来一局（同范围）', run: () => startCustom(true) }
          : roundLocal.mode === 'daily'
            ? { label: '再来一局（标准模式）', run: startStandard }
            : { label: '再来一局（无限练习）', run: startFree };
  $('btnAgain').textContent = again.label;
  $('btnAgain').onclick = () => closeMask($('resultMask'), again.run);
  $('btnHome').onclick = () => closeMask($('resultMask'), () => { renderHome(); showView('Home'); });
}

function openResult() {
  const answer = roundAnswer;
  $('resultReopenWrap').style.display = 'none';
  let stats = loadStats();
  if (round.mode === 'daily' && !round._counted) {
    stats = applyDailyResult(stats, round.won);
    saveStats(stats);
    round._counted = true;
    $('streakNum').textContent = stats.streak;
    bumpStreak();
  }
  if (round.mode === 'standard' && !round._counted) {
    saveStd(applyStdResult(loadStd(), round.won, round.answerId, round.guesses.length));
    round._counted = true;
  }
  fillResult(round, answer, stats);
  $('resultMask').classList.add('result-mask--open');
}

function openDailyResult(saved) {
  round = saved;
  // 同上：历史局按存档答案展示
  roundAnswer = entityById('song', saved.answerId) || dailyAnswer(dateKeyNow());
  // 已结算过的局不重复计数
  fillResult(saved, roundAnswer, loadStats());
  $('resultMask').classList.add('result-mask--open');
  // 回看已完成局时也播答案片段（用户主动点开，属于手势内）
  playAnswerClip(roundAnswer);
}

/* 结算卡关闭：关掉后留在局内回看历史（最后一猜的判定行），「查看结算卡」可重新打开 */
function closeResult() {
  closeMask($('resultMask'), () => {
    if (round && round.done && $('viewRound').classList.contains('view--active')) {
      $('resultReopenWrap').style.display = '';
    }
  });
}

$('btnCloseResult').addEventListener('click', closeResult);
$('resultMask').addEventListener('click', e => { if (e.target === $('resultMask')) closeResult(); });
$('btnResultReopen').addEventListener('click', () => {
  $('resultReopenWrap').style.display = 'none';
  $('resultMask').classList.add('result-mask--open');
  playAnswerClip(roundAnswer);
});

function copyText(text) {
  const done = () => toast('战绩已复制，去发给盒友吧');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
  } else fallbackCopy(text, done);
}

function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); } catch { toast('复制失败，请手动截图'); }
  ta.remove();
}

/* ================= 模式入口 ================= */

$('modeSimple').addEventListener('click', startSimple);
$('modeCustom').addEventListener('click', () => startCustom(false));
$('modeArtist').addEventListener('click', startArtist);
$('modeStandard').addEventListener('click', startStandard);
$('modeFree').addEventListener('click', startFree);

/* 自定义范围浮层：chip 点选 + 实时统计 + 开始 */
$('scopeGroups').addEventListener('click', e => {
  const el = e.target.closest('.scope-chip');
  if (!el) return;
  const key = el.dataset.g;
  const raw = el.dataset.v;
  if (key === 'minHeat') { scope.minHeat = Number(raw); }
  else {
    const v = isNaN(Number(raw)) ? raw : Number(raw);
    const arr = scope[key];
    const i = arr.indexOf(v);
    if (i >= 0) arr.splice(i, 1); else arr.push(v);
  }
  renderScope();
});
$('scopeStart').addEventListener('click', () => launchScopeRound(scope));

// 清空筛选条件（不动 scope 对象引用，只重置字段——别处持有它的引用）
$('scopeReset').addEventListener('click', () => {
  scope.decades = [];
  scope.regions = [];
  scope.langs = [];
  scope.genres = [];
  scope.minHeat = 0;
  renderScope();
});

/* 范围抽屉关闭：不开局也能返回主页；已选条件保留，下次打开还在 */
$('btnCloseScope').addEventListener('click', () => closeMask($('scopeMask')));
$('scopeMask').addEventListener('click', e => { if (e.target === $('scopeMask')) closeMask($('scopeMask')); });

$('btnBack').addEventListener('click', () => {
  round = null;
  $('resultReopenWrap').style.display = 'none';
  renderHome();
  showView('Home');
});

/* ================= 光效档位（高/中/低/关） =================
   四档由 html[data-fx] 驱动（CSS 规则见 theme.css / app.css）：
     high = 完整效果（极光 blur 72px、光带齐全、全部动画）
     mid  = 去 filter:blur、隐藏光带、涟漪池化
     low  = 极光静止、渐变调淡、去星尘/唱片光环/扫光
     off  = 零光效（仅静态深色底）
   选择持久化在 localStorage（fi_fx = high|mid|low|off）。 */

const FX_KEY = 'fi_fx';
const FX_LEVELS = ['high', 'mid', 'low', 'off'];
const FX_NAMES = { high: '高', mid: '中', low: '低', off: '关' };

// 设备能力探测：低内存 / 少核心 / 省流量 → 默认中档
function detectFxDefault() {
  const nav = navigator;
  const mem = nav.deviceMemory || 0;
  const cores = nav.hardwareConcurrency || 0;
  const saveData = nav.connection?.saveData === true;
  const smallScreen = Math.min(screen.width, screen.height) <= 560;
  const clearlyLow = (mem && mem <= 4) || (cores && cores <= 4);
  return (clearlyLow || saveData || smallScreen) ? 'mid' : 'high';
}

function applyFx(level) {
  if (!FX_LEVELS.includes(level)) level = 'high';
  document.documentElement.setAttribute('data-fx', level);
  for (const btn of document.querySelectorAll('.fx-btn')) {
    btn.classList.toggle('fx-btn--on', btn.dataset.fx === level);
  }
  try { localStorage.setItem(FX_KEY, level); } catch { /* 隐私模式静默 */ }
}

function initFx() {
  let level;
  try {
    const saved = localStorage.getItem(FX_KEY);
    level = saved && FX_LEVELS.includes(saved) ? saved : detectFxDefault();
  } catch {
    level = detectFxDefault();
  }
  applyFx(level);

  $('fxRow')?.addEventListener('click', e => {
    const btn = e.target.closest('.fx-btn');
    if (!btn) return;
    applyFx(btn.dataset.fx);
    toast(`光效已切换为「${FX_NAMES[btn.dataset.fx]}」`);
  });
}

/* ================= 启动 ================= */

// 清理 7 天前的每日挑战存档（fi_daily_<dateKey>），防止 localStorage 无限累积。
// 每日存档只有当天会被读取（loadDaily(dateKeyNow())），旧键是纯垃圾。
function pruneDailySaves() {
  try {
    const cutoff = Date.now() - 7 * 86400000;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('fi_daily_')) continue;
      const t = new Date(k.slice('fi_daily_'.length) + 'T00:00:00').getTime();
      if (Number.isFinite(t) && t < cutoff) localStorage.removeItem(k);
    }
  } catch { /* 隐私模式静默 */ }
}

initFx();
pruneDailySaves();
renderHome();
tickCountdown();
