/* ============================================================
   Fi一把 · 音频
   ------------------------------------------------------------
   两条独立通道（设置面板各有独立开关，互不影响）：

   1) 片段音（playClip）：猜中/放弃揭晓/查看战绩/重开结算卡时，
      播该曲 5 秒片段。单例 <audio> 复用，打包在 public/audio/（MP3 64k，
      平台不接受 .m4a），走相对路径（CSP media-src 'self' 允许，无需网络权限）。
      音量 0.45（0.85 外放偏响）。开关 fi_snd。

   2) 合成点击音（playTap）：WebAudio 实时合成双层钢琴，零资源零版权。
      —— 旋律可选名曲（致爱丽丝/欢乐颂/小星星/卡农/命运）或音阶模式：
         每次点击弹奏旋律的下一个音符，连续点击即"弹"整首曲子；
         null=休止符（如《命运》的短短短长节奏），推进但静默。
      —— 音高按 MIDI 编号换算 440×2^((m-69)/12)；单音余韵 0.6s。
      —— 与触摸涟漪同源同拍：第 n 次点击 = 第 n 个音 = 第 n 种涟漪色。
      —— 每局开局 resetTapScale() 从头起步。开关 fi_tap，旋律选择 fi_tap_tune。

   与光效"关"档联动：data-fx=off 时全部静音（用户表达"零负担"）。
   音量：片段 0.45 / 点击 TAP_MASTER 0.55（实测峰值 0.402 无削波）。
   ============================================================ */

const SND_KEY = 'fi_snd';
const TAP_KEY = 'fi_tap';

const readFlag = key => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? true : v === '1';
  } catch { return true; }
};
const writeFlag = (key, on) => {
  try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* 隐私模式静默 */ }
};

let audioEl = null;
let currentSrc = '';

function getAudio() {
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.preload = 'auto';
    // 0.85 → 0.45：实测 5 秒片段在手机外放偏响，压到不足一半更贴合"背景提示"的定位
    audioEl.volume = 0.45;
    audioEl.addEventListener('error', () => { /* 解码失败静默：不打断游戏 */ });
  }
  return audioEl;
}

/** 片段音开关（5 秒片段） */
export function soundEnabled() { return readFlag(SND_KEY); }

export function setSoundEnabled(on) {
  writeFlag(SND_KEY, on);
  if (!on) stopSound();
}

/** 点击音开关（合成提示音），与片段音相互独立 */
export function tapEnabled() { return readFlag(TAP_KEY); }

export function setTapEnabled(on) {
  writeFlag(TAP_KEY, on);
  if (!on) closeSynth(); // 关掉时释放 AudioContext，彻底静默并省电
}

export function stopSound() {
  if (!audioEl) return;
  try { audioEl.pause(); audioEl.currentTime = 0; } catch { /* 忽略 */ }
}

/**
 * 播放某首歌的片段。
 * @param {string} relPath audio-map 里的相对路径，如 'audio/cl01.mp3'
 * @param {{ force?: boolean }} [opts] force=true 绕过音效开关（测试用）
 * @returns {Promise<boolean>} 是否真的开始播放
 */
export function playClip(relPath, opts = {}) {
  if (!relPath) return Promise.resolve(false);
  if (!opts.force && !soundEnabled()) return Promise.resolve(false);

  const el = getAudio();
  // 相对路径：index.html 与 public/ 同源，base './' 下直接用即可
  const src = new URL(relPath, document.baseURI).href;
  if (src !== currentSrc) {
    currentSrc = src;
    el.src = src;
  }
  try { el.currentTime = 0; } catch { /* 未加载完成时忽略 */ }

  const p = el.play();
  if (p && typeof p.catch === 'function') {
    return p.then(() => true).catch(() => false); // 自动播放策略/解码失败 → 静默失败
  }
  return Promise.resolve(true);
}

/* ================= 合成点击音（WebAudio，零资源） =================

   【旋律库】点击音可选用名曲旋律：每次点击弹奏旋律的下一个音符，
   连续点击就是在"弹"这首曲子。旋律均为公有领域作品、纯合成发声，零版权风险。
     致爱丽丝 贝多芬 / 欢乐颂 贝多芬 / 小星星 莫扎特(传) / 卡农 帕赫贝尔 / 命运 贝多芬 / 音阶(原拱形)
   null = 休止：点击推进但不发声——《命运》的"短短短长"节奏全靠它。
   选择持久化 fi_tap_tune；「音阶」是保留的纯音阶模式（拱形+力度起伏）。

   【音高】MIDI 编号统一换算：f = 440 × 2^((midi-69)/12)。
   【音色】双层钢琴（明亮层击弦泛音 0.18s + 温厚层长余韵 0.6s），
   高次谐波先衰减正是钢琴的物理特征，不是电子正弦味。
   【力度】名曲模式固定 0.5（旋律自带音高起伏）；音阶模式沿用三角包络 0.30↔0.85。
   【循环】tapStep 按当前旋律长度取模——切换旋律后从新序列头接着走。
   【复音】上限 6 个音同时余韵（模拟钢琴踏板），超出直接跳过。

   涟漪四色循环与它同拍：第 n 次点击 = 第 n 个音 = 第 n 种颜色。 */

