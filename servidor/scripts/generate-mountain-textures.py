"""Texturas de montaña y vegetación de cima para Bahía Coral (Surf Salvaje).

Uso: python generate-mountain-textures.py <client/assets/images/environment>
Requiere numpy y Pillow.
  mountains/mountain-rock-jungle.webp  tileable en U: jungla en la base, roca facetada gris con musgo arriba.
  vegetation/cliff-canopy.png          copa de selva tropical con canal alfa para la cima de los acantilados.
"""
import sys, os, numpy as np
from PIL import Image, ImageFilter

OUT = sys.argv[1] if len(sys.argv) > 1 else 'client/assets/images/environment'
rng = np.random.default_rng(7)

def save(img, rel, **kw):
    p = os.path.join(OUT, rel); os.makedirs(os.path.dirname(p), exist_ok=True); img.save(p, **kw); print('ok', rel, img.size)

def value_noise(w, h, cx, cy, seed, wrap_x=True):
    r = np.random.default_rng(seed); g = r.random((cy + 1, cx + 1))
    if wrap_x: g[:, -1] = g[:, 0]
    ys, xs = np.mgrid[0:h, 0:w]; xs = xs / w * cx; ys = ys / h * cy
    x0, y0 = np.floor(xs).astype(int), np.floor(ys).astype(int)
    tx, ty = xs - x0, ys - y0; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty)
    x1, y1 = np.minimum(x0 + 1, cx), np.minimum(y0 + 1, cy)
    return (g[y0, x0] * (1 - tx) + g[y0, x1] * tx) * (1 - ty) + (g[y1, x0] * (1 - tx) + g[y1, x1] * tx) * ty

def fbm(w, h, cx, cy, seed, oct=4):
    s = 0; a = .5; t = 0
    for o in range(oct):
        s += value_noise(w, h, cx * 2 ** o, cy * 2 ** o, seed + o) * a; t += a; a *= .5
    return s / t

# ---------------------------------------------------------------- 1) Montaña
W, H = 1024, 1024
ys, xs = np.mgrid[0:H, 0:W]
v = ys / H                        # 0 = cima, 1 = base
# Voronoi tileable en X para las caras de roca (bloques algo más altos que anchos)
cells = 95
pts = np.column_stack([rng.random(cells) * W, rng.random(cells) * H])
nrm = rng.normal(size=(cells, 3)); nrm[:, 2] = np.abs(nrm[:, 2]) + 1.2; nrm /= np.linalg.norm(nrm, axis=1)[:, None]
best = np.full((H, W), 1e12); second = np.full((H, W), 1e12); idx = np.zeros((H, W), int)
for i, (px, py) in enumerate(pts):
    for off in (-W, 0, W):
        d = ((xs - px - off) * 1.0) ** 2 + ((ys - py) * 0.62) ** 2
        m = d < best
        second = np.where(m, best, np.minimum(second, d)); idx = np.where(m, i, idx); best = np.where(m, d, best)
edge = np.sqrt(second) - np.sqrt(best)
light = np.array([-0.55, -0.45, 0.70]); light /= np.linalg.norm(light)
shade = np.clip(nrm[idx] @ light, 0, 1)
detail = fbm(W, H, 16, 16, 11)
rockBase = np.array([150, 145, 138]) / 255
rockWarm = np.array([178, 166, 148]) / 255
tone = (rockBase * (1 - detail[..., None] * .6) + rockWarm * detail[..., None] * .6)
rock = tone * (0.55 + 0.65 * shade[..., None])
crack = np.clip(1 - edge / 2.6, 0, 1)[..., None]
rock = rock * (1 - crack * .38)
# estrías verticales suaves dentro de cada bloque
rock = rock * (0.92 + 0.12 * fbm(W, H, 48, 6, 13)[..., None])
# musgo/pasto en caras que miran hacia arriba (ny < 0 en imagen) y en repisas
up = np.clip(-nrm[idx][:, :, 1] * 1.6 + .15, 0, 1)
mossN = fbm(W, H, 8, 8, 21)
moss = np.clip(up * (mossN * 1.8 - .45), 0, 1) * np.clip(1.25 - v * 0.2, 0, 1)
mossCol = np.array([88, 150, 62]) / 255 * (0.7 + 0.5 * detail[..., None])
img = rock * (1 - moss[..., None]) + mossCol * moss[..., None]
# banda de selva en la base: copas redondeadas iluminadas desde arriba a la izquierda
r3 = np.random.default_rng(5)
base_band = np.clip((v - (canopyBase := 0.66 + 0.04 * np.sin(xs / W * 2 * np.pi * 5))) * 30, 0, 1)
img = img * (1 - base_band[..., None]) + (np.array([26, 84, 38]) / 255) * base_band[..., None]
jg = [np.array(c) / 255 for c in [(34, 104, 44), (52, 128, 50), (78, 152, 56), (108, 176, 66)]]
for layer, (n, y0, y1, rmin, rmax) in enumerate([(60, 600, 700, 34, 60), (70, 680, 800, 32, 56), (80, 780, 960, 30, 54), (60, 900, 1030, 30, 50)]):
    for k in range(n):
        cx, cy, r = r3.uniform(0, W), r3.uniform(y0, y1), r3.uniform(rmin, rmax)
        for off in (-W, 0, W):
            if abs(cx + off - W / 2) > W / 2 + r: continue
            lx, ly = (xs - cx - off) / r, (ys - cy) / r
            d = np.sqrt(lx ** 2 + (ly * 1.1) ** 2)
            m = d < 0.9 + 0.1 * np.sin(np.arctan2(ly, lx) * 8 + k)
            lit = np.clip(1 - np.sqrt((lx + .35) ** 2 + (ly + .45) ** 2) * .8, 0, 1)
            col = jg[(k + layer) % 4] * (0.6 + 0.5 * lit[..., None])
            img = np.where(m[..., None], col, img)
