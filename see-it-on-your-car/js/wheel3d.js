/* Vyro-Car 3D wheel renderer.
   Builds a real 3D wheel (spoke face with depth, rim barrel, brake disc, caliper, tyre) and renders it
   with physically based materials. A wheel model comes from one of two sources:
     tier 1: a supplied GLB file (product.model3d.glb)
     tier 2: an automatic 2.5D model built from the normalised front photo of the wheel
   The renderer returns a transparent sprite that the studio composites onto the car photo. */
import * as THREE from 'three';
import { RoomEnvironment } from '../vendor/environments/RoomEnvironment.js';

const GRID = 200;            // face mesh resolution
const MAX_TEX = 2048;        // offscreen render target size (device px)

const FINISH = [
  [/chrome|polish|mirror/i,           { metalness: .95, roughness: .12 }],
  [/machin|milled|diamond|brushed/i,  { metalness: .8,  roughness: .24 }],
  [/matte|satin|asphalt|textured/i,   { metalness: .35, roughness: .62 }],
  [/gloss/i,                          { metalness: .6,  roughness: .26 }],
];
function finishOf(text) { for (const [re, v] of FINISH) if (re.test(text || '')) return v; return { metalness: .6, roughness: .34 }; }

/* radial depth profile of the face: lip at the front, a step down inside it, then spokes falling to the hub */
function faceZ(r, m) {
  if (r >= m.lip) return 0;
  const t = Math.min(1, (m.lip - r) / 0.05);                 // step from lip down to the spoke ends
  const s = Math.max(0, Math.min(1, (m.lip - r) / (m.lip - m.hub)));
  const ease = s * s * (3 - 2 * s);
  return -(m.step * t * t * (3 - 2 * t)) - m.concavity * ease;
}

function buildFace(img, m, fin) {
  const N = GRID, cv = document.createElement('canvas'); cv.width = cv.height = N + 1;
  const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0, N + 1, N + 1);
  const px = cx.getImageData(0, 0, N + 1, N + 1).data, W = N + 1;
  const solid = new Uint8Array(W * W);
  let sr = 0, sg = 0, sb = 0, sn = 0;
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
    const x = i / N * 2 - 1, y = 1 - j / N * 2, r = Math.hypot(x, y), k = (j * W + i) * 4;
    if (px[k + 3] >= 128 && r <= 1.0) solid[j * W + i] = 1;
    if (r > 0.94 && r < 0.99 && px[k + 3] > 200) { sr += px[k]; sg += px[k + 1]; sb += px[k + 2]; sn++; }
  }
  const pos = [], uv = [], col = [], idx = [], vid = new Int32Array(W * W).fill(-1);
  const vert = (i, j) => { let v = vid[j * W + i]; if (v >= 0) return v;
    const x = i / N * 2 - 1, y = 1 - j / N * 2; v = pos.length / 3;
    pos.push(x, y, faceZ(Math.hypot(x, y), m)); uv.push(i / N, 1 - j / N); col.push(1, 1, 1); vid[j * W + i] = v; return v; };
  const cell = new Uint8Array(N * N);   // 2 = fully solid (walls hang from these), 1 = touches solid (alpha-tested edge)
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const s = solid[j * W + i] + solid[j * W + i + 1] + solid[(j + 1) * W + i] + solid[(j + 1) * W + i + 1];
    cell[j * N + i] = s === 4 ? 2 : s > 0 ? 1 : 0;
    if (s > 0) { const a = vert(i, j), b = vert(i + 1, j), c = vert(i, j + 1), d = vert(i + 1, j + 1); idx.push(a, c, b, b, c, d); }
  }
  /* spoke side walls: wherever a solid cell borders a non-solid one, drop a quad back by the spoke thickness */
  const wp = [], wuv = [], wcol = [], widx = [];
  const wall = (i0, j0, i1, j1) => {
    const pos = wp, uv = wuv, col = wcol, idx = widx;
    const mk = (i, j, back) => { const x = i / N * 2 - 1, y = 1 - j / N * 2, r = Math.hypot(x, y), v = pos.length / 3;
      const th = m.spokeDepth * (r > m.lip - 0.03 ? 1.6 : 1);
      pos.push(x, y, faceZ(r, m) - (back ? th : 0.004)); uv.push(i / N, 1 - j / N); const c = back ? .1 : .42; col.push(c, c, c); return v; };
    const a = mk(i0, j0, 0), b = mk(i1, j1, 0), c = mk(i0, j0, 1), d = mk(i1, j1, 1); idx.push(a, c, b, b, c, d);
  };
  const full = (i, j) => i >= 0 && j >= 0 && i < N && j < N && cell[j * N + i] === 2;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (cell[j * N + i] === 2) {
    if (Math.hypot((i + .5) / N * 2 - 1, 1 - (j + .5) / N * 2) > .972) continue;   // the barrel closes the outer edge
    if (!full(i, j - 1)) wall(i, j, i + 1, j);
    if (!full(i, j + 1)) wall(i + 1, j + 1, i, j + 1);
    if (!full(i - 1, j)) wall(i, j + 1, i, j);
    if (!full(i + 1, j)) wall(i + 1, j, i + 1, j + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const tex = new THREE.Texture(img); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.needsUpdate = true;
  /* the product photo already carries studio lighting, so most of it is kept as-is (emissive) and the
     scene lighting only adds view-dependent shading and reflections on top */
  const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: .5, vertexColors: true, side: THREE.DoubleSide,
    emissiveMap: tex, emissive: new THREE.Color(m.photoLight, m.photoLight, m.photoLight), color: new THREE.Color(m.sceneLight, m.sceneLight, m.sceneLight),
    metalness: fin.metalness * .6, roughness: fin.roughness, envMapIntensity: m.envIntensity });
  /* walls and the alpha-tested fringe must not glow: scale emissive by the vertex colour */
  mat.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= vColor.rgb;'); };
  const rim = sn ? new THREE.Color(sr / sn / 255, sg / sn / 255, sb / sn / 255) : new THREE.Color(.3, .3, .32);
  rim.convertSRGBToLinear();
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3)); wg.setAttribute('uv', new THREE.Float32BufferAttribute(wuv, 2));
  wg.setAttribute('color', new THREE.Float32BufferAttribute(wcol, 3)); wg.setIndex(widx);
  /* spoke sides are unlit (photo colour, darkening with depth) so the grid steps never show as hatching */
  const walls = new THREE.Mesh(wg, new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, side: THREE.DoubleSide }));
  const group = new THREE.Group(); group.add(new THREE.Mesh(g, mat), walls);
  return { mesh: group, rim, tris: (idx.length + widx.length) / 3 };
}

