#!/usr/bin/env node
/*
 * 音频管线：iTunes 试听片段 → 能量峰值 5 秒 → 64k AAC → public/audio/
 *
 * 用法：
 *   HTTPS_PROXY=http://127.0.0.1:7897 NODE_USE_ENV_PROXY=1 \
 *     node tools/build-audio.mjs [--scope classical|simple|all] [--dry] [--limit N]
 *
 * 产出：
 *   public/audio/<id>.mp3    每首一首 5 秒片段（MP3 64kbps 立体声，首尾淡入淡出）
 *   js/audio-map.js          { 曲库id: 'audio/<id>.mp3' } JS 模块（不能是 JSON，见陷阱 1）
 *   tools/out/audio-report.json  命中/未命中/失败明细
 *
 * 选段策略：解码整段 30 秒为 8kHz 单声道 PCM，按 0.5s 窗口算 RMS 能量，
 * 取最响的 5 秒（避开前奏静音），首尾各 0.3s 淡入淡出防爆音。
 * 边界：试听片段固定 30 秒，故起点范围 0..25s；过短片段取能取到的全部。
 */
import { execFile } from 'node:child_process';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = join(ROOT, 'public', 'audio');
const OUT_MAP = join(ROOT, 'js', 'audio-map.js');
const REPORT = join(ROOT, 'tools', 'out', 'audio-report.json');
const CACHE = join(ROOT, 'tools', 'out', 'audio-preview-cache');

const FFMPEG = require('ffmpeg-static');
const exec = promisify(execFile);

const SEG = 5;          // 片段时长（秒）
const FADE = 0.3;       // 首尾淡入淡出（秒）
const BITRATE = '64k';
const MAX_LEN = 30;     // iTunes 试听固定 30s

const sleep = ms => new Promise(r => setTimeout(r, ms));

// —— 匹配工具（口径同 fetch-albums.mjs）——
// 关键：iTunes 港台区返回繁体，必须先繁→简再比对，否则「勇氣」≠「勇气」
import { toSimplified } from '../js/t2s.js';

