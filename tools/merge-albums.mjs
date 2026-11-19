#!/usr/bin/env node
/*
 * 把 data/albums-extra.json（fetch-albums-v3.mjs 的产出）合并进 js/albums-data.js。
 *
 * 为什么需要独立一步：
 *   · albums-data.js 是 JS 模块（不能是 JSON——Vite 8 会静默不产出，见陷阱 1）
 *   · albums-extra.json 只含新抓到的，需要与既有 849 条合并去重
 *   · 合并后要重新生成模块，保持「一个 id 一个专辑名」的扁平结构
 *
 * 用法：node tools/merge-albums.mjs [--dry]
 */
import { readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = join(ROOT, 'js', 'albums-data.js');
const EXTRA = join(ROOT, 'data', 'albums-extra.json');
const OUT = join(ROOT, 'js', 'albums-data.js');
const dry = process.argv.includes('--dry');

const { SONGS } = await import('../js/bank.js');
const { toSimplified } = await import('../js/t2s.js');

// 1) 从现有模块解析已有映射（粗解析 export default { "id": "专辑" }）
const baseSrc = existsSync(BASE) ? await readFile(BASE, 'utf8') : 'export default {};\n';
const base = {};
for (const m of baseSrc.matchAll(/"([a-z]{1,2}\d+)":\s*"((?:[^"\\]|\\.)*)"/g)) {
  base[m[1]] = m[2].replace(/\\"/g, '"');
}
console.log(`[merge] 现有映射 ${Object.keys(base).length} 条`);

// 2) 读新增（优先用清理后的合并结果）
let extra = {};
if (existsSync(join(ROOT, 'data', 'albums-merged-clean.json'))) {
  extra = JSON.parse(await readFile(join(ROOT, 'data', 'albums-merged-clean.json'), 'utf8'));
  console.log(`[merge] 用清理后的合并数据 ${Object.keys(extra).length} 条`);
} else if (existsSync(EXTRA)) {
  extra = JSON.parse(await readFile(EXTRA, 'utf8'));
  console.log(`[merge] 新增映射 ${Object.keys(extra).length} 条`);
} else {
  console.log('[merge] 没有 albums-extra.json，跳过');
}

// 3) 合并（新增覆盖旧的：v3 的匹配带质量过滤，更可信）
const merged = { ...base };
let added = 0, updated = 0;
for (const [id, alb] of Object.entries(extra)) {
  if (!alb || typeof alb !== 'string') continue;
  const clean = toSimplified(alb).trim();
  if (!clean) continue;
  if (merged[id] === clean) continue;
  if (merged[id]) updated++; else added++;
  merged[id] = clean;
}

// 3.5) 全量清理：精选/合辑/周年重制/现场（对 base+extra 全部生效，见陷阱 12）
const SUSPECT_RE = /真经典|经典101|复黑王|復黑王|mastersonic|音乐大全|best sellers?|legendary|music box|hit song|anniversary|remix(es|ed)?|best a\.|best show|珍藏|典藏| Hits |Hits:|hits?:|精选|精選|暢銷|畅销|金曲| Greatest | greatest|精选集|精選集|新歌\+|新曲\+| gold|Gold|金选|当年金曲|8in1|4合1/i;
const cleanedOut = [];
for (const [id, alb] of Object.entries(merged)) {
  if (SUSPECT_RE.test(alb)) { cleanedOut.push(`${id}: ${alb}`); delete merged[id]; }
}
console.log(`[merge] 全量清理掉 ${cleanedOut.length} 条合辑/精选`);

// 3.6) 周年重制版恢复（正版专辑，去掉版本后缀）
const RESTORE = {
  r14: 'The Joshua Tree', s85: 'Spice', s87: 'Oops!... I Did It Again', s111: 'Out of Time',
};
for (const [id, alb] of Object.entries(RESTORE)) if (validIdsFallback(id)) merged[id] = alb;
function validIdsFallback(id) { return SONGS.some(s => s.id === id); }

// 4) 只保留曲库里真实存在的 id，并按曲库顺序输出（便于人工 diff）
const validIds = new Set(SONGS.map(s => s.id));
const ordered = {};
let dropped = 0;
for (const s of SONGS) {
  if (merged[s.id] && validIds.has(s.id)) ordered[s.id] = merged[s.id];
}
for (const id of Object.keys(merged)) if (!validIds.has(id)) dropped++;

const total = Object.keys(ordered).length;
console.log(`[merge] 合并结果 ${total} 条（新增 ${added} / 更新 ${updated} / 丢弃无效 id ${dropped}）`);
console.log(`[merge] 覆盖率 ${(total / SONGS.length * 100).toFixed(1)}%（${total}/${SONGS.length}）`);

if (dry) { console.log('[merge] dry-run，未写入'); process.exit(0); }

// 5) 生成模块（保持原有头部注释风格）
const body = Object.entries(ordered)
  .map(([id, alb]) => `  "${id}": ${JSON.stringify(alb)}`)
  .join(',\n');

const src = `/* 专辑映射（uid → 专辑名）
   ------------------------------------------------------------
   来源：
     · 主体：tools/fetch-albums.mjs（iTunes 港台区抓取，原 849 条）
     · 增补：tools/fetch-albums-v3.mjs → data/albums-extra.json
             （全库重抓，含精选/现场过滤与打分选优）
   生成：tools/merge-albums.mjs 合并去重后写出
   纪律：必须是 JS 模块，不能改成 .json —— Vite 8 / rolldown 下 JSON 导入会
         **静默不产出** build 结果（见开发记录陷阱 1）。不要手改此文件。
   ------------------------------------------------------------ */
export default {
${body}
};
`;

await writeFile(OUT, src, 'utf8');
const size = (await stat(OUT)).size;
console.log(`[merge] 已写入 ${relative(ROOT, OUT)}（${(size / 1024).toFixed(0)}KB）`);
