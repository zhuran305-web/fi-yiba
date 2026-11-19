/* ============================================================
   Fi一把 · 年份核实管线（tools/verify-years.mjs）
   ------------------------------------------------------------
   数据源：iTunes Search API 港区商店（官方、免费、无密钥；大陆区该接口空）
     逐歌手查询 limit=200 → 拿到该歌手全部曲目（含 releaseDate / 专辑 / 流派）
     简繁归一 + 去符号后匹配曲名 → 取最早发行年（规避重发/精选集年份）
   用法：node tools/verify-years.mjs [--limit N] [--only "歌手名"]
        经代理运行：HTTPS_PROXY=http://127.0.0.1:7897 NODE_USE_ENV_PROXY=1 node ...
   输出：tools/out/year-report.json（逐曲目：我方年份 / iTunes 年份 / 专辑 / 流派 / 状态）
   只读：不修改题库，供人工复核后回填
   ============================================================ */

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SONGS } from '../js/bank.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dir, 'out');

const args = process.argv.slice(2);
const argvLimit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : 0;
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

/* —— 简繁归一：覆盖曲名/歌手名常见变体字 —— */const T2S = {
  周杰倫: '周杰伦', 陳: '陈', 奕迅: '奕迅', 五月天: '五月天', 劉: '刘', 華: '华', 張: '张', 學: '学', 友: '友',
  鄧: '邓', 麗: '丽', 君: '君', 齊: '齐', 秦: '秦', 王: '王', 傑: '杰', 譚: '谭', 詠: '咏', 麟: '麟', 梅: '梅',
  艷: '艳', 芳: '芳', 國: '国', 榮: '荣', 偉: '伟', 羅: '罗', 大: '大', 佑: '佑', 李: '李', 宗: '宗', 盛: '盛',
  齊豫: '齐豫', 蘇: '苏', 芮: '芮', 瀟: '潇', 敬: '敬', 騰: '腾', 許: '许', 嵩: '嵩', 薛: '薛', 之: '之', 謙: '谦',
  張: '张', 靚: '靓', 穎: '颖', 樑: '梁', 靜: '静', 茹: '茹', 燕: '燕', 姿: '姿', 韶: '韶', 涵: '涵', 惠: '惠',
  妹: '妹', 祖: '祖', 兒: '儿', 楊: '杨', 千: '千', 嬅: '嬅', 慧: '慧', 琳: '琳', 秀: '秀', 文: '文', 霆: '霆',
  鋒: '锋', 亞: '亚', 軒: '轩', 嶽: '岳', 傳: '传', 雄: '雄', 樂: '乐', 團: '团', 隊: '队', 飛: '飞',
  兒: '儿', 飛: '飞', 倫: '伦', 靂: '雳', 蘇打綠: '苏打绿', 蕭: '萧', 敬: '敬', 宥: '宥', 嘉: '嘉', 馥: '馥',
  甄: '甄', 熾: '炽', 蘊: '蕴', 郁: '郁', 可: '可', 唯: '唯', 碧: '碧', 晨: '晨', 靚: '靓', 穎: '颖', 鏗: '铿',
  鏵: '铧', 陳慧嫺: '陈慧娴', 慧: '慧', 嫺: '娴', 蔡: '蔡', 琴: '琴', 葉: '叶', 倩: '倩', 儀: '仪', 聰: '聪',
  貝: '贝', 羅: '罗', 宏: '宏', 陶: '陶', 喆: '喆', 王菲: '王菲', 竇: '窦', 唯: '唯', 汪: '汪', 蘇: '苏',
  趙: '赵', 雷: '雷', 朴: '朴', 樹: '树', 花: '花', 粥: '粥', 房: '房', 貓: '猫', 暗: '暗', 杠: '杠',
  創: '创', 作: '作', 導: '导', 演: '演', 說: '说', 話: '话', 東: '东', 風: '风', 雲: '云', 時: '时', 間: '间',
  愛: '爱', 戀: '恋', 夢: '梦', 聲: '声', 見: '见', 現: '现', 後: '后', 髮: '发', 頭: '头', 裡: '里',
  為: '为', 與: '与', 讓: '让', 願: '愿', 會: '会', 個: '个', 們: '们', 這: '这', 那: '那', 開: '开', 關: '关',
  無: '无', 處: '处', 過: '过', 還: '还', 什: '什', 麼: '么', 怎: '怎', 樣: '样', 別: '别', 對: '对',
  於: '于', 應: '应', 該: '该', 點: '点', 麼: '么', 數: '数', 記: '记', 憶: '忆', 舊: '旧', 難: '难',
  語: '语', 誰: '谁', 換: '换', 隨: '随', 變: '变', 氣: '气', 節: '节', 緣: '缘', 親: '亲', 雙: '双',
  臘: '腊', 髮: '发', 銀: '银', 鐵: '铁', 鋼: '钢', 藍: '蓝', 紅: '红', 綠: '绿', 黃: '黄', 葉: '叶',
  敵: '敌', 贈: '赠', 譜: '谱', 樂: '乐', 嗎: '吗', 呀: '呀', 喔: '喔', 哦: '哦', 喂: '喂', 週: '周',
  鉤: '钩', 鑰: '钥', 錄: '录', 鍵: '键', 籠: '笼', 燈: '灯', 燒: '烧', 熱: '热', 潤: '润', 澤: '泽',
  灣: '湾', 護: '护', 舖: '铺', 裡: '里', 產: '产', 業: '业', 麵: '面', 齊: '齐', 撬: '撬', 樹: '树',
};
function t2s(str) {
  let out = '';
  for (const ch of str) out += (T2S[ch] || ch);
  return out;
}
const norm = s => t2s(String(s)).toLowerCase().replace(/[\s·・,，.。!！?？'"“”‘’()（）\-—–_/\\[\]]+/g, '');

// 简→繁（T2S 反转，用于港区查询回退：阿婆名字简化体在港区常查不到）
const S2T = {};
for (const [t, s] of Object.entries(T2S)) {
  if (t.length === 1 && s.length === 1 && t !== s && !S2T[s]) S2T[s] = t;
}
const s2t = str => [...str].map(ch => S2T[ch] || ch).join('');

/* —— iTunes 查询（港区，限速 + 重试） —— */
const UA = 'FiYibaPrototype/0.1 (personal research)';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function itunesArtist(artist, store = 'hk') {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(artist)}&media=music&entity=song&limit=200&country=${store}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
      if (res.status === 403 || res.status === 429) { await sleep(6000 * attempt); continue; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      if (attempt === 3) throw e;
      await sleep(4000 * attempt);
    }
  }
}

