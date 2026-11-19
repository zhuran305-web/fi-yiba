#!/usr/bin/env node
/* 清理 albums-extra.json 中的可疑合辑/Remix 条目：
   · 删除匹配 SUSPECT_RE 的条目
   · BTTB 20周年版 → 改名 BTTB（正版重录，名称简化）
   删除后重跑 fetch-albums-v3.mjs 会自动补抓这些曲目。 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, 'data', 'albums-extra.json');

const SUSPECT_RE = /hits?|series|best|gold|golden|legendary|精选|精選|暢銷|畅销|金曲|典藏|全集|大全|合集|纪念|紀念|anniversary|live|演唱|現場|现场|collection|anthology|essential|deluxe|remaster|remix(es|ed)?|mix|串烧|串燒|non-stop|medley|top\s*\d+|very\s*best|love\s*songs?|黄金|黃金|101/i;

const d = JSON.parse(await readFile(OUT, 'utf8'));
const total0 = Object.keys(d).length;

const removed = [], renamed = [], kept = {};
for (const [id, alb] of Object.entries(d)) {
  if (id === 'n3401' && /anniversary/i.test(alb)) { renamed.push(`${id}: ${alb} → BTTB`); kept[id] = 'BTTB'; continue; }
  if (SUSPECT_RE.test(alb)) { removed.push(`${id}: ${alb}`); continue; }
  kept[id] = alb;
}

await writeFile(OUT, JSON.stringify(kept, null, 1), 'utf8');
console.log(`清理前 ${total0} → 清理后 ${Object.keys(kept).length}`);
console.log(`删除 ${removed.length} 条：`);
removed.forEach(r => console.log('  -', r));
if (renamed.length) { console.log('改名：'); renamed.forEach(r => console.log('  ~', r)); }
