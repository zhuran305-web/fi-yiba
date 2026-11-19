"""把 data/albums.json 转成 JS 模块（避开 Vite 8 的 JSON import 静默失败问题）。

用法（必须在项目根目录执行）: python tools/json-to-module.py
"""
import json
import sys
from pathlib import Path

SRC = Path("data/albums.json")
DST = Path("js/albums-data.js")

if not SRC.is_file():
    sys.exit("请在项目根目录执行本脚本（找不到 data/albums.json）")

data = json.loads(SRC.read_text(encoding="utf-8"))

lines = [
    "  " + json.dumps(k, ensure_ascii=False) + ": " + json.dumps(v, ensure_ascii=False)
    for k, v in data.items()
]

out = (
    "/* 专辑数据：由 tools/fetch-albums.mjs 从 iTunes 多区抓取生成。\n"
    "   以 JS 模块形式提供——Vite 8/rolldown 下 import JSON 会导致构建静默不产出文件。 */\n"
    "export default {\n" + ",\n".join(lines) + "\n};\n"
)

DST.write_text(out, encoding="utf-8")
print(f"已生成 {DST}，条目 {len(data)} 条")
