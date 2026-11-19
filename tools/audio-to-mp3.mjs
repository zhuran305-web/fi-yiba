#!/usr/bin/env node
/*
 * 把已生成的 5 秒 AAC 片段批量转成 MP3。
 *
 * 为什么需要这一步：平台构建产物**不接受 .m4a 扩展名**（实测上传报「错误的文件路径」，
 * 换成 .mp3 同内容即可通过）。音频数据本身都是 5 秒片段，转码损失可忽略。
 *
 * 用法：node tools/audio-to-mp3.mjs [--src .audio-backup] [--out public/audio]
 */
import { readdir, mkdir, stat, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FFMPEG = require('ffmpeg-static');
const exec = promisify(execFile);

const argv = process.argv.slice(2);
const srcArg = argv.find(a => a.startsWith('--src='));
const outArg = argv.find(a => a.startsWith('--out='));
const SRC = join(ROOT, srcArg ? srcArg.split('=')[1] : '.audio-backup');
const OUT = join(ROOT, outArg ? outArg.split('=')[1] : 'public/audio');

if (!existsSync(SRC)) {
  console.error(`找不到源目录 ${SRC}`);
  process.exit(1);
}
await mkdir(OUT, { recursive: true });

const files = (await readdir(SRC)).filter(f => ['.m4a', '.aac'].includes(extname(f).toLowerCase()));
console.log(`[mp3] ${files.length} 个片段 → ${OUT}`);

let ok = 0, fail = 0, totalBytes = 0;
for (let i = 0; i < files.length; i++) {
  const src = join(SRC, files[i]);
  const dst = join(OUT, basename(files[i], extname(files[i])) + '.mp3');
  if (existsSync(dst)) { totalBytes += (await stat(dst)).size; ok++; continue; }
  try {
    await exec(FFMPEG, [
      '-y', '-v', 'error', '-i', src,
      '-c:a', 'libmp3lame', '-b:a', '64k', '-ac', '2', '-ar', '44100',
      dst,
    ], { maxBuffer: 8 * 1024 * 1024 });
    totalBytes += (await stat(dst)).size;
    ok++;
    if ((i + 1) % 40 === 0) console.log(`  ${i + 1}/${files.length}`);
  } catch (e) {
    fail++;
    console.error(`  ✗ ${files[i]}: ${String(e.message).slice(0, 80)}`);
  }
}

console.log(`[mp3] 完成：成功 ${ok} / 失败 ${fail}，合计 ${(totalBytes / 1024 / 1024).toFixed(1)}MB`);

// --write-map：同步把 js/audio-map.js 的扩展名改写成 .mp3
if (argv.includes('--write-map')) {
  const mapPath = join(ROOT, 'js', 'audio-map.js');
  const { readFile, writeFile } = await import('node:fs/promises');
  const before = await readFile(mapPath, 'utf8');
  const count = (before.match(/\.m4a/g) || []).length;
  const after = before.replace(/\.m4a/g, '.mp3');
  await writeFile(mapPath, after, 'utf8');
  console.log(`[mp3] 映射已改写：${count} 处 .m4a → .mp3`);
}
