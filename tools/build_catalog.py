#!/usr/bin/env python3
"""Vyro-Car catalog builder.

Turns a list of wheel products (catalog/products.json) into everything the studio needs:

  see-it-on-your-car/wheel-models/<id>.webp   normalised, front-facing wheel texture with transparent gaps
  see-it-on-your-car/catalog.json             product data + 3D model parameters + quality flags

Per wheel it: loads the product photo (local path or URL), removes a plain background if the photo has
no transparency, finds the wheel face, rectifies it to a centred circle, estimates spoke count and
symmetry, derives 3D parameters from the finish/name, and flags anything a person should look at.

Usage:  python3 tools/build_catalog.py [--only id,id] [--src catalog/products.json]
Needs:  pip install numpy pillow
"""
import argparse, io, json, math, os, re, sys, urllib.request
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, 'see-it-on-your-car')
OUT = 512

def load_image(src):
    if re.match(r'https?://', src):
        req = urllib.request.Request(src, headers={'User-Agent': 'vyro-catalog/1.0'})
        return Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=60).read())).convert('RGBA')
    return Image.open(src if os.path.isabs(src) else os.path.join(ROOT, src)).convert('RGBA')

def key_background(im, tol=26):
    """Photos without transparency: make the plain background (and gaps showing it) transparent."""
    a = np.asarray(im).astype(np.int16); h, w = a.shape[:2]
    if (a[..., 3] < 250).mean() > .02: return im, False          # already cut out
    border = np.concatenate([a[0, :, :3], a[-1, :, :3], a[:, 0, :3], a[:, -1, :3]])
    bg = np.median(border, axis=0)
    if np.abs(border - bg).max(axis=1).mean() > tol: return im, False   # busy background: cannot key
    dist = np.abs(a[..., :3] - bg).max(axis=2)
    alpha = np.clip((dist - tol * .5) / (tol * .5), 0, 1)
    out = a.copy(); out[..., 3] = (alpha * 255).astype(np.int16)
    return Image.fromarray(out.astype(np.uint8), 'RGBA'), True

def silhouette_points(alpha, n=360):
    """Outer contour: for each direction from the centroid, the farthest opaque pixel."""
    h, w = alpha.shape; ys, xs = np.nonzero(alpha > 128)
    if len(xs) < 50: return None
    cx, cy = xs.mean(), ys.mean(); pts = []
    rmax = math.hypot(w, h)
    for k in range(n):
        t = 2 * math.pi * k / n; dx, dy = math.cos(t), math.sin(t)
        r = np.arange(0, rmax, 1.0); x = (cx + r * dx).astype(int); y = (cy + r * dy).astype(int)
        ok = (x >= 0) & (x < w) & (y >= 0) & (y < h); x, y, r = x[ok], y[ok], r[ok]
        hit = np.nonzero(alpha[y, x] > 128)[0]
        if len(hit): pts.append((x[hit[-1]], y[hit[-1]]))
    return np.array(pts, float)

def fit_ellipse(pts):
    """Axis-aligned ellipse through points: A x^2 + B y^2 + C x + D y = 1."""
    ox, oy = pts[:, 0].mean(), pts[:, 1].mean()        # centre the data so the conic stays well conditioned
    x, y = pts[:, 0] - ox, pts[:, 1] - oy
    M = np.stack([x * x, y * y, x, y], 1)
    try: A, B, C, D = np.linalg.lstsq(M, np.ones(len(x)), rcond=None)[0]
    except np.linalg.LinAlgError: return None
    if A <= 0 or B <= 0: return None
    cx, cy = -C / (2 * A), -D / (2 * B); k = 1 + A * cx * cx + B * cy * cy
    if k <= 0: return None
    return cx + ox, cy + oy, math.sqrt(k / A), math.sqrt(k / B)

def ransac_ellipse(pts, iters=400, tol=.018, seed=7):
    rng = np.random.default_rng(seed); best, best_in = None, -1
    for _ in range(iters):
        e = fit_ellipse(pts[rng.choice(len(pts), 5, replace=False)])
        if not e: continue
        cx, cy, rx, ry = e
        if not (.4 < rx / ry < 1.3): continue
        d = np.abs(np.hypot((pts[:, 0] - cx) / rx, (pts[:, 1] - cy) / ry) - 1)
        n = int((d < tol).sum())
        if n > best_in: best_in, best = n, e
    if not best: return None, 0
    cx, cy, rx, ry = best
    d = np.abs(np.hypot((pts[:, 0] - cx) / rx, (pts[:, 1] - cy) / ry) - 1)
    e = fit_ellipse(pts[d < tol * 1.5]) or best
    return e, best_in / len(pts)

def rectify(im, e):
    cx, cy, rx, ry = e
    # output pixel (u,v) -> source (cx + (2u/OUT-1) rx, cy + (2v/OUT-1) ry)
    out = im.transform((OUT, OUT), Image.AFFINE, (2 * rx / OUT, 0, cx - rx, 0, 2 * ry / OUT, cy - ry), resample=Image.BICUBIC)
    a = np.asarray(out).copy(); yy, xx = np.mgrid[0:OUT, 0:OUT]
    r = np.hypot((xx + .5) / OUT * 2 - 1, (yy + .5) / OUT * 2 - 1)
    a[..., 3] = (a[..., 3] * np.clip((1.0 - r) / .008, 0, 1)).astype(np.uint8)
    return Image.fromarray(a, 'RGBA')

