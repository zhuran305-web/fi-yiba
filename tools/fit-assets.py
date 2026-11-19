"""
把豆包生成的图改造成平台规格
  图标：2048×2048 → 200×200（裁掉右下角"豆包AI生成"水印区）
  封面：2048×1152 → 510×272（按目标比例裁切，去掉水印）
"""
from PIL import Image

SRC_ICON = "assets/小程序图标设计方案.png"
SRC_COVER = "assets/小程序封面设计方案.png"

# ---------------- 图标：200×200 ----------------
im = Image.open(SRC_ICON).convert("RGB")
W, H = im.size

# 水印在右下角。裁掉底部约 6%，并从右侧裁 6%（保持正方形，主体不受影响）
cut = int(W * 0.055)
icon = im.crop((0, 0, W - cut, H - cut))
icon = icon.resize((200, 200), Image.LANCZOS)
icon.save("assets/icon.png", "PNG", optimize=True)
print(f"icon.png  {icon.size}")

# ---------------- 封面：510×272 ----------------
im2 = Image.open(SRC_COVER).convert("RGB")
W2, H2 = im2.size
TARGET_W, TARGET_H = 510, 272
target_ratio = TARGET_W / TARGET_H          # 1.875

# 先按目标比例从 16:9 里裁出"更宽扁"的区域：裁掉上下，保留中间
cur_ratio = W2 / H2
if cur_ratio > target_ratio:
    new_w = int(H2 * target_ratio)
    x0 = (W2 - new_w) // 2
    box = (x0, 0, x0 + new_w, H2)
else:
    new_h = int(W2 / target_ratio)
    # 主体偏上（标题在中上部）→ 裁切时向上偏移，保住标题
    y0 = int((H2 - new_h) * 0.35)
    box = (0, y0, W2, y0 + new_h)

cover = im2.crop(box)

# 水印在右下角：裁完后若仍在，从右下再收一点（用轻微放大平移规避）
cw, ch = cover.size
# 把画面整体微放大 4% 并向右上偏移，把右下角水印挤出画面
zoom = 1.045
nw, nh = int(cw / zoom), int(ch / zoom)
ox = int((cw - nw) * 0.80)      # 偏右取样 → 右边缘内容向右移出
oy = int((ch - nh) * 0.20)      # 偏上取样 → 底部内容向下移出
cover = cover.crop((ox, oy, ox + nw, oy + nh))

cover = cover.resize((TARGET_W, TARGET_H), Image.LANCZOS)
cover.save("assets/cover.png", "PNG", optimize=True)
print(f"cover.png {cover.size}  裁切框={box}")
