"""
Fi一把 · 小程序封面（510×272）
左侧：Fi 一把 大字标（蓝白渐变）+ 一句定位语
右侧：八格判定面板的抽象示意（这是玩法本体，也是最强的识别符号）
"""
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import math, os

S = 3
W, H = 510 * S, 272 * S
OUT = "assets/cover.png"

def lerp(a, b, t): return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))

# ---------- 背景：深空 + 靛蓝天光 + 极光 ----------
img = Image.new("RGB", (W, H), (6, 6, 13))
px = img.load()
top, mid, bot = (30, 24, 66), (13, 12, 28), (5, 5, 11)
for y in range(H):
    t = y / (H - 1)
    c = lerp(top, mid, t / 0.55) if t < 0.55 else lerp(mid, bot, (t - 0.55) / 0.45)
    for x in range(W):
        d = math.hypot(x - W * 0.16, y - H * 0.12) / H
        boost = max(0.0, 1.0 - d * 2.0) ** 2 * 0.40
        d2 = math.hypot(x - W * 0.88, y - H * 0.92) / H
        boost2 = max(0.0, 1.0 - d2 * 2.2) ** 2 * 0.30
        px[x, y] = (
            min(255, int(c[0] + 52 * boost + 6 * boost2)),
            min(255, int(c[1] + 38 * boost + 42 * boost2)),
            min(255, int(c[2] + 106 * boost + 66 * boost2)),
        )

glow = Image.new("RGB", (W, H), (0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse([round(-W*0.18), round(-H*0.30), round(W*0.55), round(H*1.05)], fill=(44, 28, 118))
gd.ellipse([round(W*0.60), round(H*0.55), round(W*1.25), round(H*1.85)], fill=(8, 54, 88))
glow = glow.filter(ImageFilter.GaussianBlur(W * 0.055))
img = Image.blend(img, Image.blend(img, glow, 0.62), 0.55)

# ---------- 右侧：八格判定面板示意 ----------
PANEL = Image.new("RGBA", (W, H), (0, 0, 0, 0))
pd = ImageDraw.Draw(PANEL)
CELL_W, CELL_H, GAP = W * 0.052, H * 0.098, W * 0.0105
COLS, ROWS = 4, 2
grid_w = COLS * CELL_W + (COLS - 1) * GAP
grid_h = ROWS * CELL_H + (ROWS - 1) * GAP
gx = W * 0.925 - grid_w
gy = H * 0.5 - grid_h / 2 + H * 0.02

# 色块：绿/绿/黄/黑 · 绿/黄/黑/绿（示意判定反馈）
COLORS = [
    (52, 211, 153), (52, 211, 153), (251, 191, 36), (255, 255, 255),
    (52, 211, 153), (251, 191, 36), (255, 255, 255), (52, 211, 153),
]
ALPHAS = [232, 232, 224, 34, 232, 224, 34, 232]
for i, (c, a) in enumerate(zip(COLORS, ALPHAS)):
    r, col = divmod(i, COLS)
    x0 = gx + col * (CELL_W + GAP)
    y0 = gy + r * (CELL_H + GAP)
    pd.rounded_rectangle([round(x0), round(y0), round(x0 + CELL_W), round(y0 + CELL_H)],
                         radius=round(CELL_W * 0.17), fill=c + (a,))

# 面板外发光
halo = PANEL.filter(ImageFilter.GaussianBlur(W * 0.012))
img = img.convert("RGBA")
img = Image.alpha_composite(img, Image.eval(halo, lambda v: int(v * 0.85)))
img = Image.alpha_composite(img, PANEL)

# ---------- 左侧文字 ----------
TXT = Image.new("RGBA", (W, H), (0, 0, 0, 0))
td = ImageDraw.Draw(TXT)

def load_font(size, bold=True):
    """按优先级找系统中文字体"""
    cands = [
        "C:/Windows/Fonts/msyhbd.ttc" if bold else "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/sourcehansanssc_bold.otf",
        "C:/Windows/Fonts/HarmonyOS_Sans_SC_Bold.ttf",
        "C:/Windows/Fonts/simhei.ttf",
    ]
    for p in cands:
        if os.path.exists(p):
            try: return ImageFont.truetype(p, size)
            except Exception: pass
    return ImageFont.load_default()

f_fi   = load_font(round(H * 0.40))
f_yiba = load_font(round(H * 0.215))
f_sub  = load_font(round(H * 0.058), bold=False)
f_note = load_font(round(H * 0.14))

X0 = W * 0.062
FI_TOP = H * 0.235
# "Fi" 大字标（蓝色垂直渐变：上青下深蓝）
fi_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
fid = ImageDraw.Draw(fi_layer)
fid.text((round(X0), round(FI_TOP)), "Fi", font=f_fi, fill=(255, 255, 255, 255))
grad = Image.new("RGB", (W, H))
gpx = grad.load()
for y in range(H):
    t = y / (H - 1)
    c = lerp((122, 222, 255), (18, 88, 232), min(1.0, max(0.0, (t - 0.16) * 1.9)))
    for x in range(W):
        gpx[x, y] = tuple(int(round(v)) for v in c)
fi_colored = Image.composite(grad.convert("RGBA"), Image.new("RGBA", (W, H), (0, 0, 0, 0)),
                             fi_layer.split()[3])
TXT = Image.alpha_composite(TXT, fi_colored)
td = ImageDraw.Draw(TXT)

# "一把"：与 Fi 视觉重心对齐（用 bbox 底部对齐）
fi_bbox = fid.textbbox((round(X0), round(FI_TOP)), "Fi", font=f_fi)
yiba_x = fi_bbox[2] + W * 0.014
yiba_bbox_h = td.textbbox((0, 0), "一把", font=f_yiba)[3]
yiba_y = fi_bbox[3] - yiba_bbox_h - H * 0.012
td.text((round(yiba_x), round(yiba_y)), "一把", font=f_yiba, fill=(255, 255, 255, 246))

# 定位语（底部留足安全边距）
td.text((round(X0 + W * 0.004), round(H * 0.815)),
        "听歌人的每日一词 · 八项属性猜歌", font=f_sub, fill=(196, 205, 226, 196))

# 文字辉光
t_halo = TXT.filter(ImageFilter.GaussianBlur(W * 0.008))
img = Image.alpha_composite(img, Image.eval(t_halo, lambda v: int(v * 0.55)))
img = Image.alpha_composite(img, TXT)

# ---------- 收尾 ----------
img = img.convert("RGB").resize((510, 272), Image.LANCZOS)
img.save(OUT, "PNG", optimize=True)
print(OUT, img.size)