/* —— 主流程 —— */
const byArtist = new Map();
for (const song of SONGS) {
  if (!byArtist.has(song.ar)) byArtist.set(song.ar, []);
  byArtist.get(song.ar).push(song);
}
let artists = [...byArtist.keys()];
if (only) artists = artists.filter(a => a.includes(only));
if (argvLimit) artists = artists.slice(0, argvLimit);

const report = [];
let stat = { ok: 0, autoFix: 0, review: 0, notfound: 0, artistMiss: 0 };

for (const [i, artist] of artists.entries()) {
  const songs = byArtist.get(artist);
  let json = null;
  try {
    json = await itunesArtist(artist);
    // 简化体在港区可能查不到 → 用繁体再试一次
    if (!json || !json.resultCount) {
      const trad = s2t(artist);
      if (trad !== artist) json = await itunesArtist(trad);
    }
    if (!json || !json.resultCount) json = await itunesArtist(artist, 'tw'); // 再退台区
  } catch (e) {
    console.log(`[${i + 1}/${artists.length}] ${artist}  查询失败: ${e.message}`);
    for (const s of songs) { report.push({ id: s.id, t: s.t, ar: s.ar, my: s.yr, it: null, status: 'artistMiss' }); stat.artistMiss++; }
    await sleep(2500);
    continue;
  }
  const wantArtist = norm(artist);
  const tracks = (json.results || []).map(x => ({
    t: x.trackName, a: x.artistName, y: Number((x.releaseDate || '').slice(0, 4)) || null, alb: x.collectionName, g: x.primaryGenreName,
  }));
  // 只保留艺术家名字对得上的曲目（挡住翻唱/钢琴版）
  const own = tracks.filter(x => norm(x.a).includes(wantArtist) || wantArtist.includes(norm(x.a)));
  const hits = [];
  for (const s of songs) {
    const want = norm(s.t);
    const exact = own.filter(x => norm(x.t) === want);
    const pool = exact.length ? exact : own.filter(x => norm(x.t).includes(want) || want.includes(norm(x.t)));
    const years = pool.map(x => x.y).filter(saneYear);
    const best = years.length ? Math.min(...years) : null;
    const rec = pool.sort((a, b) => (a.y || 9999) - (b.y || 9999))[0] || null;
/* 专辑名像精选集/现场/复刻 → 年份不可作为原始发行年（降级为待判） */
const COMPILATION_RE = /精選|精选|經典|经典|金曲|寶典|宝典|音色|典藏|世紀|世纪|極品|极品|至尊|珍藏|精粹|名曲|好歌|Best|Greatest|Collection|Anthology|Essential|Definitive|Hits|Remaster|復刻|复刻|現場|现场|Live|演唱會|演唱会|紀念|纪念|特選|特选|情歌集|主題曲集|主题曲集|電視劇主題曲|电视剧主题曲|Single|單曲|EP$/i;
/* 合理发行年区间：早于 1950 或非四位数视为脏数据 */
const saneYear = y => Number.isFinite(y) && y >= 1950 && y <= 2030;

    let status = 'notfound';
    if (best) {
      if (best === s.yr) { status = 'ok'; stat.ok++; }
      else if (best < s.yr) {
        // iTunes 更早：若是精选/现场版，年份不可信 → 待判；否则可采纳
        status = COMPILATION_RE.test(rec?.alb || '') ? 'review' : 'autoFix';
        if (status === 'autoFix') stat.autoFix = (stat.autoFix || 0) + 1;
        else stat.review = (stat.review || 0) + 1;
      }
      else { status = 'review'; stat.review = (stat.review || 0) + 1; }
    } else stat.notfound++;
    report.push({
      id: s.id, t: s.t, ar: s.ar, my: s.yr, it: best,
      itAlbum: rec?.alb || null, itGenre: rec?.g || null,
      itArtist: rec?.a || null, cand: years.length, status,
    });
    if (best && best !== s.yr) hits.push(`${s.t}: ${s.yr}→${best}${best < s.yr ? '(采纳)' : '(待判)'}`);
  }
  console.log(`[${i + 1}/${artists.length}] ${artist}  曲目 ${songs.length}  iTunes候选 ${own.length}` + (hits.length ? `  修正 ${hits.join('; ')}` : ''));
  await sleep(2200);
}

mkdirSync(OUT_DIR, { recursive: true });
const outPath = join(OUT_DIR, 'year-report.json');
writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), stat, report }, null, 1));
console.log(`\n=== 汇总 === ok=${stat.ok} autoFix(采纳iTunes)=${stat.autoFix} review(待判)=${stat.review} notfound=${stat.notfound} artistMiss=${stat.artistMiss}`);
console.log('报告: ' + outPath);