function lathe(points, mat) { // points: [radius, z] revolved around the wheel axis (z)
  const g = new THREE.LatheGeometry(points.map(p => new THREE.Vector2(p[0], p[1])), 72);
  g.rotateX(Math.PI / 2); return new THREE.Mesh(g, mat);
}

function buildBarrel(m, rim, fin) {
  /* the inside of the barrel is seen through the spokes and is always in shadow */
  const c = rim.clone().multiplyScalar(.14); const mx = Math.max(c.r, c.g, c.b); if (mx > .06) c.multiplyScalar(.06 / mx);
  const mat = new THREE.MeshStandardMaterial({ color: c, metalness: .5, roughness: .5, side: THREE.DoubleSide, envMapIntensity: .22 });
  const w = m.width, i = m.lip - .03;
  return lathe([[1.0, 0], [1.0, -.03], [i, -.05], [i - .02, -.12], [i - .04, -w * .55], [i - .01, -w + .06], [i + .03, -w], [1.0, -w]], mat);
}

function buildBrake(m) {
  const g = new THREE.Group(), z = -m.width * .52;
  /* everything behind the spokes sits in the wheel's own shadow, so it is kept dim */
  const discMat = new THREE.MeshStandardMaterial({ color: 0x26282b, metalness: .3, roughness: .5, envMapIntensity: .22 });
  const disc = new THREE.Mesh(new THREE.RingGeometry(.27, .68, 64), discMat); disc.position.z = z; g.add(disc);
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(.27, .29, .14, 40), new THREE.MeshStandardMaterial({ color: 0x25262a, metalness: .6, roughness: .55 }));
  hat.rotation.x = Math.PI / 2; hat.position.z = z + .07; g.add(hat);
  const back = new THREE.Mesh(new THREE.CircleGeometry(m.lip, 48), new THREE.MeshBasicMaterial({ color: 0x060607 }));
  back.position.z = -m.width * .9; g.add(back);
  const calMat = new THREE.MeshStandardMaterial({ color: 0xd3141d, metalness: .2, roughness: .45, envMapIntensity: .3 });
  const shape = new THREE.Shape(); const a0 = .42, a1 = 1.08, r0 = .47, r1 = .72;
  shape.absarc(0, 0, r1, a0, a1, false); shape.absarc(0, 0, r0, a1, a0, true);
  const cal = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: .16, bevelEnabled: true, bevelSize: .015, bevelThickness: .015, bevelSegments: 2, curveSegments: 20 }), calMat);
  cal.position.z = z - .04; g.add(cal);
  return { group: g, calMat };
}

function buildTyre(rt, m) {
  const w = m.width + .06, d = rt - 1;
  const mat = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, metalness: 0, roughness: .86, envMapIntensity: .35, side: THREE.DoubleSide });
  const b = Math.min(.05, d * .16);   // sidewall bulge
  const pts = [[.985, -.03], [1.0, .0], [1 + d * .25, b * .8], [1 + d * .6, b], [rt - d * .18, -.01], [rt - .012, -.07], [rt, -.14],
               [rt, -w + .14], [rt - .012, -w + .07], [rt - d * .18, -w + .01], [1 + d * .6, -w - b], [1 + d * .25, -w - b * .8], [.985, -w + .03]];
  return lathe(pts, mat);
}