# vegetación que cuelga de las repisas superiores
tufts = np.clip((fbm(W, H, 30, 60, 51) - .66) * 6, 0, 1) * (v < .55) * up
img = img * (1 - tufts[..., None] * .8) + (np.array([70, 140, 55]) / 255) * tufts[..., None] * .8
save(Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8), 'RGB'), 'mountains/mountain-rock-jungle.webp', quality=88)

# ------------------------------------------------------------ 2) Copa de selva
CW, CH = 1024, 512
canvas = np.zeros((CH, CW, 4))
yy, xx = np.mgrid[0:CH, 0:CW]
greens = [np.array(c) / 255 for c in [(38, 112, 44), (58, 138, 50), (86, 162, 58), (122, 184, 70), (30, 92, 40)]]
def clump(cx, cy, r, col, hl):
    d = np.sqrt((xx - cx) ** 2 + ((yy - cy) * 1.1) ** 2)
    leafy = fbm(CW, CH, 60, 30, int(cx * 7 + cy)) if False else None
    m = d < r * (0.86 + 0.14 * np.sin(np.arctan2(yy - cy, xx - cx) * 9 + cx))
    lx, ly = (xx - cx) / r, (yy - cy) / r
    light = np.clip(1 - np.sqrt((lx + .35) ** 2 + (ly + .45) ** 2) * .85, 0, 1)
    c = col * (0.55 + 0.45 * light[..., None]) + hl * (light[..., None] ** 3) * .35
    a = m.astype(float)
    canvas[..., :3] = np.where(a[..., None] > 0, c, canvas[..., :3]); canvas[..., 3] = np.maximum(canvas[..., 3], a)
r2 = np.random.default_rng(99)
# capas de atrás hacia adelante: copas grandes arriba, arbustos abajo
# Silueta en domo irregular: alta en el centro, baja y estrecha hacia los lados.
def envelope(x):
    t = abs(x - CW / 2) / (CW / 2)
    return 150 + 230 * t ** 1.8 + 30 * np.sin(x * 0.021) + 20 * np.sin(x * 0.057)
for layer, (n, ymin, ymax, rmin, rmax) in enumerate([(30, 0, 120, 50, 88), (40, 60, 190, 42, 76), (46, 130, 260, 34, 60), (36, 200, 300, 28, 46)]):
    for k in range(n):
        cx = r2.uniform(40, CW - 40)
        top = envelope(cx)
        cy = top + r2.uniform(ymin, ymax) * (440 - top) / 300
        if cy > 450: continue
        shrink = 1 - 0.55 * (abs(cx - CW / 2) / (CW / 2)) ** 2
        clump(cx, cy, r2.uniform(rmin, rmax) * shrink, greens[(k + layer) % len(greens)] * (0.85 + .1 * layer), np.array([1, 1, .6]))
# palmeras que sobresalen
for k in range(4):
    px = 250 + k * 170 + r2.uniform(-30, 30); base = envelope(px) + 30; top = base - r2.uniform(70, 100)
    for t in np.linspace(0, 1, 60):
        x = px + np.sin(t * 1.4) * 10; y = base + (top - base) * t
        m = ((xx - x) ** 2 + (yy - y) ** 2) < 16
        canvas[m] = [.36, .25, .14, 1]
    for a in np.linspace(0, 2 * np.pi, 9, endpoint=False):
        for t in np.linspace(0, 1, 40):
            x = px + np.cos(a) * 62 * t; y = top + np.sin(a) * 22 * t + 30 * t * t
            m = ((xx - x) ** 2 + (yy - y) ** 2) < (7 * (1 - t) + 2) ** 2
            canvas[m] = [*(greens[2] * (0.8 + .3 * (1 - t))), 1]
# flores
for k in range(40):
    cx, cy = r2.uniform(20, CW - 20), r2.uniform(300, 460)
    if canvas[int(cy), int(cx), 3] > 0:
        m = ((xx - cx) ** 2 + (yy - cy) ** 2) < 30
        canvas[m] = [.95, .22, .30, 1] if k % 3 else [1, .82, .2, 1]
# hojas colgantes en el borde inferior y fundido suave
for k in range(26):
    cx = r2.uniform(0, CW); cy0 = r2.uniform(425, 455); ln = r2.uniform(14, 30)
    for t in np.linspace(0, 1, 20):
        y = cy0 + ln * t; m = ((xx - cx) ** 2 + (yy - y) ** 2) < (6 * (1 - t) + 1.5) ** 2
        canvas[m] = [*(greens[4] * 1.1), 1]
img = Image.fromarray((np.clip(canvas, 0, 1) * 255).astype(np.uint8), 'RGBA')
img = img.filter(ImageFilter.GaussianBlur(0.8))
save(img, 'vegetation/cliff-canopy.png', optimize=True)
