/* ============================================================
   Fi一把 · 专辑补全管线 v2（tools/fetch-albums.mjs）
   ------------------------------------------------------------
   来源：iTunes 多区（hk → tw → jp → sg → us）——实测日/新/美区也有大量中文歌
     1) 复用 tools/out/year-report.json 里已抓到的 itAlbum
     2) 其余逐曲查询（term = 曲名 + 歌手，limit 6）
   匹配（关键修正）：不做严格简繁归一，改用**容错比对**
     · 曲名：归一后完全相同，或等长且差异字符 ≤ max(1, 30%)
     · 歌手：包含关系，或字符重合率 ≥ 0.5（"黑豹樂隊"vs"黑豹乐队"=0.5 ✓；"小潘潘&小峯"⊃"小潘潘" ✓）
   用法：HTTPS_PROXY=http://127.0.0.1:7897 NODE_USE_ENV_PROXY=1 node tools/fetch-albums.mjs
   输出：data/albums.json  { 曲目id: 专辑名 }
   ============================================================ */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const REPORT = join(__dir, 'out', 'year-report.json');
const OUT = join(ROOT, 'data', 'albums.json');

const UA = 'FiYibaPrototype/0.1 (personal research)';
const STORES = ['hk', 'tw', 'jp', 'sg', 'us'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const strip = s => String(s).toLowerCase().replace(/[\s·・,，.。!！?？'"“”‘’()（）\-—–_/\\[\]]+/g, '').replace(/(feat|with|版|伴奏|live|remix).*/gi, '');

function diffCount(a, b) {
  if (a.length !== b.length) return 99;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

function titleMatch(a, b) {
  const x = strip(a), y = strip(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const d = diffCount(x, y);
  return d <= Math.max(1, Math.floor(x.length * 0.3)) && d < x.length;
}

function artistMatch(a, b) {
  const x = strip(a), y = strip(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const A = new Set(x), B = new Set(y);
  let common = 0;
  for (const ch of A) if (B.has(ch)) common++;
  return common / Math.max(1, Math.min(A.size, B.size)) >= 0.5;
}

async function search(term, store) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=6&country=${store}`;
  for (let a = 1; a <= 2; a++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(16000) });
      if (res.status === 403 || res.status === 429) { await sleep(4000 * a); continue; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) { if (a === 2) return null; await sleep(2500); }
  }
}

/* —— 主流程 ——
   曲目清单不导入 bank.js（Node 对 JSON 导入有额外限制），直接读核年报告
   —— 报告里含全库每首的 id / 曲名 / 歌手 —— */
if (!existsSync(REPORT)) { console.error('缺少 tools/out/year-report.json，先跑 verify-years.mjs'); process.exit(1); }
const rep = JSON.parse(readFileSync(REPORT, 'utf8'));
const SONGS = (rep.report || []).map(r => ({ id: r.id, t: r.t, ar: r.ar }));

const albums = {};
for (const r of rep.report || []) if (r.itAlbum) albums[r.id] = r.itAlbum;
console.log(`曲目总数 ${SONGS.length} · 复用已抓到的专辑 ${Object.keys(albums).length} 首`);

const todo = SONGS.filter(s => !albums[s.id]);
console.log(`需逐曲查询: ${todo.length} 首`);

let ok = 0, miss = 0;
for (const [i, song] of todo.entries()) {
  let hit = null;
  for (const store of STORES) {
    const json = await search(`${song.t} ${song.ar}`, store);
    const cand = (json?.results || [])
      .map(x => ({ alb: x.collectionName, a: x.artistName, t: x.trackName, y: Number((x.releaseDate || '').slice(0, 4)) || 9999 }))
      .filter(x => titleMatch(x.t, song.t) && artistMatch(x.a, song.ar))
      .sort((x, y) => x.y - y.y);
    if (cand.length) { hit = cand[0].alb; break; }
    await sleep(600);
  }
  if (hit) { albums[song.id] = hit; ok++; } else miss++;
  if ((i + 1) % 20 === 0) console.log(`[${i + 1}/${todo.length}] 命中 ${ok} / 未找到 ${miss}`);
  await sleep(900);
}

mkdirSync(join(ROOT, 'data'), { recursive: true });
writeFileSync(OUT, JSON.stringify(albums, null, 0));
console.log(`\n=== 完毕 === 专辑覆盖 ${Object.keys(albums).length}/${SONGS.length}（本次新增 ${ok}，未找到 ${miss}）`);
console.log('输出: ' + OUT);