export const MODEL_DEFAULTS = { concavity: .1, step: .035, spokeDepth: .11, lip: .93, hub: .16, width: .82, envIntensity: .55, photoLight: .62, sceneLight: .55 };

export class Wheel3D {
  constructor() {
    this.canvas = document.createElement('canvas'); this.canvas.width = this.canvas.height = MAX_TEX;
    this.r = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
    this.r.setPixelRatio(1); this.r.setClearColor(0x000000, 0);
    this.r.toneMapping = THREE.LinearToneMapping; this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(this.r); this.scene.environment = pm.fromScene(new RoomEnvironment(), .04).texture; pm.dispose();
    this.key = new THREE.DirectionalLight(0xffffff, 1.1); this.key.position.set(-1.2, 2.2, 2.4); this.scene.add(this.key);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x30302c, .35));
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 50); this.cam.position.set(0, 0, 10);
    this.root = new THREE.Group(); this.scene.add(this.root);
    this.models = new Map(); this.tyres = new Map(); this.current = null;
    this.ok = true;
  }
  /* product: {id, finish, model3d?}, img: normalised front photo (HTMLImageElement or canvas) */
  model(product, img) {
    let M = this.models.get(product.id); if (M) return M;
    const m = Object.assign({}, MODEL_DEFAULTS, product.model3d || {}), fin = Object.assign(finishOf(product.finish), (product.model3d || {}).material || {});
    const face = buildFace(img, m, fin), spin = new THREE.Group(), group = new THREE.Group();
    spin.add(face.mesh, buildBarrel(m, face.rim, fin));
    const brake = buildBrake(m); group.add(spin, brake.group);
    M = { group, spin, brake, m, tris: face.tris, tyre: null, tyreKey: 0 }; this.models.set(product.id, M); return M;
  }
  /* tier 1: swap the generated face and barrel for a supplied GLB (unit radius, face towards +z) */
  async loadGLB(product, url) {
    const { GLTFLoader } = await import('../vendor/loaders/GLTFLoader.js');
    const gltf = await new GLTFLoader().loadAsync(url), M = this.models.get(product.id); if (!M) return;
    const box = new THREE.Box3().setFromObject(gltf.scene), s = new THREE.Vector3(); box.getSize(s);
    const k = 2 / Math.max(s.x, s.y); gltf.scene.scale.setScalar(k);
    const c = new THREE.Vector3(); box.getCenter(c); gltf.scene.position.set(-c.x * k, -c.y * k, -box.max.z * k);
    M.spin.clear(); M.spin.add(gltf.scene); M.tier = 1;
  }
  /* o: {product, img, radius (rim radius in output px), scale (device px per output px), yaw, pitch, rot,
         caliper (css colour), tyre (outer radius / rim radius, 0 = no tyre), exposure, lightX} */
  render(o) {
    const M = this.model(o.product, o.img);
    if (this.current !== M) { this.root.clear(); this.root.add(M.group); this.current = M; }
    const key = o.tyre ? Math.round(o.tyre * 50) : 0;
    if (M.tyreKey !== key) { if (M.tyre) M.group.remove(M.tyre); M.tyre = null; M.tyreKey = key;
      if (key) { let t = this.tyres.get(key + ':' + M.m.width); if (!t) { t = buildTyre(key / 50, M.m); this.tyres.set(key + ':' + M.m.width, t); } M.tyre = t; M.group.add(t); } }
    M.spin.rotation.z = -(o.rot || 0);
    M.brake.calMat.color.set(o.caliper || '#6b6f76');
    this.root.rotation.set(o.pitch || 0, o.yaw || 0, 0);
    const ext = Math.max(o.tyre || 0, 1.06) * 1.12 + Math.abs(Math.sin(o.yaw || 0)) * M.m.width * .6;   // half extent in rim radii
    /* supersample: small on-screen wheels are rendered at 2-3x and scaled down, which keeps thin spokes clean */
    const base = 2 * ext * o.radius * (o.scale || 1), ss = Math.max(1.5, Math.min(3, 520 / base));
    let px = Math.min(MAX_TEX, Math.ceil(base * ss));
    this.cam.left = -ext; this.cam.right = ext; this.cam.top = ext; this.cam.bottom = -ext; this.cam.updateProjectionMatrix();
    this.r.toneMappingExposure = o.exposure || 1;
    this.key.position.set((o.lightX || -.4) * 3, 2.2, 2.4);
    this.r.setViewport(0, 0, px, px); this.r.setScissor(0, 0, px, px); this.r.setScissorTest(true);
    this.r.clear(); this.r.render(this.scene, this.cam);
    return { canvas: this.canvas, sx: 0, sy: MAX_TEX - px, px, half: ext * o.radius, ext };
  }
}

let inst = null;
export function getWheel3D() { if (inst) return inst; try { inst = new Wheel3D(); } catch (e) { console.warn('3D wheels unavailable, using 2D overlays', e); inst = { ok: false }; } return inst; }
window.VyroWheel3D = { get: getWheel3D, MODEL_DEFAULTS };
window.dispatchEvent(new Event('vyro3d-ready'));
