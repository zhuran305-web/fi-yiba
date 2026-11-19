/* 可搜性审计：中文或英文至少一个入口（node tools/check-searchable.mjs）
   规则：t 或别名含汉字 → 中文可搜；t 本身是纯拉丁字母（原曲英文名）→ 英文可搜；
   两者皆无 → 违规（原曲为第三语言且没有中/英文入口）。 */
import { SONGS } from '../js/bank.js';

const HAN = /[\u4e00-\u9fff]/;
// 英文原题判定：拉丁字母（含 À-ÿ 变音符，如 Señorita）+ 常见标点
const ASCII_TITLE = /^[a-z0-9À-ÿ\s'’&\-!?.(),]+$/i;
const LATIN = /[a-z]/i;

const violations = [];
const classicalNoLatinAlias = [];

for (const s of SONGS) {
  const names = [s.t, ...s.al];
  const hasHan = names.some(n => HAN.test(n));
  const asciiTitle = ASCII_TITLE.test(s.t);
  if (!hasHan && !asciiTitle) violations.push(`${s.id}「${s.t}」(${s.ar}) al=[${s.al.join(' / ')}]`);
  // 曲名本身是拉丁字母（如 Experience / Nuvole Bianche）不算缺英文入口
  if (s.gn.includes('古典') && !LATIN.test(s.t) && !s.al.some(a => LATIN.test(a))) {
    classicalNoLatinAlias.push(`${s.id}「${s.t}」`);
  }
}

console.log(`全库 ${SONGS.length} 首`);
console.log(`违规（无汉字且曲名非英文）：${violations.length}`);
violations.forEach(v => console.log('  ' + v));
console.log(`古典缺拉丁别名：${classicalNoLatinAlias.length}`);
classicalNoLatinAlias.forEach(v => console.log('  ' + v));
process.exit(violations.length ? 1 : 0);
