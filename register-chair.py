"""把用户新给的椅子图 (357x637) 配准到 room.png 上，算出它在舞台上的百分比。

不能直接按老 chair.png 的坐标套——两张图裁切范围不完全一样（宽高比 0.5604 vs 0.5670）。
做法：从 room.png 里用老逻辑算出椅子掩膜，再把新图的 alpha 缩放+平移去和它求最大 IoU，
用 FFT 做互相关搜索，快且准。
"""
from PIL import Image
from pathlib import Path
import numpy as np
from scipy import ndimage, signal

ROOT = str(Path(__file__).resolve().parent)
room = Image.open(ROOT + r"\assets\room.png").convert("RGB")
W, H = room.size
full = np.asarray(room).astype(np.float32)

new = Image.open(ROOT + r"\_new-chair.png").convert("RGBA")
NW, NH = new.size
na = np.asarray(new)[:, :, 3]
print(f"room {W}x{H}   new chair {NW}x{NH}")

# ---- 1. 从 room.png 复现椅子掩膜（和老 make-chair.py 同一套逻辑）----
POLY = [
    (71.6, 43.6), (76.6, 43.2), (77.4, 45.4), (77.6, 47.4),
    (76.6, 48.8), (78.0, 50.2), (78.8, 52.8), (79.2, 56.4),
    (79.1, 59.4), (78.6, 62.2), (78.2, 65.0), (77.6, 66.6),
    (71.8, 66.8), (71.2, 64.2), (70.9, 60.6), (70.8, 56.0),
    (70.9, 50.6), (71.1, 46.6),
]
from PIL import ImageDraw
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
roomMask = keep
print("room chair mask px =", int(roomMask.sum()))

# ---- 2. 搜索缩放，用 FFT 互相关找最佳偏移 ----
newMaskFull = na > 128
best = None
for s in np.arange(0.30, 0.46, 0.005):
    w2, h2 = int(round(NW * s)), int(round(NH * s))
    if w2 < 40 or h2 < 60 or w2 >= W or h2 >= H:
        continue
    small = np.asarray(
        Image.fromarray((newMaskFull * 255).astype(np.uint8)).resize((w2, h2), Image.BILINEAR)
    ) > 128
    # 互相关：找 roomMask 里与该模板重叠最大的位置
    corr = signal.fftconvolve(roomMask.astype(np.float32), small[::-1, ::-1].astype(np.float32), mode="same")
    idx = np.unravel_index(np.argmax(corr), corr.shape)
    # corr 峰值位置对应模板中心
    oy = idx[0] - h2 // 2
    ox = idx[1] - w2 // 2
    # 计算真实 IoU
    canvas = np.zeros((H, W), bool)
    y0, y1 = max(0, oy), min(H, oy + h2)
    x0, x1 = max(0, ox), min(W, ox + w2)
    if y1 <= y0 or x1 <= x0:
        continue
    canvas[y0:y1, x0:x1] = small[y0 - oy:y1 - oy, x0 - ox:x1 - ox]
    inter = (canvas & roomMask).sum()
    union = (canvas | roomMask).sum()
    iou = inter / union if union else 0
    if best is None or iou > best["iou"]:
        best = {"s": s, "ox": ox, "oy": oy, "w": w2, "h": h2, "iou": iou}

print("best:", {k: (round(v, 4) if isinstance(v, float) else v) for k, v in best.items()})

ox, oy, w2, h2 = best["ox"], best["oy"], best["w"], best["h"]
print(f"\n=== 写进 CSS 的百分比（相对舞台 1536x1024）===")
print(f"left  : {ox / W * 100:.3f}%")
print(f"top   : {oy / H * 100:.3f}%")
print(f"width : {w2 / W * 100:.3f}%")
print(f"height: {h2 / H * 100:.3f}%")
print(f"IoU   : {best['iou']:.3f}")

# ---- 3. 生成最终 assets/chair.png（保持新图原始分辨率，靠 CSS 缩放）----
# 只保留 alpha，RGB 用新图自己的（用户要的就是这张）
out = np.asarray(new).copy()
Image.fromarray(out, "RGBA").save(ROOT + r"\assets\chair.png", optimize=True)
print("\nchair.png 已替换为新图", (NW, NH))

# ---- 4. 拼一张对齐预览，人工确认无缝 ----
canvas = full.copy()
crop = np.asarray(new)[:, :, :3].astype(np.float32)
ca = (na.astype(np.float32) / 255.0)[..., None]
region = canvas[oy:oy + h2, ox:ox + w2]
resized = np.asarray(Image.fromarray(crop.astype(np.uint8)).resize((w2, h2), Image.LANCZOS)).astype(np.float32)
ra = np.asarray(Image.fromarray((ca[..., 0] * 255).astype(np.uint8)).resize((w2, h2), Image.LANCZOS)).astype(np.float32)[..., None] / 255.0
canvas[oy:oy + h2, ox:ox + w2] = region * (1 - ra) + resized * ra
Image.fromarray(canvas.astype(np.uint8), "RGB").crop(
    (int(0.63 * W), int(0.36 * H), int(0.86 * W), int(0.73 * H))
).resize((int(0.23 * W * 1.6), int(0.37 * H * 1.6)), Image.LANCZOS).save(ROOT + r"\_chair-stitch.png")
print("拼合预览已存 _chair-stitch.png")