/* 名曲旋律库（MIDI 编号，null=休止）。音符序列按乐谱人工核对。 */
const TAP_TUNES = {
  furElise: [76, 75, 76, 75, 76, 71, 74, 72, 69, null, 69, 72, 76, 81, null, 71, 64, 68, 71, 72, null], // E D# E D# E B D C A | A C E A | B E G# B C
  ode:      [76, 76, 77, 79, 79, 77, 76, 74, 72, 72, 74, 76, 76, 74, 74],                                 // 欢乐颂主歌
  twinkle:  [72, 72, 79, 79, 81, 81, 79, 77, 77, 76, 76, 74, 74, 72],                                     // 小星星第一句
  canon:    [74, 69, 71, 66, 67, 62, 67, 69],                                                             // 卡农经典下行分解
  fate:     [79, 79, 79, 75, null, 77, 77, 77, 74, null],                                                 // 命运动机：短短短长
};

export const TAP_TUNE_LIST = [
  { id: 'furElise', name: '致爱丽丝' },
  { id: 'ode',      name: '欢乐颂' },
  { id: 'twinkle',  name: '小星星' },
  { id: 'canon',    name: '卡农' },
  { id: 'fate',     name: '命运' },
  { id: 'scale',    name: '音阶' },
];

// 音阶模式保留的拱形旋律（半音偏移，相对 C5）：升到 D6 再落回
const TAP_MELODY = [0, 2, 4, 7, 9, 12, 14, 12, 9, 7, 4, 2];
const BASE_HZ = 523.25;                  // C5
const TAP_STEPS = TAP_MELODY.length;
const TAP_DUR = 0.6;                     // 单音余韵（秒）
const MAX_VOICES = 6;                    // 同时余韵的音数上限
// 每音主音量：双层叠加后再压一档，实机外放不刺耳（早先是 1.0）
const TAP_MASTER = 0.55;

const MEL_KEY = 'fi_tap_tune';
let tapTune = null;                      // 当前旋律 id（缓存）

let ac = null;
let tapStep = 0;
let lastTapAt = 0;
let activeVoices = 0;
let waveBright = null;                   // 明亮层 PeriodicWave 缓存
let waveWarm = null;                     // 温厚层 PeriodicWave 缓存
const TAP_MIN_INTERVAL = 70; // 与涟漪 60ms 节流同级；略高一点避免叠音糊成一片

/** 当前点击旋律 id（默认致爱丽丝——三音动机最有辨识度） */
export function tapTuneId() {
  if (tapTune) return tapTune;
  try { tapTune = localStorage.getItem(MEL_KEY) || 'furElise'; } catch { tapTune = 'furElise'; }
  if (!TAP_TUNES[tapTune] && tapTune !== 'scale') tapTune = 'furElise';
  return tapTune;
}

export function setTapTune(id) {
  if (!TAP_TUNES[id] && id !== 'scale') return;
  tapTune = id;
  try { localStorage.setItem(MEL_KEY, id); } catch { /* 隐私模式静默 */ }
}

function getCtx() {
  if (ac) return ac;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  try { ac = new Ctx(); } catch { return null; }
  return ac;
}

function closeSynth() {
  if (!ac) return;
  try { ac.close(); } catch { /* 忽略 */ }
  ac = null;
  waveBright = null;
  waveWarm = null;
  activeVoices = 0;
}

// 浏览器要求上下文在用户手势后才能 resume（iOS/Android WebView 皆有此限制）
function ensureRunning(ctx) {
  if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});
  return ctx;
}

/* 钢琴谐波谱：imag[0] 必须为 0（直流分量），其后依次是 1~n 次谐波幅度。
   明亮层谐波多、衰减快；温厚层谐波少、以大者为基。 */
const BRIGHT_IMAG = new Float32Array([0, 1, 0.55, 0.34, 0.22, 0.15, 0.10, 0.07, 0.05]);
const WARM_IMAG = new Float32Array([0, 1, 0.22, 0.10, 0.05, 0.025]);

function makeWave(ctx, imag) {
  if (!ctx.createPeriodicWave) return null;
  try {
    return ctx.createPeriodicWave(new Float32Array(imag.length), imag);
  } catch { return null; }
}

/* 力度包络（音阶模式专用）：三角波，0.30（最轻）→ 0.85（最实）→ 0.30 */
function strengthAt(step) {
  const p = step / TAP_STEPS;                     // 0 .. ~0.917
  return 0.30 + 0.55 * (1 - Math.abs(2 * p - 1)); // 顶点在 p=0.5（step 6）
}

