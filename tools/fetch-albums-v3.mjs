#!/usr/bin/env node
/*
 * 专辑补全 v3：直接从 bank.js 取全库，抓 iTunes 专辑名 → data/albums-extra.json
 *
 * 与 v2（fetch-albums.mjs）的区别：
 *   · 曲目清单来自 bank.js（不是旧 year-report.json），能覆盖新增的 500 首
 *   · 先繁→简（iTunes 港台区返回繁体，不转则「勇氣」≠「勇气」匹配不上）
 *   · 429 限流指数退避 + 非 JSON 响应识别（iTunes 限流返回纯文本）
 *   · 断点续跑：已抓结果落盘，重复运行只补缺失项
 *
 * 用法：
 *   HTTPS_PROXY=http://127.0.0.1:7897 NODE_USE_ENV_PROXY=1 \
 *     node tools/fetch-albums-v3.mjs [--gap=2200] [--limit=N] [--force]
 *
 * 输出：
 *   data/albums-extra.json   { 曲目id: 专辑名 }（只含新抓到的，不动原有 albums.json）
 *   tools/out/albums-v3-report.json  命中明细，供人工复核
 */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, 'data', 'albums-extra.json');
const REPORT = join(ROOT, 'tools', 'out', 'albums-v3-report.json');
const ALBUMS_BASE = join(ROOT, 'js', 'albums-data.js');

const { SONGS } = await import('../js/bank.js');
const { toSimplified } = await import('../js/t2s.js');

const argv = process.argv.slice(2);
const GAP = Number((argv.find(a => a.startsWith('--gap=')) || '--gap=2200').split('=')[1]);
const LIMIT = Number((argv.find(a => a.startsWith('--limit=')) || '--limit=0').split('=')[1]);
const FORCE = argv.includes('--force');

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* —— 匹配工具（口径同 v2，但先做繁→简）—— */
const strip = s => toSimplified(String(s).toLowerCase())
  .replace(/[\s·・,，.。!！?？'"“”‘’()（）\-—–_/\\[\]]+/g, '')
  .replace(/(feat|with|版|伴奏|live|remix).*/gi, '');

const coreTitle = s => strip(String(s)
  .replace(/[（(\[【][^）)\]】]*[）)\]】]/g, '')
  .replace(/\s*[-–—]\s*.+$/, ''));

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

function titleMatch(a, b) {
  const x = strip(a), y = strip(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const cx = coreTitle(a), cy = coreTitle(b);
  if (cx && cy) {
    if (cx === cy) return true;
    const [s, l] = cx.length <= cy.length ? [cx, cy] : [cy, cx];
    if (s.length >= 3 && l.includes(s)) return true;
    if (diffCount(cx, cy) / Math.max(cx.length, cy.length) <= 0.3) return true;
  }
  return diffCount(x, y) / Math.max(x.length, y.length) <= 0.3;
}

function artistMatch(a, b) {
  const x = strip(a), y = strip(b);
  if (!x || !y) return false;
  if (x === y || y.includes(x) || x.includes(y)) return true;
  const parts = String(b).split(/&|、|,|，|feat\.?|with/i).map(strip).filter(Boolean);
  if (parts.some(p => p === x || p.includes(x) || x.includes(p))) return true;
  const A = new Set(x), B = new Set(y);
  let common = 0;
  for (const ch of A) if (B.has(ch)) common++;
  return common / Math.max(1, Math.min(A.size, B.size)) >= 0.5;
}

/* —— 精选/合辑/现场识别 ——
   来自陷阱 12 的教训：iTunes 常把单曲匹配到 Greatest Hits / 精选 / Live / 现场版，
   这些都不是「原专辑」。命中即跳过该候选，继续找下一条。 */
const COMPILATION_RE = /greatest\s*hits?|best\s*(of|sellers?)|the\s*best|essential|anthology|collection|compilation|精选|精選|暢銷|畅销|金曲|典藏|纪念|紀念|remaster|remastered|deluxe|remix(es|ed)?|live\s*(at|in|from)?|现场|現場|演唱会|演唱會|concert|acoustic\s*version|karaoke|伴奏|instrumental\s*version|tribute|covers?\s*album|翻唱|series|大全| legendary|legendary|anniversary|20th|hits?\s*vol|vol\.?\s*\d/i;

// 这些是「专辑名合法但易误判」的词，单独放行
const ALLOW_RE = /原创|原創|studio\s*album|录音室|錄音室/i;

function isCompilationAlbum(name) {
  if (!name) return true;
  if (ALLOW_RE.test(name)) return false;
  return COMPILATION_RE.test(name);
}

/* —— 候选质量打分：越像「原专辑」越高 —— */
function scoreCandidate(it, song) {
  let score = 0;
  const col = it.collectionName || '';
  // 同名专辑（单曲同名专辑，常见于中文流行）最可信
  if (strip(col) === strip(song.t)) score += 40;
  // 专辑名含曲名
  if (strip(col).includes(strip(song.t))) score += 10;
  // 曲目序号 1 且为专辑首曲 → 更像原专辑收录
  if (it.trackNumber === 1) score += 5;
  if ((it.trackCount || 0) >= 8) score += 5;   // 正规专辑通常 8 首以上
  // 发行年份越接近曲库年份越可信（防精选集撞车）
  if (it.releaseDate) {
    const y = Number(String(it.releaseDate).slice(0, 4));
    if (Number.isFinite(y)) {
      const diff = Math.abs(y - song.yr);
      if (diff === 0) score += 25;
      else if (diff <= 1) score += 18;
      else if (diff <= 3) score += 8;
      else if (diff > 15) score -= 15;        // 差太多年，多半是精选
    }
  }
  return score;
}
/* —— iTunes 搜索（多区 + 限流退避）—— */
const STORES_CN = ['hk', 'tw', 'jp', 'sg', 'us'];
const STORES_WEST = ['us', 'gb', 'de', 'fr', 'jp'];
const isClassical = s => s.gn.includes('古典');

async function itunesSearch(term, store) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=8&country=${store}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(16000) });
      if (res.status === 429 || res.status === 403) { await sleep(7000 * (attempt + 1)); continue; }
      if (!res.ok) return [];
      const text = await res.text();
      if (!text.trim().startsWith('{')) { await sleep(5000 * (attempt + 1)); continue; } // 限流返回纯文本
      const d = JSON.parse(text);
      return d.results || [];
    } catch { await sleep(3000); }
  }
  return [];
}

