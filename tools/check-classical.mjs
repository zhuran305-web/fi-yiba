/* 古典乐曲增补后的曲库一致性校验（node tools/check-classical.mjs） */
import {
  SONGS, ARTISTS, GENRES, REGIONS, LANGS,
} from '../js/bank.js';
import {
  standardPool, simplePool, scopePool, uniqify, titleLen,
} from '../js/game.js';

const cls = SONGS.filter(s => s.gn.includes('古典'));
const ids = new Set(SONGS.map(s => s.id));
const fail = [];
const ok = (name, cond, detail = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`) || (cond || fail.push(name));

ok('曲库总数 1593', SONGS.length === 1593, String(SONGS.length));
ok('古典曲目 ≥84（只增不减）', cls.length >= 84, String(cls.length));
ok('id 无重复', ids.size === SONGS.length, `${ids.size}/${SONGS.length}`);
ok('流派含「古典」', GENRES.includes('古典'));
ok('全部 q=1（隔离每日/标准池）', cls.every(s => s.q === 1));
ok('全部 lg=器乐', cls.every(s => s.lg === '器乐'));
ok('全部有专辑（母作品集口径）', cls.every(s => !!s.alb), cls.filter(s => !s.alb).map(s => s.id).join(','));
ok('全部 ht 2-5', cls.every(s => s.ht >= 2 && s.ht <= 5));

// 池子规模：扩库后公平池/简单池会变，这里只断言非空且古典不稀释
ok('公平池非空', standardPool().length > 0, String(standardPool().length));
ok('简单池非空', simplePool().length > 0, String(simplePool().length));
ok('公平池不含古典（q=1 生效）', standardPool().every(s => !s.gn.includes('古典')));
ok('简单池不含古典（年份+语言过滤）', simplePool().every(s => !s.gn.includes('古典')));

// 自定义范围：古典可出题
const pure = scopePool({ genres: ['古典'] });
ok('纯古典范围非空', pure.length > 0, `${pure.length} 首（签名去重后 ${cls.length - pure.length} 首不可作答案）`);
const collide = cls.filter(s => !pure.includes(s)).map(s => `${s.id} ${s.t}`);
if (collide.length) console.log('  碰撞排除（互猜同签名）:', collide.join(' / '));
// 「70 前」chip 覆盖 1980 前所有年份（含古典）；现代古典（如 Einaudi 2004/2013）本就不该被它命中
const cls80 = pure.filter(s => s.yr < 1980);
ok('古典 + 70前年代 = 1980 前古典曲目', scopePool({ genres: ['古典'], decades: [1970] }).length === cls80.length,
  `${scopePool({ genres: ['古典'], decades: [1970] }).length} / 期望 ${cls80.length}（1980 后的现代古典被正确排除）`);
ok('古典 + 热度≥4 非空', scopePool({ genres: ['古典'], minHeat: 4 }).length > 0,
  String(scopePool({ genres: ['古典'], minHeat: 4 }).length));
ok('古典 + 仅5 非空', scopePool({ genres: ['古典'], minHeat: 5 }).length > 0,
  String(scopePool({ genres: ['古典'], minHeat: 5 }).length));
ok('华语+古典 = 空（词表互斥合理）', scopePool({ langs: ['国语'], genres: ['古典'] }).length === 0);

// 猜歌手：作曲家已派生为歌手条目
const composers = ARTISTS.filter(a => a.gn.includes('古典'));
ok('作曲家进入歌手表', composers.length > 0, `${composers.length} 位（总歌手 ${ARTISTS.length}）`);
const sample = composers.slice(0, 3).map(a => `${a.ar}(${a.count}首,${a.yr},${a.lg},${a.rg})`).join('  ');
console.log('  样例:', sample);
ok('作曲家语言口径=器乐', composers.every(a => a.lg === '器乐'));

// 新地区词表可达性
ok('新地区在 REGIONS', ['德国', '奥地利', '俄国', '波兰'].every(r => REGIONS.includes(r)));
ok('范围地区过滤可用', scopePool({ genres: ['古典'], regions: ['德国'] }).length > 0,
  String(scopePool({ genres: ['古典'], regions: ['德国'] }).length));

// 别名检索抽查
const q = (name) => {
  const s = SONGS.find(x => x.t === name || x.al.includes(name));
  return s ? `${s.id} ${s.t} / ${s.ar}` : '未命中';
};
for (const n of ['致爱丽丝', 'Für Elise', '命运交响曲', '卡农', '四季·冬', '月光曲', 'O Fortuna']) {
  console.log(`  别名[${n}] →`, q(n));
}

// 每日答案不受影响（确定性散列取题仍来自旧公平池）
console.log(fail.length ? `\n${fail.length} 项失败` : '\n全部通过');
process.exit(fail.length ? 1 : 0);