/* 旋律解析：按当前旋律与步进，返回 {freq, strength} 或 {rest:true}（休止） */
function tapNoteAt(tuneId, step) {
  if (tuneId === 'scale') {
    const idx = ((step % TAP_STEPS) + TAP_STEPS) % TAP_STEPS;
    return {
      freq: BASE_HZ * Math.pow(2, TAP_MELODY[idx] / 12),
      strength: strengthAt(idx),
    };
  }
  const seq = TAP_TUNES[tuneId] || TAP_TUNES.furElise;
  const midi = seq[((step % seq.length) + seq.length) % seq.length];
  if (midi === null) return { rest: true };
  return {
    freq: 440 * Math.pow(2, (midi - 69) / 12),   // MIDI → 频率
    strength: 0.5,                               // 名曲自带音高起伏，力度取中值
  };
}

/**
 * 播放一次点击音（与涟漪联动）。
 * @param {{ force?: boolean, index?: number }} [opts]
 *   force  绕过音效开关/光效关档（测试用）
 *   index  显式指定音级（不传则自增循环）
 * @returns {boolean} 是否发声（休止符返回 false）
 */
export function playTap(opts = {}) {
  if (!opts.force) {
    if (!tapEnabled()) return false; // 点击音开关，与片段音独立
    if (document.documentElement.getAttribute('data-fx') === 'off') return false;
  }

  const now = performance.now();
  if (!opts.force && now - lastTapAt < TAP_MIN_INTERVAL) return false;
  lastTapAt = now;

  const ctx = getCtx();
  if (!ctx) return false;
  ensureRunning(ctx);

  const tuneId = tapTuneId();
  const seqLen = tuneId === 'scale' ? TAP_STEPS : TAP_TUNES[tuneId].length;
  const step = Number.isInteger(opts.index) ? opts.index : tapStep;
  tapStep = (((step + 1) % seqLen) + seqLen) % seqLen;

  const note = tapNoteAt(tuneId, step);
  if (note.rest) return false; // 休止符：推进但不发声

  const freq = note.freq;
  const strength = note.strength;

  // 复音上限：超出则跳过（快速连点时不至于堆积成噪音墙）
  if (activeVoices >= MAX_VOICES) return false;

  const t0 = ctx.currentTime;

  if (!waveBright) waveBright = makeWave(ctx, BRIGHT_IMAG);
  if (!waveWarm) waveWarm = makeWave(ctx, WARM_IMAG);

  /* —— 明亮层：击弦瞬间的泛音，0.18s 内消失 —— */
  const oBright = ctx.createOscillator();
  const gBright = ctx.createGain();
  if (waveBright && oBright.setPeriodicWave) oBright.setPeriodicWave(waveBright);
  else oBright.type = 'triangle';
  oBright.frequency.setValueAtTime(freq, t0);

  gBright.gain.setValueAtTime(0.0001, t0);
  gBright.gain.exponentialRampToValueAtTime(Math.max(0.0002, strength * 0.32), t0 + 0.003);
  gBright.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);

  /* —— 温厚层：基频为主的余韵，0.6s 长衰减（钢琴的"嗡"） —— */
  const oWarm = ctx.createOscillator();
  const gWarm = ctx.createGain();
  if (waveWarm && oWarm.setPeriodicWave) oWarm.setPeriodicWave(waveWarm);
  else oWarm.type = 'sine';
  oWarm.frequency.setValueAtTime(freq, t0);

  // 钢琴包络：3ms 极快起音 → 三级指数衰减，尾音轻盈
  gWarm.gain.setValueAtTime(0.0001, t0);
  gWarm.gain.exponentialRampToValueAtTime(strength * 0.62, t0 + 0.003);
  gWarm.gain.exponentialRampToValueAtTime(Math.max(0.0001, strength * 0.14), t0 + 0.14);
  gWarm.gain.exponentialRampToValueAtTime(Math.max(0.0001, strength * 0.028), t0 + 0.34);
  gWarm.gain.exponentialRampToValueAtTime(0.0001, t0 + TAP_DUR);

  /* —— 每音一个主音量节点，统一压在 TAP_MASTER ——
     用独立节点而非共享总线：单个音收尾时 disconnect 不会影响其他仍在响的音。 */
  const master = ctx.createGain();
  master.gain.setValueAtTime(TAP_MASTER, t0);
  oBright.connect(gBright).connect(master);
  oWarm.connect(gWarm).connect(master);
  master.connect(ctx.destination);

  activeVoices++;
  oBright.start(t0);
  oWarm.start(t0);
  oBright.stop(t0 + 0.2);
  oWarm.stop(t0 + TAP_DUR + 0.02);

  // 节点释放：播完即断开，不留在图里（移动端长时间会累积）
  oBright.addEventListener('ended', () => {
    try { oBright.disconnect(); gBright.disconnect(); } catch { /* 忽略 */ }
  });
  oWarm.addEventListener('ended', () => {
    try { oWarm.disconnect(); gWarm.disconnect(); master.disconnect(); } catch { /* 忽略 */ }
    if (activeVoices > 0) activeVoices--;
  });

  return true;
}

/** 重置步进（进新局时调用，让旋律从头起步） */
export function resetTapScale() { tapStep = 0; }
