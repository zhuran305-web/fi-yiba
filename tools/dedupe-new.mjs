/* 删除 n 前缀行中与既有曲目「曲名+歌手」重复的条目（保留原有条目，其专辑年份已核实）。
   用法：node tools/dedupe-new.mjs [--dry]
   只处理 s('nXXXX' 开头的行，不动任何既有数据。 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FILE = join(ROOT, 'js', 'bank.js');
const dry = process.argv.includes('--dry');

const { SONGS } = await import('../js/bank.js');
const key = s => s.t + '|' + s.ar;

// 既有曲目（非 n 前缀）的键集合
const existing = new Set();
for (const s of SONGS) if (!/^n\d/.test(s.id)) existing.add(key(s));

// 找出要删的新增 id
const toDrop = new Set();
const seenNew = new Set();
for (const s of SONGS) {
  if (!/^n\d/.test(s.id)) continue;
  const k = key(s);
  if (existing.has(k) || seenNew.has(k)) toDrop.add(s.id);
  else seenNew.add(k);
}

console.log(`将删除 ${toDrop.size} 条新增重复曲目${dry ? '（dry-run）' : ''}`);
if (dry) { console.log([...toDrop].join(', ')); process.exit(0); }

const src = await readFile(FILE, 'utf8');
const lines = src.split('\n');
const kept = [];
let removed = 0;
for (const line of lines) {
  const m = /^\s*[sc]\('(n\d+)'/.exec(line);
  if (m && toDrop.has(m[1])) { removed++; continue; }
  kept.push(line);
}
await writeFile(FILE, kept.join('\n'), 'utf8');
console.log(`已删除 ${removed} 行`);