const strip = s => toSimplified(String(s).toLowerCase())
  .replace(/[\s·・,，.。!！?？'"“”‘’()（）\-—–_/\\[\]]+/g, '')
  .replace(/(feat|with|版|伴奏|live|remix).*/gi, '');

function diffCount(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// 剥掉 iTuns 常见的曲名后缀：「(電影《…》主題曲)」「- Single」「(Live)」等
const coreTitle = s => strip(String(s)
  .replace(/[（(\[【][^）)\]】]*[）)\]】]/g, '')   // 各种括号内容
  .replace(/\s*[-–—]\s*.+$/, '')                  // 破折号后缀
);

const titleMatch = (a, b) => {
  const x = strip(a), y = strip(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // 核心名比对：剥掉宣传语后缀后再比（覆盖「時間煮雨 (電影…主題曲)」这类）
  const cx = coreTitle(a), cy = coreTitle(b);
  if (cx && cy) {
    if (cx === cy) return true;
    // 包含关系：短名被长名完整包住即命中（≥3 字，避免「爱」误配）
    const [short, long] = cx.length <= cy.length ? [cx, cy] : [cy, cx];
    if (short.length >= 3 && long.includes(short)) return true;
    if (diffCount(cx, cy) / Math.max(cx.length, cy.length) <= 0.3) return true;
  }
  return diffCount(x, y) / Math.max(x.length, y.length) <= 0.3;
};

// 歌手匹配：iTunes 常见 "周杰倫 & 五月天 阿信" 这类合唱署名，
// 故先按常见分隔符切分候选歌手，任一候选完整包含即算命中；否则退回字符重叠
const artistMatch = (a, b) => {
  const x = strip(a), y = strip(b);
  if (!x || !y) return false;
  if (x === y) return true;

  // 主候选：任一方包含另一方（覆盖 "周杰倫 & 阿信" ⊇ "周杰伦"）
  if (y.includes(x) || x.includes(y)) return true;

  // 切分后再比：& / 、 / , / feat. / with
  const parts = String(b).split(/&|、|,|，|feat\.?|with/i).map(strip).filter(Boolean);
  if (parts.some(p => p === x || p.includes(x) || x.includes(p))) return true;

  const set = new Set(x);
  let hit = 0;
  for (const c of new Set(y)) if (set.has(c)) hit++;
  return hit / Math.max(set.size, new Set(y).size) >= 0.5;
};

/* —— 能量峰值检测：解码为 8k 单声道 s16le，算 0.5s 窗口 RMS —— */
async function findPeakStart(file, duration) {
  const rate = 8000;
  const win = Math.floor(rate * 0.5);
  const { stdout } = await exec(FFMPEG, [
    '-hide_banner', '-v', 'quiet', '-i', file,
    '-ac', '1', '-ar', String(rate), '-f', 's16le', '-'
  ], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });

  const buf = stdout;
  const total = Math.floor(buf.length / 2);
  if (!total) return 0;

  const energies = [];
  for (let off = 0; off + win <= total; off += win) {
    let sum = 0;
    for (let i = 0; i < win; i += 8) { // 抽样加速，每 8 点取一
      const v = buf.readInt16LE((off + i) * 2) / 32768;
      sum += v * v;
    }
    energies.push(sum / Math.ceil(win / 8));
  }
  if (!energies.length) return 0;

  // 片段不能超过音频末尾
  const latest = Math.max(0, Math.min(MAX_LEN - SEG, duration - SEG));
  let best = 0, bestE = -1;
  for (let i = 0; i < energies.length; i++) {
    const start = i * 0.5;
    if (start > latest) break;
    if (energies[i] > bestE) { bestE = energies[i]; best = start; }
  }
  return Math.round(best * 10) / 10;
}

/* —— 裁切 + 转码 ——
   格式必须 MP3：平台构建产物**不接受 .m4a**（实测上传报「错误的文件路径」），
   同内容换 .mp3 即可通过。5 秒片段在 64kbps 下两者听感差异可忽略。 */
async function cutSegment(src, dst, start) {
  await exec(FFMPEG, [
    '-y', '-hide_banner', '-v', 'error',
    '-ss', String(start), '-t', String(SEG), '-i', src,
    '-af', `afade=t=in:st=0:d=${FADE},afade=t=out:st=${SEG - FADE}:d=${FADE}`,
    '-c:a', 'libmp3lame', '-b:a', BITRATE, '-ac', '2', '-ar', '44100',
    dst,
  ], { maxBuffer: 16 * 1024 * 1024 });
}

/* —— iTunes 搜索（多区回退）——
   流行/日韩：标题容错 + 歌手字符重叠校验；
   古典：iTunes 条目是「英文作品名 + 演奏者」，歌手是乐团/演奏家而非作曲家，
         故用英文别名检索、跳过歌手校验，改以「作曲家姓名字符重叠」作为弱校验（可选）。
   同区命中里优先录音室版：Live/Remix/伴奏 的 5 秒片段常是掌声或改编编曲，
   不适合做猜中音（首跑 318 首零 Live 版，靠此偏好维持同一质量线）。 */
const isAltVersion = name => /live|remix|伴奏|現場|现场|演唱會|演唱会|acoustic/i.test(String(name));
const REGIONS_POP = ['tw', 'hk', 'jp', 'sg', 'us'];
const REGIONS_CLS = ['us', 'gb', 'de', 'fr', 'jp'];

const isClassical = song => song.gn.includes('古典');

// 古典英文检索词：优先取拉丁字母别名，其次中文曲名（部分曲目中文名可搜到）
function classicalTerms(song) {
  const latin = song.al.filter(a => /[a-z]/i.test(a) && !/[\u4e00-\u9fff]/.test(a));
  const terms = [...latin, song.t].filter(Boolean);
  // 去掉过短/纯编号的别名
  return [...new Set(terms.filter(t => t.length >= 3))];
}

async function itunesSearch(term, region) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&country=${region}&entity=song&limit=10`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url);
      if (r.status === 429) {
        // 限流：指数退避后重试（iTunes 对同 IP 限制较严）
        await sleep(8000 * (attempt + 1));
        continue;
      }
      if (!r.ok) return [];
      const text = await r.text();
      if (!text.trim().startsWith('{')) { // 非 JSON（限流/错误页）
        await sleep(5000 * (attempt + 1));
        continue;
      }
      const d = JSON.parse(text);
      return d.results || [];
    } catch {
      await sleep(3000);
    }
  }
  return [];
}

async function searchPreview(song) {
  if (isClassical(song)) {
    for (const term of classicalTerms(song)) {
      for (const region of REGIONS_CLS) {
        const results = await itunesSearch(term, region);
        const hits = results.filter(it => it.previewUrl && titleMatch(term, it.trackName || ''));
        if (!hits.length) continue;
        const pick = hits.find(it => !isAltVersion(it.trackName)) || hits[0];
        return { url: pick.previewUrl, region, matched: `${pick.trackName} / ${pick.artistName}`, via: term };
      }
    }
    return null;
  }

  for (const region of REGIONS_POP) {
    const results = await itunesSearch(`${song.t} ${song.ar}`, region);
    const hits = results.filter(it => it.previewUrl
      && titleMatch(song.t, it.trackName || '')
      && artistMatch(song.ar, it.artistName || ''));
    if (!hits.length) continue;
    const pick = hits.find(it => !isAltVersion(it.trackName)) || hits[0];
    return { url: pick.previewUrl, region, matched: `${pick.trackName} / ${pick.artistName}` };
  }
  return null;
}

async function download(url, dst) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const b = Buffer.from(await r.arrayBuffer());
  if (b.length < 5000) throw new Error(`太小 ${b.length}B`);
  await writeFile(dst, b);
  return b.length;
}

async function probeDuration(file) {
  const { stderr } = await exec(FFMPEG, ['-hide_banner', '-i', file], { encoding: 'utf8' })
    .catch(e => ({ stderr: e.stderr || '' }));
  const m = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(stderr);
  if (!m) return MAX_LEN;
  return (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
}

/* —— 主流程 —— */
const argv = process.argv.slice(2);
const scope = (argv.find(a => a.startsWith('--scope=')) || '--scope=all').split('=')[1];
const dry = argv.includes('--dry');
const limitArg = argv.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 0;
const force = argv.includes('--force');
// --retry-miss：只补跑上次报告里未命中的曲目（不重跑已成功的），限流恢复后使用
const retryMiss = argv.includes('--retry-miss');
// --gap=N：请求间隔毫秒，默认 2200（iTunes 限流较严）
const gapArg = argv.find(a => a.startsWith('--gap='));
const GAP = gapArg ? parseInt(gapArg.split('=')[1], 10) : 2200;

const { SONGS } = await import('../js/bank.js');
const { simplePool } = await import('../js/game.js');

const classical = SONGS.filter(s => s.gn.includes('古典'));
const simple = simplePool();
let targets;
if (scope === 'classical') targets = classical;
else if (scope === 'simple') targets = simple;
else {
  const seen = new Set();
  targets = [...classical, ...simple].filter(s => !seen.has(s.id) && seen.add(s.id));
}
if (retryMiss) {
  let prev = null;
  try { prev = JSON.parse(await readFile(REPORT, 'utf8')); } catch { /* 无报告则跑全量 */ }
  if (prev && prev.miss) {
    const missIds = new Set(prev.miss.map(m => m.id));
    targets = targets.filter(s => missIds.has(s.id));
    console.log(`[audio] --retry-miss：上次未命中 ${missIds.size} 首，本次只补跑这些`);
  }
}
if (limit) targets = targets.slice(0, limit);

await mkdir(OUT_DIR, { recursive: true });
await mkdir(CACHE, { recursive: true });
await mkdir(dirname(REPORT), { recursive: true });

console.log(`[audio] scope=${scope} 目标 ${targets.length} 首 (古典 ${classical.length} / 简单池 ${simple.length})`);

// 补跑模式：继承上次成功条目，避免 --retry-miss 把已成功的映射冲掉
const map = {};
let report = { ok: [], miss: [], fail: [], scope, total: targets.length };
let totalBytes = 0;
if (retryMiss) {
  try {
    const prev = JSON.parse(await readFile(REPORT, 'utf8'));
    for (const o of prev.ok || []) { map[o.id] = `audio/${o.id}.mp3`; totalBytes += o.bytes || 0; }
    report.ok = [...(prev.ok || [])];
    report.miss = [];
    report.fail = [];
  } catch { /* 无旧报告则从空开始 */ }
}

for (let i = 0; i < targets.length; i++) {
  const song = targets[i];
  const dst = join(OUT_DIR, `${song.id}.mp3`);
  const tag = `[${i + 1}/${targets.length}] ${song.id} ${song.t}`;

  // 已有产物直接复用（--force 重跑）
  if (!force && existsSync(dst)) {
    const st = await stat(dst);
    map[song.id] = `audio/${song.id}.mp3`;
    totalBytes += st.size;
    report.ok.push({ id: song.id, t: song.t, cached: true, bytes: st.size });
    console.log(`${tag} 复用 ${(st.size / 1024).toFixed(0)}KB`);
    continue;
  }

  try {
    const found = await searchPreview(song);
    if (!found) { report.miss.push({ id: song.id, t: song.t, ar: song.ar }); console.log(`${tag} 未命中`); await sleep(1200); continue; }

    const raw = join(CACHE, `${song.id}.m4a`);
    if (!existsSync(raw)) await download(found.url, raw);

    const dur = await probeDuration(raw);
    const start = await findPeakStart(raw, dur);

    if (dry) { console.log(`${tag} [dry] 起点 ${start}s / 时长 ${dur.toFixed(1)}s`); continue; }

    await cutSegment(raw, dst, start);
    const st = await stat(dst);
    map[song.id] = `audio/${song.id}.mp3`;
    totalBytes += st.size;
    report.ok.push({ id: song.id, t: song.t, region: found.region, matched: found.matched, start, bytes: st.size });
    console.log(`${tag} ✓ 起点 ${start}s ${(st.size / 1024).toFixed(0)}KB`);
  } catch (e) {
    report.fail.push({ id: song.id, t: song.t, error: String(e.message || e).slice(0, 120) });
    console.log(`${tag} ✗ ${String(e.message || e).slice(0, 80)}`);
  }
  await sleep(2200); // 限速：iTunes 对同 IP 限制较严，1.2s 会被 429
}

if (!dry) {
  const body = `/* 音频映射（tools/build-audio.mjs 生成，勿手改）
   每首 5 秒片段，MP3 64kbps（平台不接受 .m4a）；仅古典与简单模式池收录。
   版权说明见设置面板免责声明。 */
export default ${JSON.stringify(map, null, 2)};
`;
  await writeFile(OUT_MAP, body, 'utf8');
  report.bytes = totalBytes;
  await writeFile(REPORT, JSON.stringify(report, null, 2), 'utf8');

  console.log(`\n[audio] 完成：命中 ${report.ok.length} / 未命中 ${report.miss.length} / 失败 ${report.fail.length}`);
  console.log(`[audio] 总体积 ${(totalBytes / 1024 / 1024).toFixed(1)}MB，映射写入 ${OUT_MAP}`);
  if (report.miss.length) console.log('[audio] 未命中示例：', report.miss.slice(0, 8).map(m => m.t).join(' / '));
  if (report.fail.length) console.log('[audio] 失败示例：', report.fail.slice(0, 5).map(m => `${m.t}(${m.error})`).join(' / '));
}
