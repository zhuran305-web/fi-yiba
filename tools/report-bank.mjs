/* 曲库分类报告：按地区/语言/流派/年代/热度/歌手输出分布，
   并标注每类的「可出题性」——有专辑才能在公平池当答案。
   用法：node tools/report-bank.mjs [--top=30] */
import { SONGS, ARTISTS, REGIONS, LANGS, GENRES } from '../js/bank.js';
import { standardPool, simplePool, scopePool } from '../js/game.js';

const argv = process.argv.slice(2);
const TOP = Number((argv.find(a => a.startsWith('--top=')) || '--top=30').split('=')[1]);

const total = SONGS.length;
const withAlb = SONGS.filter(s => s.alb).length;
const pct = (n, d = total) => `${((n / d) * 100).toFixed(1)}%`;

const bar = (n, max, width = 22) => {
  const len = max ? Math.round((n / max) * width) : 0;
  return '█'.repeat(len) + '░'.repeat(width - len);
};

const section = title => console.log(`\n${'─'.repeat(64)}\n${title}\n${'─'.repeat(64)}`);

console.log(`Fi一把 曲库分类报告   共 ${total} 首 / ${ARTISTS.length} 位歌手`);
console.log(`专辑齐全 ${withAlb} 首（${pct(withAlb)}）｜缺专辑 ${total - withAlb} 首（不影响出题，只影响能否当公平池答案）`);

/* —— 地区 —— */
section('一、按地区');
const byRg = {};
for (const s of SONGS) {
  const r = byRg[s.rg] || (byRg[s.rg] = { n: 0, alb: 0, avail: 0 });
  r.n++; if (s.alb) r.alb++;
  if (s.ht >= 4 && !s.q && s.alb) r.avail++;
}
const rgSorted = Object.entries(byRg).sort((a, b) => b[1].n - a[1].n);
const rgMax = rgSorted[0][1].n;
for (const [rg, v] of rgSorted) {
  console.log(`  ${rg.padEnd(4)} ${String(v.n).padStart(4)} 首  ${bar(v.n, rgMax)}  ${pct(v.n)}`);
}

/* —— 语言 —— */
section('二、按语言');
const byLg = {};
for (const s of SONGS) byLg[s.lg] = (byLg[s.lg] || 0) + 1;
const lgSorted = Object.entries(byLg).sort((a, b) => b[1] - a[1]);
const lgMax = lgSorted[0][1];
for (const [lg, n] of lgSorted) {
  console.log(`  ${lg.padEnd(4)} ${String(n).padStart(4)} 首  ${bar(n, lgMax)}  ${pct(n)}`);
}

/* —— 流派（含组合流派）—— */
section('三、按流派（一首可多标签，故合计 > 总数）');
const byGn = {};
for (const s of SONGS) for (const g of s.gn) byGn[g] = (byGn[g] || 0) + 1;
const gnSorted = Object.entries(byGn).sort((a, b) => b[1] - a[1]);
const gnMax = gnSorted[0][1];
for (const [g, n] of gnSorted) {
  const mark = GENRES.includes(g) ? '' : '  ⚠ 不在 GENRES 词表';
  console.log(`  ${g.padEnd(5)} ${String(n).padStart(4)} 首  ${bar(n, gnMax)}  ${pct(n)}${mark}`);
}

/* —— 年代 —— */
section('四、按年代');
const byDec = {};
for (const s of SONGS) {
  const d = Math.floor(s.yr / 10) * 10;
  byDec[d] = (byDec[d] || 0) + 1;
}
const decKeys = Object.keys(byDec).map(Number).sort((a, b) => a - b);
const decMax = Math.max(...Object.values(byDec));
for (const d of decKeys) {
  const label = d < 1960 ? `${d}s 前` : `${d}s`;
  console.log(`  ${label.padEnd(8)} ${String(byDec[d]).padStart(4)} 首  ${bar(byDec[d], decMax)}`);
}

/* —— 热度 —— */
section('五、按热度（5=国民级，1=冷门）');
const byHt = {};
for (const s of SONGS) byHt[s.ht] = (byHt[s.ht] || 0) + 1;
const htMax = Math.max(...Object.values(byHt));
for (const h of [5, 4, 3, 2, 1]) {
  const n = byHt[h] || 0;
  console.log(`  ${String(h).padStart(2)} 星    ${String(n).padStart(4)} 首  ${bar(n, htMax)}  ${pct(n)}`);
}

/* —— 池子 —— */
section('六、出题池（决定「能玩什么」）');
const std = standardPool();
const simple = simplePool();
const all = scopePool({});
console.log(`  公平池（每日/标准答案）  ${String(std.length).padStart(4)} 首   条件：热度≥4 且无待核 且八项齐全 且签名全库唯一`);
console.log(`  简单池（简单模式）      ${String(simple.length).padStart(4)} 首   条件：1996 年后 且（热5 或 热4国语）`);
console.log(`  全不限范围（自定义）    ${String(all.length).padStart(4)} 首   条件：八项齐全 且签名唯一`);
console.log(`  全库（无限练习）        ${String(total).padStart(4)} 首   任何曲目都能被猜中`);

/* —— 歌手 Top —— */
section(`七、歌手曲量 Top ${TOP}`);
const arSorted = [...ARTISTS].sort((a, b) => b.count - a.count).slice(0, TOP);
for (let i = 0; i < arSorted.length; i++) {
  const a = arSorted[i];
  console.log(`  ${String(i + 1).padStart(2)}. ${a.ar.padEnd(12)} ${String(a.count).padStart(3)} 首   ${a.rg}/${a.lg}   最早 ${a.yr}`);
}

/* —— 词表一致性 —— */
section('八、数据健康度');
const badRg = SONGS.filter(s => !REGIONS.includes(s.rg));
const badLg = SONGS.filter(s => !LANGS.includes(s.lg));
const badGn = SONGS.filter(s => s.gn.some(g => !GENRES.includes(g)));
const badHt = SONGS.filter(s => !(s.ht >= 1 && s.ht <= 5));
const ids = SONGS.map(s => s.id);
const dupId = ids.length - new Set(ids).size;
const keys = SONGS.map(s => s.t + '|' + s.ar);
const dupSong = keys.length - new Set(keys).size;
const check = (label, n) => console.log(`  ${n === 0 ? 'PASS' : 'FAIL'}  ${label}${n ? `（${n} 条）` : ''}`);
check('地区都在 REGIONS 词表', badRg.length);
check('语言都在 LANGS 词表', badLg.length);
check('流派都在 GENRES 词表', badGn.length);
check('热度在 1-5 范围', badHt.length);
check('ID 无重复', dupId);
check('曲名+歌手 无重复', dupSong);
