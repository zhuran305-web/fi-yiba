# Fi一把

> 八项属性猜歌 —— 小黑盒工坊小程序。猜出今日歌曲，每猜一次按 **歌手 / 地区 / 语言 / 流派 / 年份 / 热度 / 所属专辑 / 曲名字数** 八项给出绿（命中）/ 黄（近似）/ 黑（未中）+ 箭头反馈，20 次机会内猜中。

## 玩法模式

| 模式 | 说明 |
| --- | --- |
| 每日挑战 | 全服同一题，按日期确定性出题，一天一次 |
| 标准模式 | 可反复开局，记录连胜与平均步数 |
| 猜歌手 | 反过来猜歌手，判定口径改为性别 / 年代 ±2 / 曲量 ±1 |
| 简单模式 | 1996 年后的国民级热门歌（448 首） |
| 自定义范围 | 按年代 / 地区 / 语言 / 流派 / 热度取交集自选曲池 |
| 无限练习 | 全库随机，不计连胜 |

## 曲库

- **1593 首 / 647 位歌手**（含 86 首古典名曲）
- 公平池 765 首（热度 ≥4、年份已核实、八项齐全），简单池 448 首
- 元数据为纯文字（无歌词、无封面图）；音频为 533 首 5 秒片段

## 技术栈

- **Vite 8.3.8** + **`@heybox/hb-sdk` 0.9.8** + vanilla JS / 纯 DOM（无框架）
- 音频：`<audio>` 单例复用 + WebAudio 实时合成（双层谐波钢琴音色）
- 跨零点自动刷新、IME 回车保护、光效四档（高 / 中 / 低 / 关）

## 本地开发

```bash
npm install

# 构建（必须以 hb-sdk 构建，裸 vite build 无法验证产物完整性）
npx hb-sdk build

# 调试台（本地验证的唯一正确方式）
npx hb-sdk dev
# 打开 http://127.0.0.1:5174/?mini_url=http%3A%2F%2F127.0.0.1%3A5173%2F
```

> 直接访问 5173 会显示「请在小黑盒 APP 内打开」——这是 SDK 运行时门禁，不是故障。

## 音频素材

`public/audio/` 未纳入版本库（见 `.gitignore`）。片段取自 Apple iTunes 公开试听接口，经能量峰值选段裁为 5 秒 MP3。重新生成：

```bash
# 需要 HTTPS 代理；全量重建映射（勿用 --scope=classical 单独跑，会覆盖映射）
HTTPS_PROXY=http://127.0.0.1:7897 NODE_USE_ENV_PROXY=1 node tools/build-audio.mjs --scope=all
```

素材仅用于歌曲辨识提示，非商业用途；权利人有异议将即时下架对应片段。

## 常见工具

| 命令 | 用途 |
| --- | --- |
| `node tools/report-bank.mjs` | 曲库分类报告（地区/语言/流派/年代/热度/池子） |
| `node tools/check-searchable.mjs` | 可搜性审计（每曲须有中文或拉丁入口） |
| `node tools/check-classical.mjs` | 古典曲目一致性与池子隔离校验 |
| `node tools/build-audio.mjs --scope=all` | 音频片段补齐 |
| `npx hb-sdk remote versions` | 查看线上版本状态 |

## 发版

```bash
# 1. 升 package.json#version（版本号上传后不可复用）
# 2. 确认无审核中版本（平台单待审位）
npx hb-sdk remote versions
# 3. 提审（内部会重新构建再上传，耗时 1–2 分钟）
npx hb-sdk remote deploy --release-note "…"
```

审核通过后自动发布。变更记录见 [CHANGELOG.md](CHANGELOG.md)。