"""Genera las texturas procedurales del entorno de Surf Salvaje (Bahia Coral).

Uso:  python generate-environment-textures.py <ruta a client/assets/images/environment>
Requiere numpy y Pillow. Todas las texturas que se repiten son tileables.
"""
import sys, os, numpy as np
from PIL import Image, ImageFilter

OUT = sys.argv[1] if len(sys.argv) > 1 else 'client/assets/images/environment'
rng = np.random.default_rng(20260926)

def save(img, rel, **kw):
    path = os.path.join(OUT, rel); os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, **kw); print('ok', rel, img.size)

def voronoi_f1f2(n, cells, seed):
    """F2-F1 tileable de un campo de Voronoi (bordes finos = cáusticas)."""
    r = np.random.default_rng(seed)
    pts = r.random((cells, cells, 2))
    ys, xs = np.mgrid[0:n, 0:n] / n * cells
    gx, gy = np.floor(xs).astype(int), np.floor(ys).astype(int)
    f1 = np.full((n, n), 9.0); f2 = np.full((n, n), 9.0)
    for oy in (-1, 0, 1):
        for ox in (-1, 0, 1):
            cx, cy = gx + ox, gy + oy
            p = pts[cy % cells, cx % cells]
            d = (cx + p[..., 0] - xs) ** 2 + (cy + p[..., 1] - ys) ** 2
            f2 = np.where(d < f1, f1, np.minimum(f2, d)); f1 = np.minimum(f1, d)
    return np.sqrt(f2) - np.sqrt(f1)

def value_noise(n, cells, seed):
    r = np.random.default_rng(seed); g = r.random((cells, cells))
    ys, xs = np.mgrid[0:n, 0:n] / n * cells
    x0, y0 = np.floor(xs).astype(int), np.floor(ys).astype(int)
    tx, ty = xs - x0, ys - y0; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty)
    a = g[y0 % cells, x0 % cells]; b = g[y0 % cells, (x0 + 1) % cells]
    c = g[(y0 + 1) % cells, x0 % cells]; d = g[(y0 + 1) % cells, (x0 + 1) % cells]
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty

def fbm(n, base, seed, octaves=4):
    s = 0; amp = .5; tot = 0
    for o in range(octaves):
        s += value_noise(n, base * 2 ** o, seed + o) * amp; tot += amp; amp *= .5
    return s / tot

N = 512
# 1) Cáusticas: dos redes de Voronoi en R y G (el shader las cruza con desfase).
c1 = voronoi_f1f2(N, 7, 11); c2 = voronoi_f1f2(N, 9, 23)
line = lambda e, w: np.clip(1 - e / w, 0, 1) ** 1.6
r_ch = line(c1, .09); g_ch = line(c2, .08)
b_ch = fbm(N, 4, 5)
save(Image.fromarray((np.dstack([r_ch, g_ch, b_ch]) * 255).astype(np.uint8), 'RGB'), 'water/caustics.webp', quality=92)

# 2) Encaje de espuma tileable (R = espuma, A = espuma).
lace = line(voronoi_f1f2(N, 10, 31), .16) * np.clip(fbm(N, 4, 41) * 1.8 - .45, 0, 1)
blob = np.clip(fbm(N, 6, 51) * 2.2 - 1.0, 0, 1)
foam = np.clip(lace * .9 + blob * .75, 0, 1)
save(Image.fromarray(np.dstack([np.full((N, N), 255), np.full((N, N), 255), np.full((N, N), 255), foam * 255]).astype(np.uint8), 'RGBA'), 'water/foam-lace.webp', quality=90)

# 3) Parche de espuma de estela: encaje dentro de una mancha suave.
S = 256
ys, xs = np.mgrid[0:S, 0:S] / S * 2 - 1
radial = np.clip(1 - np.sqrt(xs ** 2 + (ys * 1.15) ** 2), 0, 1)
w_lace = line(voronoi_f1f2(S, 6, 61), .22)
w_noise = fbm(S, 4, 71)
wake = np.clip((w_lace * .85 + np.clip(w_noise * 1.8 - .5, 0, 1) * .6) * radial ** .6 * 1.25, 0, 1)
save(Image.fromarray(np.dstack([np.full((S, S), 255), np.full((S, S), 255), np.full((S, S), 255), wake * 255]).astype(np.uint8), 'RGBA'), 'particles/wake-foam.webp', quality=90)

# 4) Gota de salpicadura (partícula): núcleo brillante con borde azulado.
D = 64
ys, xs = np.mgrid[0:D, 0:D] / D * 2 - 1
rr = np.sqrt(xs ** 2 + ys ** 2)
alpha = np.clip(1 - rr, 0, 1) ** 1.3
core = np.clip(1 - rr * 1.7, 0, 1)
rgb = np.dstack([225 + 30 * core, 245 + 10 * core, np.full((D, D), 255)])
save(Image.fromarray(np.dstack([rgb, alpha * 255]).astype(np.uint8), 'RGBA'), 'particles/splash-droplet.png')

# 5) Flujo de cascada (tileable en V): vetas verticales blanco/azul.
W, H = 256, 512
cols = value_noise(W, 24, 81)[0]  # perfil horizontal
xs_ = np.linspace(0, 1, W)
streak = np.tile((value_noise(W, 32, 91)[:1] * .6 + value_noise(W, 64, 92)[:1] * .4), (H, 1))
vflow = fbm(H, 3, 101)[:, :1]
tone = np.clip(streak * 1.1 + np.tile(fbm(512, 8, 111)[:, :W], (1, 1))[:H] * .35, 0, 1)
edge = np.clip(np.sin(np.pi * xs_) * 1.6, 0, 1)[None, :]
a = np.clip((.55 + .45 * tone) * edge, 0, 1)
rgbw = np.dstack([180 + 75 * tone, 225 + 30 * tone, np.full((H, W), 255)])
save(Image.fromarray(np.dstack([rgbw, a * 255]).astype(np.uint8), 'RGBA'), 'waterfalls/waterfall-flow.webp', quality=90)

# 6) Lámina de espuma de proa (tileable en V, cae hacia el borde exterior en U).
BW, BH = 128, 256
lace_b = line(voronoi_f1f2(BH, 8, 151), .20)[:, :BW]  # tileable vertical
lace_b = np.vstack([lace_b[:BH]])
noise_b = fbm(BH, 6, 161)[:, :BW]
u = np.linspace(0, 1, BW)[None, :]
inner = np.clip(1 - u * 1.25, 0, 1) ** 1.4           # denso junto a la tabla
body = np.clip(lace_b * .95 + np.clip(noise_b * 1.9 - .55, 0, 1) * .7, 0, 1)
bow = np.clip(body * inner * 1.35 + np.clip(1 - u * 5, 0, 1) * .55, 0, 1)
save(Image.fromarray(np.dstack([np.full((BH, BW), 255), np.full((BH, BW), 255), np.full((BH, BW), 255), bow * 255]).astype(np.uint8), 'RGBA'), 'particles/bow-foam.webp', quality=90)
