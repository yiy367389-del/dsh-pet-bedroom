"""生成椅子前景遮挡贴图 assets/chair.png。

思路：**不画假椅子**，而是把 room.png 里椅子那一块原样抠出来，裁成小图，
叠在桌宠上面。因为取自同一张图、同一个坐标系，位置对上了就是像素级无缝，
看起来就是「椅子挡住了她后背」。

输出：
  assets/chair.png       裁好的 RGBA 小图
  控制台打印            它在舞台上的 left/top/width/height 百分比（写进 CSS）
"""
from PIL import Image, ImageDraw
from pathlib import Path
import numpy as np
from scipy import ndimage

ROOT = str(Path(__file__).resolve().parent)
src = Image.open(ROOT + r"\assets\room.png").convert("RGB")
W, H = src.size
full = np.asarray(src).astype(np.float32)

# 椅子外框（百分比）：收得比视觉轮廓略紧，宁可少盖也不要带进书架/键盘
POLY = [
    (71.6, 43.6), (76.6, 43.2), (77.4, 45.4), (77.6, 47.4),
    (76.6, 48.8), (78.0, 50.2), (78.8, 52.8), (79.2, 56.4),
    (79.1, 59.4), (78.6, 62.2), (78.2, 65.0), (77.6, 66.6),
    (71.8, 66.8), (71.2, 64.2), (70.9, 60.6), (70.8, 56.0),
    (70.9, 50.6), (71.1, 46.6),
]
poly = Image.new("L", (W, H), 0)
ImageDraw.Draw(poly).polygon([(x / 100 * W, y / 100 * H) for x, y in POLY], fill=255)
polyMask = np.asarray(poly) > 0

lum = 0.299 * full[:, :, 0] + 0.587 * full[:, :, 1] + 0.114 * full[:, :, 2]
mx, mn = full.max(axis=2), full.min(axis=2)
sat = (mx - mn) / np.maximum(mx, 1.0)

white = (lum > 118) & (sat < 0.28) & polyMask
lbl, n = ndimage.label(white, structure=np.ones((3, 3)))
sizes = ndimage.sum(white, lbl, range(1, n + 1))
keep = lbl == (int(np.argmax(sizes)) + 1)
keep = ndimage.binary_closing(keep, structure=np.ones((11, 11)))
keep = ndimage.binary_fill_holes(keep) & polyMask


def longest_run_per_row(m):
    """每行只留最长的一段连续像素：键盘/显示器支架/书架碎片都在右侧且更短。"""
    out = np.zeros_like(m)
    for y in range(m.shape[0]):
        row = m[y]
        if not row.any():
            continue
        idx = np.flatnonzero(row)
        splits = np.where(np.diff(idx) > 1)[0]
        starts = np.concatenate(([0], splits + 1))
        ends = np.concatenate((splits, [len(idx) - 1]))
        best = max(range(len(starts)), key=lambda i: idx[ends[i]] - idx[starts[i]])
        out[y, idx[starts[best]]:idx[ends[best]] + 1] = True
    return out


keep = longest_run_per_row(keep)
keep = ndimage.binary_closing(keep, structure=np.ones((5, 5)))
keep = ndimage.binary_fill_holes(keep)

rows = np.where(keep.any(axis=1))[0]
cols = np.where(keep.any(axis=0))[0]
y0, y1 = int(rows.min()), int(rows.max()) + 1
x0, x1 = int(cols.min()), int(cols.max()) + 1
print(f"mask bbox px: x {x0}..{x1}  y {y0}..{y1}")

alpha = ndimage.gaussian_filter(keep.astype(np.float32), 1.3)
alpha = np.clip((alpha - 0.32) / 0.36, 0, 1)

# 裁出来（带 1px 余量，防止羽化被切）
px0, py0 = max(0, x0 - 1), max(0, y0 - 1)
px1, py1 = min(W, x1 + 1), min(H, y1 + 1)

crop = np.zeros((py1 - py0, px1 - px0, 4), dtype=np.uint8)
crop[:, :, :3] = np.asarray(src)[py0:py1, px0:px1]
crop[:, :, 3] = (alpha[py0:py1, px0:px1] * 255).astype(np.uint8)
Image.fromarray(crop, "RGBA").save(ROOT + r"\assets\chair.png", optimize=True)

print(f"chair.png = {px1-px0}x{py1-py0}")
print("\n=== 写进 CSS 的百分比（相对舞台） ===")
print(f"left  : {px0 / W * 100:.3f}%")
print(f"top   : {py0 / H * 100:.3f}%")
print(f"width : {(px1 - px0) / W * 100:.3f}%")
print(f"height: {(py1 - py0) / H * 100:.3f}%")

prev = full[py0:py1, px0:px1]
ch = np.zeros_like(prev)
yy, xx = np.mgrid[0:py1 - py0, 0:px1 - px0]
chk = ((yy // 14) + (xx // 14)) % 2 == 0
ch[chk] = 45
ch[~chk] = 100
a = alpha[py0:py1, px0:px1, None]
Image.fromarray((prev * a + ch * (1 - a)).astype(np.uint8), "RGB").save(ROOT + r"\_chair-mask.png")
print("\npreview saved")