def analyse(tex):
    a = np.asarray(tex)[..., 3] > 128; yy, xx = np.mgrid[0:OUT, 0:OUT]
    x = (xx + .5) / OUT * 2 - 1; y = (yy + .5) / OUT * 2 - 1; r = np.hypot(x, y); th = np.arctan2(y, x)
    disc = r < .9; cov = float(a[disc].mean())
    # angular profile of the spoke band -> spoke count via FFT
    band = (r > .35) & (r < .8); bins = ((th[band] + math.pi) / (2 * math.pi) * 360).astype(int) % 360
    prof = np.bincount(bins, weights=a[band].astype(float), minlength=360) / np.maximum(1, np.bincount(bins, minlength=360))
    f = np.abs(np.fft.rfft(prof - prof.mean())); k = int(np.argmax(f[3:40]) + 3)
    strength = float(f[k] / (f[1:60].sum() + 1e-6))
    return {'coverage': round(cov, 3), 'spokes': k, 'symmetry': round(strength, 3)}

FINISH = [(r'chrome|polish|mirror', 'chrome'), (r'machin|milled|diamond|brushed', 'machined'), (r'matte|satin|asphalt|textured', 'matte'), (r'gloss', 'gloss')]

def model_params(p, q):
    text = (p.get('name', '') + ' ' + p.get('finish', '')).lower(); m = {}
    if re.search(r'deep|concave|forged', text): m['concavity'] = .15
    if re.search(r'steel|hd |overland|heavy duty', text): m['concavity'] = .05; m['spokeDepth'] = .05
    spec = re.search(r'(\d{2})\s*x\s*(\d+(?:\.\d+)?)', p.get('spec', ''))
    if spec:  # barrel depth from the real width: (width / diameter) * 2, in rim radii
        m['width'] = round(min(1.1, max(.55, float(spec.group(2)) / float(spec.group(1)) * 2)), 2)
    m.update(p.get('model3d') or {}); return m

def process(p):
    im = load_image(p['image']); src_size = im.size
    im, keyed = key_background(im)
    alpha = np.asarray(im)[..., 3]; flags = []
    if p.get('face_ellipse'): e, inl = tuple(p['face_ellipse']), 1.0
    else:
        pts = silhouette_points(alpha)
        if pts is None: raise ValueError('no wheel found in image')
        e, inl = ransac_ellipse(pts)
        if not e: raise ValueError('could not fit the wheel outline')
    cx, cy, rx, ry = e
    tex = rectify(im, e); q = analyse(tex)
    if rx / ry < .95: flags.append('angled_source')          # photo is a three-quarter shot; face was rectified
    if inl < .6: flags.append('outline_uncertain')           # check the circle on the admin page
    if min(rx, ry) < 150: flags.append('low_resolution')
    if q['coverage'] > .9: flags.append('mostly_solid')       # few or no openings: check the gaps were cut out
    if q['coverage'] < .2: flags.append('mostly_empty')
    if q['symmetry'] < .12: flags.append('irregular_pattern')
    out = {k: v for k, v in p.items() if k not in ('image', 'face_ellipse', 'model3d')}
    out['texture'] = 'wheel-models/%s.webp' % p['id']
    out['model3d'] = model_params(p, q)
    out['qa'] = dict(q, flags=flags, outline_inliers=round(inl, 2), face_ellipse=[round(v, 1) for v in e],
                     aspect=round(rx / ry, 3), source_size=list(src_size), background_keyed=keyed)
    out.setdefault('rot', [.15, .6])
    return tex, out

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--src', default=os.path.join(ROOT, 'catalog', 'products.json')); ap.add_argument('--only', default='')
    args = ap.parse_args(); src = json.load(open(args.src, encoding='utf-8'))
    only = set(filter(None, args.only.split(','))); os.makedirs(os.path.join(APP, 'wheel-models'), exist_ok=True)
    cat_path = os.path.join(APP, 'catalog.json'); prev = {}
    if only and os.path.exists(cat_path): prev = {p['id']: p for p in json.load(open(cat_path, encoding='utf-8'))['products']}
    products, failed = [], []
    for p in src['products']:
        if only and p['id'] not in only:
            if p['id'] in prev: products.append(prev[p['id']])
            continue
        try:
            tex, out = process(p); tex.save(os.path.join(APP, out['texture']), 'WEBP', quality=90, method=6)
            products.append(out); f = out['qa']['flags']
            print('%-22s ok   spokes=%-2d cover=%.2f aspect=%.2f %s' % (p['id'], out['qa']['spokes'], out['qa']['coverage'], out['qa']['aspect'], ('FLAGS: ' + ','.join(f)) if f else ''))
        except Exception as ex:
            failed.append({'id': p.get('id'), 'error': str(ex)}); print('%-22s FAIL %s' % (p.get('id'), ex))
    json.dump({'version': 1, 'products': products, 'failed': failed}, open(cat_path, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    print('\n%d built, %d flagged, %d failed -> %s' % (len(products), sum(1 for p in products if p['qa']['flags']), len(failed), os.path.relpath(cat_path, ROOT)))
    return 1 if failed else 0

if __name__ == '__main__': sys.exit(main())