// 古典取拉丁别名作检索词（iTunes 条目是「英文作品名 + 演奏者」）
function classicalTerms(song) {
  const latin = song.al.filter(a => /[a-z]/i.test(a) && !/[\u4e00-\u9fff]/.test(a));
  return [...new Set([...latin, song.t].filter(t => t && t.length >= 3))];
}

async function findAlbum(song) {
  const candidates = [];

  if (isClassical(song)) {
    for (const term of classicalTerms(song)) {
      for (const store of STORES_WEST) {
        const results = await itunesSearch(term, store);
        for (const it of results) {
          if (!it.collectionName) continue;
          if (!titleMatch(term, it.trackName || '')) continue;
          if (isCompilationAlbum(it.collectionName)) continue;
          candidates.push({ it, store, score: scoreCandidate(it, song) });
        }
        if (candidates.length >= 3) break;
      }
      if (candidates.length >= 3) break;
    }
  } else {
    for (const store of STORES_CN) {
      const results = await itunesSearch(`${song.t} ${song.ar}`, store);
      for (const it of results) {
        if (!it.collectionName) continue;
        if (!titleMatch(song.t, it.trackName || '')) continue;
        if (!artistMatch(song.ar, it.artistName || '')) continue;
        if (isCompilationAlbum(it.collectionName)) continue;
        candidates.push({ it, store, score: scoreCandidate(it, song) });
      }
      if (candidates.length >= 4) break; // 够了就不再翻区，省请求
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  // 分数过低视为不可信，宁可缺失也不写错（陷阱 12：自动采纳不可信）
  if (best.score < 15) return null;
  return {
    album: best.it.collectionName,
    track: best.it.trackName,
    artist: best.it.artistName,
    store: best.store,
    score: best.score,
  };
}

/* —— 已有专辑集合（避免重复抓） —— */
async function existingIds() {
  const ids = new Set();
  // 从 albums-data.js 粗解析 id（不 import，避免 JSON/模块副作用）
  if (existsSync(ALBUMS_BASE)) {
    const src = await readFile(ALBUMS_BASE, 'utf8');
    for (const m of src.matchAll(/"([a-z]{1,2}\d+)":/g)) ids.add(m[1]);
  }
  if (existsSync(OUT)) {
    try {
      const extra = JSON.parse(await readFile(OUT, 'utf8'));
      for (const k of Object.keys(extra)) ids.add(k);
    } catch { /* 忽略损坏 */ }
  }
  return ids;
}

/* —— 主流程 —— */
const have = FORCE ? new Set() : await existingIds();
const extra = existsSync(OUT) && !FORCE ? JSON.parse(await readFile(OUT, 'utf8')) : {};

let todo = SONGS.filter(s => !have.has(s.id));
if (LIMIT) todo = todo.slice(0, LIMIT);

console.log(`[albums] 全库 ${SONGS.length} 首 | 已有专辑 ${have.size} | 本次待抓 ${todo.length} 首（gap ${GAP}ms）`);

await mkdir(dirname(OUT), { recursive: true });
await mkdir(dirname(REPORT), { recursive: true });

const report = { ok: [], miss: [], gap: GAP };
let n = 0;

for (const song of todo) {
  n++;
  const tag = `[${n}/${todo.length}] ${song.id} ${song.t}`;
  try {
    const found = await findAlbum(song);
    if (found) {
      extra[song.id] = toSimplified(found.album);
      report.ok.push({ id: song.id, t: song.t, ar: song.ar, album: extra[song.id], matched: found.track, by: found.artist, store: found.store });
      console.log(`${tag} ✓ ${extra[song.id]}`);
    } else {
      report.miss.push({ id: song.id, t: song.t, ar: song.ar });
      console.log(`${tag} 未命中`);
    }
  } catch (e) {
    report.miss.push({ id: song.id, t: song.t, ar: song.ar, err: String(e.message).slice(0, 80) });
    console.log(`${tag} ✗ ${String(e.message).slice(0, 60)}`);
  }

  // 每 25 首落盘一次（断点续跑）
  if (n % 25 === 0) {
    await writeFile(OUT, JSON.stringify(extra, null, 1), 'utf8');
    await writeFile(REPORT, JSON.stringify(report, null, 2), 'utf8');
    console.log(`  —— 已落盘 ${Object.keys(extra).length} 条 ——`);
  }
  await sleep(GAP);
}

await writeFile(OUT, JSON.stringify(extra, null, 1), 'utf8');
await writeFile(REPORT, JSON.stringify(report, null, 2), 'utf8');

const mb = (await stat(OUT)).size / 1024;
console.log(`\n[albums] 完成：命中 ${report.ok.length} / 未命中 ${report.miss.length}`);
console.log(`[albums] 累计 ${Object.keys(extra).length} 条 → ${OUT} (${mb.toFixed(0)}KB)`);
if (report.miss.length) {
  console.log('[albums] 未命中示例：', report.miss.slice(0, 10).map(m => m.t).join(' / '));
}
