/* Vyro-Car wheel detector (classical computer vision, runs in the browser, no model download).
   Finds the two wheels of a car in a photo as axis-aligned ellipses:
     detect(img) -> { wheels:[{x,y,r,k},{x,y,r,k}], score, ms } | null
   x,y = rim centre in image pixels, r = rim radius (vertical semi-axis), k = horizontal squash
   (1 = flat side view, lower = photo taken from a corner). Wheels are returned left to right.
   Method: gradient-direction Hough transform for ellipses over a set of squash factors, pairing of
   candidates by geometry, then a radial edge profile to separate the rim edge from the tyre edge. */
(function () {
  const W0 = 480, KS = [1, .9, .8, .7, .6, .5, .42, .34], MIN_SCORE = 11.5;

  function toGray(img) {
    const sc = W0 / img.width, w = W0, h = Math.max(8, Math.round(img.height * sc));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0, w, h);
    const d = cx.getImageData(0, 0, w, h).data, g = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) g[i] = d[i * 4] * .299 + d[i * 4 + 1] * .587 + d[i * 4 + 2] * .114;
    return { g, w, h, sc };
  }
  function blur(g, w, h) {
    const t = new Float32Array(w * h), o = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; t[i] = (g[y * w + Math.max(0, x - 1)] + 2 * g[i] + g[y * w + Math.min(w - 1, x + 1)]) / 4; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; o[i] = (t[Math.max(0, y - 1) * w + x] + 2 * t[i] + t[Math.min(h - 1, y + 1) * w + x]) / 4; }
    return o;
  }
  const perim = (a, b) => Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
  const samp = (g, w, h, x, y) => { x = Math.max(0, Math.min(w - 1.001, x)); y = Math.max(0, Math.min(h - 1.001, y)); const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * w + x0;
    return g[i] * (1 - fx) * (1 - fy) + g[i + 1] * fx * (1 - fy) + g[i + w] * (1 - fx) * fy + g[i + w + 1] * fx * fy; };

  function hough(E, w, h, k, rs) {
    const bw = w >> 1, bh = h >> 1, nr = rs.length, acc = new Float32Array(bw * bh * nr), k2 = k * k;
    for (let e = 0; e < E.n; e++) {
      const x = E.x[e], y = E.y[e]; let dx = E.gx[e] * k2, dy = E.gy[e]; const L = Math.hypot(dx, dy); dx /= L; dy /= L;
      const f = 1 / Math.sqrt((dx / k) * (dx / k) + dy * dy);
      for (let ri = 0; ri < nr; ri++) { const t = rs[ri] * f;
        for (let s = -1; s <= 1; s += 2) { const cx = (x + s * t * dx) >> 1, cy = (y + s * t * dy) >> 1;
          if (cx >= 0 && cx < bw && cy >= 0 && cy < bh) acc[(ri * bh + cy) * bw + cx] += 1; } }
    }
    /* 3x3x3 box sum, normalised by the ellipse perimeter -> fraction of the outline supported by edges */
    const out = [];
    for (let ri = 1; ri < nr - 1; ri++) { const P = perim(rs[ri] * k, rs[ri]);
      for (let cy = 1; cy < bh - 1; cy++) for (let cx = 1; cx < bw - 1; cx++) {
        const c = acc[(ri * bh + cy) * bw + cx]; if (c < P * .08) continue; let sum = 0;
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) sum += acc[((ri + a) * bh + cy + b) * bw + cx + d];
        const sc = sum / P; if (sc > .55) out.push({ x: cx * 2 + 1, y: cy * 2 + 1, r: rs[ri], k, s: sc }); } }
    out.sort((a, b) => b.s - a.s); const keep = [];
    for (const c of out) { if (keep.length >= 14) break; if (!keep.some(q => Math.hypot(q.x - c.x, q.y - c.y) < .5 * Math.max(q.r, c.r))) keep.push(c); }
    return keep;
  }

  /* mean signed radial brightness step across the ellipse of vertical radius r (positive = brighter outside) */
  function radial(g, w, h, c, r) {
    let s = 0, n = 0;
    for (let a = 0; a < 48; a++) { const t = a / 48 * 2 * Math.PI, ux = Math.cos(t) * c.k, uy = Math.sin(t);
      if (uy < -.75) continue;                                   /* top of the wheel is hidden by the arch */
      s += samp(g, w, h, c.x + ux * (r + 1.5), c.y + uy * (r + 1.5)) - samp(g, w, h, c.x + ux * (r - 1.5), c.y + uy * (r - 1.5)); n++; }
    return s / n;
  }
  function ringMean(g, w, h, c, r0, r1) { let s = 0, n = 0;
    for (let a = 0; a < 32; a++) { const t = a / 32 * 2 * Math.PI, ux = Math.cos(t) * c.k, uy = Math.sin(t); if (uy < -.6) continue;
      for (let r = r0; r <= r1; r += Math.max(1, (r1 - r0) / 3)) { s += samp(g, w, h, c.x + ux * r, c.y + uy * r); n++; } }
    return s / n; }

  /* The tyre is a dark band between the rim edge (bright to dark going outwards) and the tyre's outer
     edge (dark to brighter). Search for that band around the candidate centre; the rim is its inner edge. */
  function refineRim(g, w, h, c, mean) {
    const lo = Math.max(5, c.r * .45), hi = c.r * 1.9, n = Math.ceil((hi - lo) / .75) + 1, D = new Float32Array(n);
    for (let i = 0; i < n; i++) D[i] = radial(g, w, h, c, lo + i * .75);
    let best = null;
    for (let i = 0; i < n; i++) { const rin = lo + i * .75; if (rin > c.r * 1.12) break;
      for (let j = i + 2; j < n; j++) { const rout = lo + j * .75, ratio = rout / rin; if (ratio < 1.14) continue; if (ratio > 1.95) break;
        const band = ringMean(g, w, h, c, rin + 1.5, rout - 1.5), dark = (mean - band) / (mean + 1);
        if (dark < .12) continue;
        /* either edge of the band should coincide with the outline the Hough step found */
        const isRim = Math.abs(rin - c.r) < c.r * .12, isTyre = Math.abs(rout - c.r) < c.r * .12 && rin > c.r * .52;
        if (!isRim && !isTyre) continue;
        const v = (Math.max(0, -D[i]) + .6 * Math.max(0, D[j])) * (.3 + dark);
        if (!best || v > best.v) best = { rin, rout, v }; } }
    if (best && best.v > 2) return best.rin;
    return radial(g, w, h, c, c.r) > 2 ? c.r * .74 : c.r;
  }

  function detect(img) {
    const t0 = performance.now(), G = toGray(img), w = G.w, h = G.h, g = blur(G.g, w, h);
    const mag = new Float32Array(w * h), gxA = new Float32Array(w * h), gyA = new Float32Array(w * h); let mean = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x;
      const gx = g[i + 1 - w] + 2 * g[i + 1] + g[i + 1 + w] - g[i - 1 - w] - 2 * g[i - 1] - g[i - 1 + w];
      const gy = g[i + w - 1] + 2 * g[i + w] + g[i + w + 1] - g[i - w - 1] - 2 * g[i - w] - g[i - w + 1];
      gxA[i] = gx; gyA[i] = gy; mag[i] = Math.hypot(gx, gy); }
    for (let i = 0; i < w * h; i++) mean += g[i]; mean /= w * h;
    const hist = new Uint32Array(1024); for (let i = 0; i < w * h; i++) hist[Math.min(1023, mag[i] | 0)]++;
    let thr = 1023, cum = 0; while (thr > 20 && cum < w * h * .16) cum += hist[thr--];
    const idx = []; for (let y = Math.round(h * .22); y < h - 1; y++) for (let x = 1; x < w - 1; x++) if (mag[y * w + x] > thr) idx.push(y * w + x);
    const E = { n: idx.length, x: new Float32Array(idx.length), y: new Float32Array(idx.length), gx: new Float32Array(idx.length), gy: new Float32Array(idx.length) };
    idx.forEach((i, e) => { E.x[e] = i % w; E.y[e] = (i / w) | 0; E.gx[e] = gxA[i]; E.gy[e] = gyA[i]; });
    const rs = []; for (let r = 10; r <= Math.min(h * .42, w * .2); r += 1.5) rs.push(r);
    let cands = []; for (const k of KS) cands = cands.concat(hough(E, w, h, k, rs));
    cands.forEach(c => { /* wheels are dark rings: reward a dark band just inside or outside the outline */
      const inner = ringMean(g, w, h, c, c.r * .8, c.r * .97), outer = ringMean(g, w, h, c, c.r * 1.04, c.r * 1.25);
      c.dark = Math.max(0, (mean - Math.min(inner, outer)) / (mean + 1));
      c.q = c.s * (.6 + c.dark) * Math.min(1, c.r / (w * .036)); });   /* tiny circles score high by chance */
    cands.sort((a, b) => b.q - a.q);
    /* the same circle is found at several squash factors: keep the best version of each */
    const uniq = []; for (const c of cands) { if (uniq.length >= 40) break; if (!uniq.some(q => Math.hypot(q.x - c.x, q.y - c.y) < .4 * Math.min(q.r, c.r) && Math.abs(q.r - c.r) < .18 * q.r)) uniq.push(c); } cands = uniq;
    let best = null;
    for (let i = 0; i < cands.length; i++) for (let j = i + 1; j < cands.length; j++) {
      const a = cands[i], b = cands[j], dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y), R = Math.max(a.r, b.r), ratio = Math.min(a.r, b.r) / R;
      if (dx < R * 2.4 || dx > R * 13.5 || dx < w * .18) continue;          /* a car's wheelbase is 2.4 to 13.5 outline radii */
      if (dy > dx * .65 || ratio < .5 || Math.abs(a.k - b.k) > .42) continue;
      /* perspective: when the wheels are at clearly different heights, the nearer (bigger) one is the lower one */
      if (dy > dx * .12) { const big = a.r >= b.r ? a : b, small = big === a ? b : a; if (big.y < small.y || ratio > .93) continue; }
      if (Math.min(a.y, b.y) < h * .3) continue;
      const v = (a.q + b.q) * (.7 + .3 * ratio) * (1 - .8 * dy / dx) * (.75 + .25 * Math.min(1, dx / (w * .45)));
      if (detect.debug) detect.debug.push({ v: +v.toFixed(2), a: [a.x, a.y, a.r, a.k, +a.s.toFixed(2), +a.dark.toFixed(2)], b: [b.x, b.y, b.r, b.k, +b.s.toFixed(2), +b.dark.toFixed(2)] });
      if (!best || v > best.v) best = { a, b, v }; }
    if (!best || best.v < MIN_SCORE) return null;
    const out = [best.a, best.b].sort((p, q) => p.x - q.x).map(c => { const r = refineRim(g, w, h, c, mean);
      return { x: c.x / G.sc, y: c.y / G.sc, r: r / G.sc, k: c.k, outline: c.r / G.sc, support: +c.s.toFixed(2) }; });
    return { wheels: out, score: +best.v.toFixed(2), ms: Math.round(performance.now() - t0) };
  }
  window.VyroDetect = { detect };
})();
