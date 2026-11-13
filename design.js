(() => {
'use strict';

/* ---------- tiny helpers ---------- */
const $ = (s) => document.querySelector(s);
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  n.append(...kids.filter((k) => k != null));
  for (const k in attrs) {
    const v = attrs[k];
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k in n) n[k] = v;
    else n.setAttribute(k, v);
  }
  return n;
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const newId = (p) => p + Math.random().toString(36).slice(2, 10);
const INK = '#0f1f1b', MAT = '#1d5b50', MARK = '#ffd23f', BLADE = '#c93f26';

const FONTS = ['Bricolage Grotesque', 'Instrument Sans', 'Space Grotesk', 'Fraunces', 'DM Serif Display', 'Anton', 'Caveat', 'JetBrains Mono'];
const SIZES = [
  ['square', 'Square post', 1080, 1080],
  ['portrait', 'Portrait post', 1080, 1350],
  ['story', 'Story', 1080, 1920],
  ['slide', 'Presentation slide', 1920, 1080],
  ['thumb', 'Video thumbnail', 1280, 720],
  ['banner', 'Wide banner', 1500, 500],
  ['a4', 'A4 flyer', 794, 1123],
];
const SHAPES = [
  ['rect', 'Rectangle', '<rect x="4" y="8" width="32" height="24"/>'],
  ['round', 'Rounded', '<rect x="4" y="8" width="32" height="24" rx="7"/>'],
  ['ellipse', 'Circle', '<circle cx="20" cy="20" r="15"/>'],
  ['triangle', 'Triangle', '<path d="M20 5 36 34H4z"/>'],
  ['diamond', 'Diamond', '<path d="M20 4 36 20 20 36 4 20z"/>'],
  ['hexagon', 'Hexagon', '<path d="M11 5h18l9 15-9 15H11L2 20z"/>'],
  ['star', 'Star', '<path d="M20 3l5 11.5 12.5 1.2-9.4 8.3 2.8 12.2L20 29.8 9.1 36.2l2.8-12.2-9.4-8.3L15 14.5z"/>'],
  ['line', 'Line', '<path d="M5 20h30" fill="none" stroke-width="3" stroke-linecap="round"/>'],
  ['arrow', 'Arrow', '<path d="M5 20h26M25 13l7 7-7 7" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'],
];

/* ---------- document ---------- */
const newPage = (bg = '#ffffff', els = []) => ({ id: newId('p'), bg, els });
const doc = { name: 'Untitled design', w: 1080, h: 1080, pages: [newPage()], cur: 0 };   // every page shares one size
// doc.els and doc.bg always mean the page being edited; they are left out of saved snapshots.
Object.defineProperties(doc, {
  els: { get: () => doc.pages[doc.cur].els, set: (v) => { doc.pages[doc.cur].els = v; } },
  bg: { get: () => doc.pages[doc.cur].bg, set: (v) => { doc.pages[doc.cur].bg = v; } },
});
const assets = new Map();              // id -> {src, img}
const nodes = new Map();               // element id -> Konva node
let sel = [];                          // selected element ids
let editing = null;                    // id of the text being typed into
const byId = (id) => doc.els.find((e) => e.id === id);

/* ---------- templates (original layouts) ---------- */
const T = (text, x, y, w, size, font, fill, o = {}) => ({ type: 'text', text, x, y, w, size, font, fill, bold: false, italic: false, align: 'left', lh: 1.2, ls: 0, ...o });
const R = (x, y, w, h, fill, o = {}) => ({ type: 'rect', x, y, w, h, fill, stroke: INK, sw: 0, radius: 0, ...o });
const TEMPLATES = [
  { name: 'Open day', w: 1080, h: 1080, bg: MARK, els: [
    R(0, 820, 1080, 260, INK),
    T('Spring\nopen day', 80, 110, 920, 190, 'Bricolage Grotesque', INK, { bold: true, lh: 0.95, ls: -4 }),
    { type: 'ellipse', x: 720, y: 500, w: 290, h: 290, fill: BLADE, stroke: INK, sw: 0 },
    T('Sat\n14 Sep', 720, 581, 290, 64, 'Bricolage Grotesque', '#ffffff', { bold: true, align: 'center', lh: 1 }),
    T('Doors 10 am. Bring a friend.', 80, 890, 920, 46, 'Instrument Sans', '#ffffff'),
    T('Unit 4, Mill Lane', 80, 965, 920, 30, 'JetBrains Mono', MARK),
  ] },
  { name: 'Menu story', w: 1080, h: 1920, bg: MAT, els: [
    R(90, 240, 900, 900, '#f3f6f4', { radius: 40 }),
    T('Your photo goes here', 90, 668, 900, 40, 'JetBrains Mono', '#586863', { align: 'center' }),
    T('New on\nthe menu', 90, 1220, 900, 150, 'Fraunces', MARK, { bold: true, lh: 1 }),
    T('Charred leek toast, brown butter, soft egg.', 90, 1560, 900, 48, 'Instrument Sans', '#ffffff', { lh: 1.3 }),
    T('Weekends from 8 am', 90, 1770, 900, 32, 'JetBrains Mono', '#bfe0d6'),
  ] },
  { name: 'Title slide', w: 1920, h: 1080, bg: '#f3f6f4', els: [
    R(0, 0, 120, 1080, INK),
    R(240, 250, 160, 14, BLADE),
    T('Quarterly review', 240, 300, 1500, 150, 'Bricolage Grotesque', INK, { bold: true, ls: -3 }),
    T('What moved, what stalled, and what we do next.', 240, 510, 1100, 52, 'Instrument Sans', '#586863', { lh: 1.3 }),
    T('July to September', 240, 910, 900, 30, 'JetBrains Mono', INK),
  ] },
  { name: 'Video cover', w: 1280, h: 720, bg: INK, els: [
    T('5 EDITING\nTIPS', 70, 50, 900, 190, 'Anton', '#ffffff', { lh: 1.02 }),
    R(-40, 500, 820, 150, MARK, { rot: -4 }),
    T('in under ten minutes', 70, 528, 700, 62, 'Bricolage Grotesque', INK, { bold: true, rot: -4 }),
    { type: 'poly', shape: 'star', x: 950, y: 110, w: 250, h: 250, fill: BLADE, stroke: INK, sw: 0 },
  ] },
  { name: 'Event flyer', w: 794, h: 1123, bg: '#ffffff', els: [
    R(0, 0, 794, 420, MAT),
    T('Community\nplant swap', 60, 100, 674, 96, 'DM Serif Display', '#ffffff', { lh: 1.05 }),
    T('Bring a cutting, take a cutting.', 60, 340, 674, 26, 'Instrument Sans', MARK),
    T('Saturday 12 October\n10 am to 1 pm\nRiverside Hall, back garden', 60, 480, 674, 40, 'Instrument Sans', INK, { bold: true, lh: 1.4 }),
    { type: 'line', x: 60, y: 715, w: 674, h: 0, stroke: INK, sw: 3, arrow: false },
    T('Free entry. Pots, labels and tea provided. Children welcome.', 60, 750, 520, 26, 'Instrument Sans', '#586863', { lh: 1.4 }),
    { type: 'ellipse', x: 610, y: 930, w: 130, h: 130, fill: MARK, stroke: INK, sw: 0 },
  ] },
  { name: 'Sale', w: 1080, h: 1080, bg: BLADE, els: [
    T('END OF\nSEASON', 70, 80, 940, 170, 'Anton', '#ffffff', { lh: 1.02 }),
    R(70, 480, 940, 330, MARK, { radius: 24 }),
    T('30% off', 70, 535, 940, 210, 'Bricolage Grotesque', INK, { bold: true, align: 'center', ls: -6, lh: 1 }),
    T('Everything in store until Sunday', 70, 870, 940, 44, 'Instrument Sans', '#ffffff', { align: 'center' }),
    T('No code needed', 70, 950, 940, 28, 'JetBrains Mono', MARK, { align: 'center' }),
  ] },
  { name: 'Quote', w: 1080, h: 1350, bg: INK, els: [
    T('\u201c', 70, 90, 300, 420, 'Fraunces', MARK, { bold: true, lh: 1 }),
    T('Measure twice,\ncut once.', 80, 470, 920, 124, 'Fraunces', '#ffffff', { lh: 1.1 }),
    R(80, 800, 120, 8, BLADE),
    T('Workshop rule no. 1', 80, 850, 920, 34, 'JetBrains Mono', '#bfe0d6'),
  ] },
  { name: 'Hiring story', w: 1080, h: 1920, bg: MARK, els: [
    T('WE ARE\nHIRING', 80, 280, 920, 250, 'Anton', INK, { lh: 1.02 }),
    R(80, 860, 920, 12, INK),
    T('Weekend barista', 80, 930, 920, 84, 'Bricolage Grotesque', INK, { bold: true }),
    T('Two shifts a week. Training given. Free coffee, obviously.', 80, 1060, 820, 48, 'Instrument Sans', INK, { lh: 1.35 }),
    R(80, 1500, 520, 130, INK, { radius: 65 }),
    T('Ask at the counter', 80, 1538, 520, 44, 'Instrument Sans', '#ffffff', { bold: true, align: 'center' }),
  ] },
  { name: 'Agenda slide', w: 1920, h: 1080, bg: '#ffffff', els: [
    R(0, 0, 1920, 200, MAT),
    T('Agenda', 120, 48, 1200, 96, 'Bricolage Grotesque', '#ffffff', { bold: true }),
    T('1  Where we are\n2  What customers told us\n3  Three options\n4  Decision and next steps', 120, 290, 1400, 64, 'Instrument Sans', INK, { lh: 1.7 }),
    R(120, 950, 1680, 4, '#d3dcd8'),
    T('Team meeting, 9 October', 120, 985, 900, 28, 'JetBrains Mono', '#586863'),
  ] },
  { name: 'Shop banner', w: 1500, h: 500, bg: MAT, els: [
    { type: 'ellipse', x: 1130, y: -110, w: 520, h: 520, fill: MARK, stroke: INK, sw: 0 },
    T('Small-batch ceramics', 90, 120, 1000, 110, 'DM Serif Display', '#ffffff'),
    T('Thrown, glazed and fired in our studio. New pieces every Friday.', 90, 290, 820, 36, 'Instrument Sans', '#bfe0d6', { lh: 1.35 }),
  ] },
];

/* ---------- stage ---------- */
const host = $('#stage-host'), ta = $('#text-edit');
const stage = new Konva.Stage({ container: host, width: host.clientWidth || 600, height: host.clientHeight || 400 });
const layer = new Konva.Layer(), ui = new Konva.Layer();
stage.add(layer, ui);
const shadow = new Konva.Rect({ fill: '#fff', shadowColor: '#000', shadowBlur: 40, shadowOpacity: 0.45, shadowOffsetY: 14, listening: false });
const page = new Konva.Group();
const bg = new Konva.Rect({ name: 'bg' });
page.add(bg);
layer.add(shadow, page);
const marks = new Konva.Group({ listening: false });
const guides = new Konva.Group({ listening: false });
const marquee = new Konva.Rect({ visible: false, listening: false, fill: 'rgba(255,210,63,.18)', stroke: MARK, strokeWidth: 1, strokeScaleEnabled: false });
const tr = new Konva.Transformer({
  flipEnabled: false, rotationSnaps: [0, 45, 90, 135, 180, 225, 270, 315], rotateAnchorOffset: 30,
  anchorFill: MARK, anchorStroke: INK, anchorStrokeWidth: 1.5, anchorSize: 11, anchorCornerRadius: 2,
  borderStroke: BLADE, borderStrokeWidth: 1.5, padding: 1,
  boundBoxFunc: (o, n) => (Math.abs(n.width) < 6 ? o : n),
});
ui.add(marks, guides, tr, marquee);

const view = { z: 1, x: 0, y: 0, auto: true };   // auto: still showing the whole page, so refit when the window changes
function applyView() {
  stage.scale({ x: view.z, y: view.z });
  stage.position({ x: view.x, y: view.y });
  // Registration marks and the size printed on the mat, kept the same size on screen at any zoom.
  const g = 8 / view.z, l = 20 / view.z, W = doc.w, H = doc.h;
  marks.destroyChildren();
  const mk = (pts) => marks.add(new Konva.Line({ points: pts, stroke: 'rgba(255,255,255,.6)', strokeWidth: 1, strokeScaleEnabled: false }));
  for (const [cx, sx] of [[0, -1], [W, 1]]) for (const [cy, sy] of [[0, -1], [H, 1]]) {
    mk([cx + sx * g, cy, cx + sx * (g + l), cy]);
    mk([cx, cy + sy * g, cx, cy + sy * (g + l)]);
  }
  marks.add(new Konva.Text({ x: 0, y: H + 12 / view.z, text: `${W} × ${H} px`, fontFamily: 'JetBrains Mono', fontSize: 11 / view.z, fill: 'rgba(255,255,255,.7)' }));
  $('#zoom-v').textContent = Math.round(view.z * 100) + '%';
  stage.batchDraw();
}
function fit() {
  const pad = 56, sw = stage.width(), sh = stage.height();
  view.z = clamp(Math.min((sw - pad * 2) / doc.w, (sh - pad * 2) / doc.h), 0.05, 2);
  view.x = (sw - doc.w * view.z) / 2;
  view.y = (sh - doc.h * view.z) / 2;
  view.auto = true;
  applyView();
}
function zoomTo(nz, cx = stage.width() / 2, cy = stage.height() / 2) {
  nz = clamp(nz, 0.05, 8);
  const px = (cx - view.x) / view.z, py = (cy - view.y) / view.z;
  view.z = nz; view.x = cx - px * nz; view.y = cy - py * nz; view.auto = false;
  applyView();
}
function syncPage() {
  bg.setAttrs({ width: doc.w, height: doc.h, fill: doc.bg });
  shadow.setAttrs({ width: doc.w, height: doc.h });
  page.clip({ x: 0, y: 0, width: doc.w, height: doc.h });
  setStats();
}

/* ---------- elements -> Konva nodes ---------- */
function polyPoints(shape, w, h) {
  if (shape === 'triangle') return [w / 2, 0, w, h, 0, h];
  if (shape === 'diamond') return [w / 2, 0, w, h / 2, w / 2, h, 0, h / 2];
  if (shape === 'hexagon') return [w * 0.25, 0, w * 0.75, 0, w, h / 2, w * 0.75, h, w * 0.25, h, 0, h / 2];
  const pts = [];                                             // five-point star
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.42 : 1, a = (-90 + 36 * i) * Math.PI / 180;
    pts.push(w / 2 + Math.cos(a) * r * w / 2, h / 2 + Math.sin(a) * r * h / 2);
  }
  return pts;
}
/* Image filters are baked into an offscreen copy of the picture, so downloads keep full sharpness. */
const FX0 = { look: 'none', bri: 100, con: 100, sat: 100, blur: 0 };
const LOOKS = { none: ['None', ''], mono: ['Black and white', 'grayscale(1)'], sepia: ['Sepia', 'sepia(.85)'], fade: ['Faded', 'contrast(.82) brightness(1.08) saturate(.75)'], vivid: ['Vivid', 'saturate(1.45) contrast(1.1)'] };
const FX_OK = 'filter' in CanvasRenderingContext2D.prototype;
const fxCache = new Map();
let fxLive = false;                    // true while a slider is moving: render a small, fast copy
function fxString(fx, k) {
  if (!fx) return '';
  const f = { ...FX0, ...fx }, out = [];
  if (LOOKS[f.look]?.[1]) out.push(LOOKS[f.look][1]);
  if (f.bri !== 100) out.push(`brightness(${f.bri}%)`);
  if (f.con !== 100) out.push(`contrast(${f.con}%)`);
  if (f.sat !== 100) out.push(`saturate(${f.sat}%)`);
  if (f.blur > 0) out.push(`blur(${(f.blur * k).toFixed(2)}px)`);
  return out.join(' ');
}
const natural = (img) => [img.naturalWidth || 300, img.naturalHeight || 300];
function imageFor(e) {                 // -> { img, k } where k is the copy's scale against the original
  const a = assets.get(e.asset);
  if (!a) return { img: undefined, k: 1 };
  const filter = FX_OK ? fxString(e.fx, 1) : '';
  if (!filter && !e.flipX && !e.flipY) return { img: a.img, k: 1 };
  const [iw, ih] = natural(a.img), k = Math.min(1, (fxLive ? 900 : 4096) / Math.max(iw, ih));
  const key = `${e.asset}|${k}|${e.flipX ? 'x' : ''}${e.flipY ? 'y' : ''}|${FX_OK ? fxString(e.fx, k) : ''}`;
  let c = fxCache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(iw * k)); c.height = Math.max(1, Math.round(ih * k));
    const ctx = c.getContext('2d');
    if (filter) ctx.filter = fxString(e.fx, k);
    ctx.translate(e.flipX ? c.width : 0, e.flipY ? c.height : 0);
    ctx.scale(e.flipX ? -1 : 1, e.flipY ? -1 : 1);
    ctx.drawImage(a.img, 0, 0, c.width, c.height);
    fxCache.set(key, c);
    if (fxCache.size > 12) fxCache.delete(fxCache.keys().next().value);
  }
  return { img: c, k: c.width / iw };
}

const CTORS = { rect: Konva.Rect, ellipse: Konva.Ellipse, poly: Konva.Line, line: Konva.Arrow, text: Konva.Text, image: Konva.Image };
function applyAttrs(e, n) {
  const blur = (e.shadow || 0) / 100 * Math.min(doc.w, doc.h) * 0.06;
  n.setAttrs({ x: e.x, y: e.y, rotation: e.rot || 0, scaleX: 1, scaleY: 1, opacity: e.opacity ?? 1, visible: !e.hidden, draggable: !e.locked, listening: !e.locked,
    shadowEnabled: blur > 0, shadowColor: '#000', shadowOpacity: 0.38, shadowBlur: blur, shadowOffsetY: blur * 0.4 });
  const outline = { stroke: e.stroke || INK, strokeWidth: e.sw || 0, strokeEnabled: (e.sw || 0) > 0 };
  if (e.type === 'rect') n.setAttrs({ width: e.w, height: e.h, fill: e.fill, cornerRadius: Math.min(e.radius || 0, e.w / 2, e.h / 2), ...outline });
  else if (e.type === 'ellipse') n.setAttrs({ radiusX: e.w / 2, radiusY: e.h / 2, offsetX: -e.w / 2, offsetY: -e.h / 2, fill: e.fill, ...outline });
  else if (e.type === 'poly') n.setAttrs({ points: polyPoints(e.shape, e.w, e.h), closed: true, lineJoin: 'round', fill: e.fill, ...outline });
  else if (e.type === 'line') n.setAttrs({ points: [0, 0, e.w, 0], stroke: e.stroke, fill: e.stroke, strokeWidth: e.sw, lineCap: 'round', hitStrokeWidth: Math.max(20, e.sw),
    pointerLength: e.arrow ? e.sw * 3.5 : 0, pointerWidth: e.arrow ? e.sw * 3.5 : 0 });
  else if (e.type === 'text') n.setAttrs({ text: e.text, width: e.w, fontFamily: e.font, fontSize: e.size, fontStyle: [e.bold && 'bold', e.italic && 'italic'].filter(Boolean).join(' ') || 'normal',
    align: e.align, lineHeight: e.lh, letterSpacing: e.ls || 0, fill: e.fill, textDecoration: e.under ? 'underline' : '' });
  else if (e.type === 'image') {
    const s = imageFor(e), c = e.crop;
    n.setAttrs({ image: s.img, width: e.w, height: e.h, cornerRadius: Math.min(e.radius || 0, e.w / 2, e.h / 2),
      crop: c ? { x: c.x * s.k, y: c.y * s.k, width: c.w * s.k, height: c.h * s.k } : { x: 0, y: 0, width: 0, height: 0 } });
  }
}
function shapeFor(e) {
  const n = new CTORS[e.type]({ id: e.id });
  applyAttrs(e, n);
  return n;
}
function readNode(e) {                 // copy a drag or resize on the canvas back into the element
  const n = nodes.get(e.id), sx = n.scaleX(), sy = n.scaleY();
  e.x = n.x(); e.y = n.y(); e.rot = n.rotation();
  if (e.type === 'text') { e.size = Math.max(4, Math.round(e.size * sy)); e.w = Math.max(20, n.width() * sx); }
  else if (e.type === 'line') e.w = Math.max(6, e.w * sx);
  else { e.w = Math.max(6, e.w * sx); e.h = Math.max(6, e.h * sy); }
  applyAttrs(e, n);
}
function makeNode(e) {
  const n = shapeFor(e);
  n.on('mousedown touchstart', (ev) => {
    if (ev.evt.button > 0 || panKey) return;
    const multi = ev.evt.shiftKey;
    if (multi) select(sel.includes(e.id) ? sel.filter((i) => i !== e.id) : [...sel, e.id]);
    else if (!sel.includes(e.id)) select([e.id]);
  });
  n.on('dragmove', () => { if (sel.length === 1) snap(n); });
  n.on('dragend', () => { guides.destroyChildren(); sel.map(byId).forEach(readNode); commit(); renderProps(); });
  if (e.type === 'text') {
    n.on('transform', () => {          // side handles re-wrap the text instead of stretching it
      if (['middle-left', 'middle-right'].includes(tr.getActiveAnchor())) { n.width(Math.max(20, n.width() * n.scaleX())); n.scaleX(1); }
    });
    n.on('dblclick dbltap', () => editText(e.id));
  }
  if (e.type === 'image') n.on('dblclick dbltap', () => startCrop(e.id));
  nodes.set(e.id, n);
  page.add(n);
  return n;
}
function rebuild() {
  nodes.forEach((n) => n.destroy());
  nodes.clear();
  doc.els = doc.els.filter((e) => CTORS[e.type]);
  doc.els.forEach(makeNode);
  syncPage();
  $('#doc-name').value = doc.name;
  select(sel);
  applyView();
  renderPages();
}

/* ---------- snapping ---------- */
function snap(n) {
  guides.destroyChildren();
  const b = n.getClientRect({ relativeTo: page, skipShadow: true }), th = 6 / view.z;
  const xs = [0, doc.w / 2, doc.w], ys = [0, doc.h / 2, doc.h];
  nodes.forEach((o, id) => {
    if (id === n.id() || !o.visible()) return;
    const r = o.getClientRect({ relativeTo: page, skipShadow: true });
    xs.push(r.x, r.x + r.width / 2, r.x + r.width);
    ys.push(r.y, r.y + r.height / 2, r.y + r.height);
  });
  const best = (stops, vals) => {
    let hit = null;
    for (const s of stops) for (const v of vals) if (Math.abs(s - v) <= th && (!hit || Math.abs(s - v) < Math.abs(hit.d))) hit = { d: s - v, at: s };
    return hit;
  };
  const gx = best(xs, [b.x, b.x + b.width / 2, b.x + b.width]), gy = best(ys, [b.y, b.y + b.height / 2, b.y + b.height]);
  const line = (pts) => guides.add(new Konva.Line({ points: pts, stroke: BLADE, strokeWidth: 1, strokeScaleEnabled: false, dash: [5, 4] }));
  const ext = 30 / view.z;
  if (gx) { n.x(n.x() + gx.d); line([gx.at, -ext, gx.at, doc.h + ext]); }
  if (gy) { n.y(n.y() + gy.d); line([-ext, gy.at, doc.w + ext, gy.at]); }
}

/* ---------- selection ---------- */
function select(ids) {
  sel = [...new Set(ids)].filter((id) => nodes.has(id));
  const E = sel.map(byId), locked = E.some((e) => e.locked);
  tr.nodes(sel.map((id) => nodes.get(id)));
  tr.resizeEnabled(!locked); tr.rotateEnabled(!locked);
  const only = E.length === 1 ? E[0].type : null;
  tr.enabledAnchors(only === 'line' ? ['middle-left', 'middle-right']
    : only === 'text' ? ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'middle-left', 'middle-right']
    : ['top-left', 'top-center', 'top-right', 'middle-right', 'bottom-right', 'bottom-center', 'bottom-left', 'middle-left']);
  tr.keepRatio(only === 'text' || only === 'image' || E.length > 1);
  renderProps(); renderLayers();
  stage.batchDraw();
}
tr.on('transformend', () => { sel.map(byId).forEach(readNode); tr.forceUpdate(); commit(); renderProps(); });

/* ---------- history and saving ---------- */
const hist = []; let hi = -1;
const snapshot = () => JSON.stringify(doc);
function commit() {
  const s = snapshot();
  if (hist[hi] !== s) { hist.splice(hi + 1); hist.push(s); if (hist.length > 100) hist.shift(); hi = hist.length - 1; }
  syncHistoryButtons(); renderLayers(); renderPages(); save();
}
function restore(s) { endCrop(false); Object.assign(doc, JSON.parse(s)); rebuild(); syncHistoryButtons(); save(); }
function undo() { if (hi > 0) restore(hist[--hi]); }
function redo() { if (hi < hist.length - 1) restore(hist[++hi]); }
function syncHistoryButtons() { $('#undo').disabled = hi <= 0; $('#redo').disabled = hi >= hist.length - 1; }

const db = new Promise((res, rej) => {
  const r = indexedDB.open('cutmat-design', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
db.catch(() => {});
const idb = {
  get: (k) => db.then((d) => new Promise((res, rej) => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); })),
  set: (k, v) => db.then((d) => new Promise((res, rej) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); })),
  del: (k) => db.then((d) => new Promise((res, rej) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = res; t.onerror = () => rej(t.error); })),
  designs: () => db.then((d) => new Promise((res, rej) => { const q = d.transaction('kv').objectStore('kv').getAll(IDBKeyRange.bound('d:', 'd:\uffff')); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); })),
};
let designId = newId('d');             // every design is kept in this browser under 'd:<id>'
function bundle() {
  const used = {};
  doc.pages.forEach((p) => p.els.forEach((e) => { if (e.asset && assets.has(e.asset)) used[e.asset] = assets.get(e.asset).src; }));
  return { app: 'cutmat-design', v: 1, id: designId, updated: Date.now(), doc: JSON.parse(snapshot()), assets: used };
}
let saveTimer;
const isBlank = () => doc.pages.every((p) => !p.els.length);
function storeNow() {
  clearTimeout(saveTimer);
  const b = bundle(), p = doc.pages[0];
  try { b.thumb = thumbOf({ w: doc.w, h: doc.h, bg: p.bg, els: p.els }, 280, true); } catch { /* a card without a picture still opens */ }
  return Promise.all([idb.set('d:' + designId, b), idb.set('last', designId)])
    .then(() => queuePush(b.id), () => say('This browser could not keep the design. Use File, then Save a copy.'));
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(storeNow, 400);
}
async function leaveDesign() {         // before switching designs: keep this one, unless nothing was ever put on it
  endCrop(false);
  if (editing) ta.blur();
  clearTimeout(saveTimer);
  if (isBlank()) await idb.del('d:' + designId).catch(() => {}); else await storeNow();
}
function resetHistory() { hist.length = 0; hi = -1; commit(); }
function blankDesign(w, h) {
  designId = newId('d');
  Object.assign(doc, { name: 'Untitled design', w, h, pages: [newPage()], cur: 0 });
  sel = [];
  rebuild(); fit(); resetHistory();
}
function loadAsset(id, src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => { assets.set(id, { src, img }); res(img); };
    img.onerror = () => rej(new Error('image failed to load'));
    img.src = src;
  });
}
async function loadBundle(b) {
  if (!b || b.app !== 'cutmat-design' || !b.doc) throw new Error('not a Cutmat design');
  const d = b.doc, pagesIn = Array.isArray(d.pages) ? d.pages : [{ bg: d.bg, els: d.els }];   // older copies held one page
  await Promise.all(Object.entries(b.assets || {}).map(([id, src]) => (typeof src === 'string' && src.startsWith('data:image/') ? loadAsset(id, src).catch(() => {}) : null)));
  const okEl = (e) => e && CTORS[e.type] && (e.type !== 'image' || assets.has(e.asset));
  const pages = pagesIn.filter((p) => p && Array.isArray(p.els)).map((p) => newPage(typeof p.bg === 'string' ? p.bg : '#ffffff', p.els.filter(okEl)));
  if (!pages.length) throw new Error('not a Cutmat design');
  Object.assign(doc, { name: String(d.name || 'Untitled design').slice(0, 60), w: clamp(+d.w || 1080, 16, 8000), h: clamp(+d.h || 1080, 16, 8000),
    pages, cur: clamp(Math.round(+d.cur) || 0, 0, pages.length - 1) });
  designId = typeof b.id === 'string' && b.id ? b.id : newId('d');
  sel = [];
  rebuild(); fit(); renderUploads();
}

/* ---------- status line ---------- */
let sayTimer;
function setStats() { $('#stats').textContent = `${doc.w} × ${doc.h} px` + (doc.pages.length > 1 ? ` · Page ${doc.cur + 1} of ${doc.pages.length}` : ''); }
function say(msg) { $('#stats').textContent = msg; clearTimeout(sayTimer); sayTimer = setTimeout(setStats, 4500); }

/* ---------- adding things ---------- */
function add(e) {
  e.id = newId('e');
  doc.els.push(e);
  makeNode(e);
  select([e.id]);
  commit();
  return e;
}
function addText(kind) {
  const base = Math.min(doc.w, doc.h);
  const k = { heading: ['Your heading', 0.09, 'Bricolage Grotesque', true], sub: ['A subheading', 0.05, 'Instrument Sans', true], body: ['Body text. Double-click to change it.', 0.03, 'Instrument Sans', false] }[kind];
  const size = Math.round(base * k[1]), w = Math.round(doc.w * 0.7);
  add(T(k[0], (doc.w - w) / 2, doc.h / 2 - size * 0.6, w, size, k[2], INK, { bold: k[3], align: 'center' }));
}
function addShape(kind) {
  const s = Math.round(Math.min(doc.w, doc.h) * 0.3), x = (doc.w - s) / 2, y = (doc.h - s) / 2;
  if (kind === 'line' || kind === 'arrow') return add({ type: 'line', x, y: doc.h / 2, w: s, h: 0, stroke: INK, sw: Math.max(3, Math.round(s / 50)), arrow: kind === 'arrow' });
  if (kind === 'rect' || kind === 'round') return add(R(x, y + s * 0.15, s, s * 0.7, MAT, { radius: kind === 'round' ? Math.round(s * 0.12) : 0 }));
  if (kind === 'ellipse') return add({ type: 'ellipse', x, y, w: s, h: s, fill: MAT, stroke: INK, sw: 0 });
  add({ type: 'poly', shape: kind, x, y, w: s, h: s, fill: MAT, stroke: INK, sw: 0 });
}
function placeImage(id) {
  const img = assets.get(id).img, iw = img.naturalWidth || 300, ih = img.naturalHeight || 300;
  const s = Math.min(doc.w * 0.6 / iw, doc.h * 0.6 / ih, 1), w = iw * s, h = ih * s;
  add({ type: 'image', asset: id, x: (doc.w - w) / 2, y: (doc.h - h) / 2, w, h, radius: 0 });
}
const readURL = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(f); });
async function addImages(files) {
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    try { const id = newId('a'); await loadAsset(id, await readURL(f)); placeImage(id); }
    catch { say(`${f.name} could not be opened as an image.`); }
  }
  renderUploads();
}
function applyTemplate(t) {
  Object.assign(doc, { w: t.w, h: t.h, bg: t.bg, els: t.els.map((e) => ({ ...e, id: newId('e') })) });
  sel = [];
  rebuild(); fit(); commit();
  say('Template applied. Undo brings your design back.');
}

/* ---------- pages ---------- */
function goPage(i) {
  if (i === doc.cur || !doc.pages[i]) return;
  doc.cur = i; sel = [];
  rebuild(); save();
}
function addPage(copy) {
  const p = doc.pages[doc.cur];
  doc.pages.splice(doc.cur + 1, 0, copy ? newPage(p.bg, p.els.map((e) => ({ ...e, id: newId('e') }))) : newPage());
  doc.cur++; sel = [];
  rebuild(); commit();
}
function deletePage() {
  if (doc.pages.length < 2) return;
  doc.pages.splice(doc.cur, 1);
  doc.cur = Math.min(doc.cur, doc.pages.length - 1); sel = [];
  rebuild(); commit();
  say('Page deleted. Undo brings it back.');
}
function movePage(d) {
  const j = doc.cur + d;
  if (!doc.pages[j]) return;
  [doc.pages[doc.cur], doc.pages[j]] = [doc.pages[j], doc.pages[doc.cur]];
  doc.cur = j;
  commit(); setStats(); renderProps();
}
let pagesTimer;
function renderPages() {
  setStats();
  clearTimeout(pagesTimer);
  pagesTimer = setTimeout(() => {
    const tw = clamp(Math.round(56 * doc.w / doc.h), 24, 150);
    $('#pages').replaceChildren(
      ...doc.pages.map((p, i) => el('button', { type: 'button', class: 'pg', 'aria-current': String(i === doc.cur), 'aria-label': `Page ${i + 1}`, onclick: () => goPage(i) },
        el('img', { src: thumbOf({ w: doc.w, h: doc.h, bg: p.bg, els: p.els }, tw), alt: '' }), el('span', {}, String(i + 1)))),
      el('button', { type: 'button', class: 'pg-add', onclick: () => addPage(false) }, 'Add page'));
  }, 120);
}

/* ---------- editing actions ---------- */
function removeSel() {
  if (!sel.length) return;
  doc.els = doc.els.filter((e) => !sel.includes(e.id));
  sel.forEach((id) => { nodes.get(id).destroy(); nodes.delete(id); });
  select([]); commit();
}
let clip = [];
function copySel() { clip = sel.map(byId).map((e) => ({ ...e })); }
function pasteClip(off = 24) {
  if (!clip.length) return;
  const ids = clip.map((c) => { const e = { ...c, id: newId('e'), x: c.x + off, y: c.y + off, locked: false }; doc.els.push(e); makeNode(e); return e.id; });
  clip = clip.map((c) => ({ ...c, x: c.x + off, y: c.y + off }));
  select(ids); commit();
}
function duplicateSel() { const keep = clip; copySel(); pasteClip(); clip = keep; }
function reorder(how) {
  const picked = doc.els.filter((e) => sel.includes(e.id)), rest = doc.els.filter((e) => !sel.includes(e.id));
  if (how === 'front') doc.els = [...rest, ...picked];
  else if (how === 'back') doc.els = [...picked, ...rest];
  else {
    const a = doc.els.slice(), step = how === 'up' ? 1 : -1;
    const order = how === 'up' ? a.map((_, i) => a.length - 1 - i) : a.map((_, i) => i);
    for (const i of order) { const j = i + step; if (sel.includes(a[i].id) && a[j] && !sel.includes(a[j].id)) [a[i], a[j]] = [a[j], a[i]]; }
    doc.els = a;
  }
  doc.els.forEach((e) => nodes.get(e.id).moveToTop());
  stage.batchDraw(); commit();
}
function alignSel(how) {
  sel.map(byId).forEach((e) => {
    if (e.locked) return;
    const n = nodes.get(e.id), b = n.getClientRect({ relativeTo: page, skipShadow: true });
    if (how === 'left') e.x -= b.x;
    if (how === 'center') e.x += (doc.w - b.width) / 2 - b.x;
    if (how === 'right') e.x += doc.w - b.width - b.x;
    if (how === 'top') e.y -= b.y;
    if (how === 'middle') e.y += (doc.h - b.height) / 2 - b.y;
    if (how === 'bottom') e.y += doc.h - b.height - b.y;
    applyAttrs(e, n);
  });
  tr.forceUpdate(); stage.batchDraw(); commit(); renderProps();
}
let nudgeTimer;
function nudge(dx, dy) {
  sel.map(byId).forEach((e) => { if (!e.locked) { e.x += dx; e.y += dy; applyAttrs(e, nodes.get(e.id)); } });
  tr.forceUpdate(); stage.batchDraw();
  clearTimeout(nudgeTimer); nudgeTimer = setTimeout(() => { commit(); renderProps(); }, 400);
}

/* ---------- typing into text ---------- */
function editText(id) {
  const e = byId(id), n = nodes.get(id);
  if (!e || e.locked) return;
  select([id]);
  editing = id;
  const p = n.getAbsolutePosition(), z = view.z;
  n.hide(); tr.hide(); stage.batchDraw();
  Object.assign(ta.style, {
    display: 'block', left: p.x + 'px', top: p.y + 'px', width: e.w * z + 'px',
    fontFamily: `"${e.font}"`, fontSize: e.size * z + 'px', fontWeight: e.bold ? 700 : 400, fontStyle: e.italic ? 'italic' : 'normal',
    lineHeight: e.lh, letterSpacing: (e.ls || 0) * z + 'px', textAlign: e.align, color: e.fill, transform: `rotate(${e.rot || 0}deg)`,
  });
  ta.value = e.text;
  ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px';
  ta.focus(); ta.select();
}
function endEdit() {
  if (!editing) return;
  const id = editing, e = byId(id);
  editing = null;
  ta.style.display = 'none';
  tr.show();
  if (!e) return;
  if (!ta.value.trim()) { sel = [id]; removeSel(); return; }
  e.text = ta.value;
  applyAttrs(e, nodes.get(id));
  tr.forceUpdate(); stage.batchDraw(); commit();
}
ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; });
ta.addEventListener('blur', endEdit);
ta.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') ta.blur(); ev.stopPropagation(); });

/* ---------- cropping an image ---------- */
let crop = null;
const cropT = new Konva.Transformer({
  rotateEnabled: false, keepRatio: false, flipEnabled: false, ignoreStroke: true,
  anchorFill: MARK, anchorStroke: INK, anchorStrokeWidth: 1.5, anchorSize: 11, anchorCornerRadius: 2,
  borderStroke: MARK, borderStrokeWidth: 1.5,
});
ui.add(cropT);
function setCrop(e, c, kx, ky, r) {    // r: the kept box, in the image's own unrotated space
  const a = (e.rot || 0) * Math.PI / 180;
  e.x += r.x * Math.cos(a) - r.y * Math.sin(a);
  e.y += r.x * Math.sin(a) + r.y * Math.cos(a);
  e.crop = { x: c.x + r.x / kx, y: c.y + r.y / ky, w: r.w / kx, h: r.h / ky };
  e.w = r.w; e.h = r.h;
}
function cropFrame(e) {                // where the whole picture sits relative to the element's box
  const [iw, ih] = natural(assets.get(e.asset).img), c = e.crop || { x: 0, y: 0, w: iw, h: ih };
  const kx = e.w / c.w, ky = e.h / c.h;
  return { c, kx, ky, full: { x: -c.x * kx, y: -c.y * ky, w: iw * kx, h: ih * ky } };
}
function uncrop(e) {
  const { c, kx, ky, full } = cropFrame(e);
  setCrop(e, c, kx, ky, full);
  delete e.crop;
}
function startCrop(id) {
  const e = byId(id);
  if (!e || e.type !== 'image' || e.locked || !assets.has(e.asset) || crop) return;
  if (editing) ta.blur();
  select([id]);
  const { c, kx, ky, full } = cropFrame(e), src = imageFor(e).img;
  const g = new Konva.Group({ x: e.x, y: e.y, rotation: e.rot || 0 });
  const pic = (o) => new Konva.Image({ image: src, x: full.x, y: full.y, width: full.w, height: full.h, listening: false, ...o });
  const rect = new Konva.Rect({ x: 0, y: 0, width: e.w, height: e.h, draggable: true, fill: 'rgba(0,0,0,0)' });
  const lit = new Konva.Group({ listening: false, clipFunc: (ctx) => ctx.rect(rect.x(), rect.y(), rect.width() * rect.scaleX(), rect.height() * rect.scaleY()) });
  lit.add(pic());
  g.add(new Konva.Rect({ x: full.x, y: full.y, width: full.w, height: full.h, fill: INK, listening: false }), pic({ opacity: 0.35 }), lit, rect);
  rect.on('dragmove', () => rect.position({ x: clamp(rect.x(), full.x, full.x + full.w - rect.width()), y: clamp(rect.y(), full.y, full.y + full.h - rect.height()) }));
  rect.on('transform', () => {         // keep the box inside the picture
    let x = rect.x(), y = rect.y(), w = rect.width() * rect.scaleX(), h = rect.height() * rect.scaleY();
    if (x < full.x) { w -= full.x - x; x = full.x; }
    if (y < full.y) { h -= full.y - y; y = full.y; }
    w = clamp(w, 8, full.x + full.w - x); h = clamp(h, 8, full.y + full.h - y);
    if (crop.ratio) { if (w / h > crop.ratio) w = h * crop.ratio; else h = w / crop.ratio; }
    rect.setAttrs({ x, y, width: w, height: h, scaleX: 1, scaleY: 1 });
  });
  nodes.get(id).hide(); tr.hide();
  ui.add(g); cropT.nodes([rect]); cropT.keepRatio(false); cropT.moveToTop();
  page.listening(false);
  crop = { e, g, rect, c, kx, ky, ratio: 0 };
  renderProps(); stage.batchDraw();
}
function cropRatio(r) {
  const { rect } = crop;
  crop.ratio = r; cropT.keepRatio(!!r);
  if (r) {
    const w = rect.width(), h = rect.height(), nw = Math.min(w, h * r), nh = nw / r;
    rect.setAttrs({ x: rect.x() + (w - nw) / 2, y: rect.y() + (h - nh) / 2, width: nw, height: nh });
  }
  cropT.forceUpdate(); stage.batchDraw();
}
function endCrop(apply) {
  if (!crop) return;
  const { e, g, rect, c, kx, ky } = crop, r = { x: rect.x(), y: rect.y(), w: rect.width(), h: rect.height() };
  crop = null;
  cropT.nodes([]); g.destroy(); tr.show();
  page.listening(!panKey);
  if (apply) setCrop(e, c, kx, ky, r);
  if (nodes.has(e.id)) applyAttrs(e, nodes.get(e.id));
  select([e.id]);
  if (apply) commit();
}
document.addEventListener('mousedown', (ev) => { if (crop && !ev.target.closest('#stage-wrap, #props')) endCrop(true); }, true);

/* ---------- pointer: marquee, pan, zoom ---------- */
let panKey = false, drag = null;
stage.on('mousedown touchstart', (ev) => {
  const evt = ev.evt, pt = evt.touches ? evt.touches[0] : evt;
  if (editing) ta.blur();              // the canvas does not take focus, so finish typing by hand
  if (evt.button === 1 || panKey) {
    evt.preventDefault();
    drag = { pan: true, sx: pt.clientX, sy: pt.clientY, vx: view.x, vy: view.y };
    return;
  }
  if (crop) { if (ev.target === stage) endCrop(true); return; }
  if (ev.target !== stage && ev.target !== bg) return;
  if (!evt.shiftKey) select([]);
  const p = page.getRelativePointerPosition();
  drag = { x: p.x, y: p.y, keep: evt.shiftKey ? [...sel] : [] };
  marquee.setAttrs({ x: p.x, y: p.y, width: 0, height: 0, visible: true });
});
function onMove(evt) {
  if (!drag) return;
  const pt = evt.touches ? evt.touches[0] : evt;
  if (drag.pan) { view.auto = false; view.x = drag.vx + pt.clientX - drag.sx; view.y = drag.vy + pt.clientY - drag.sy; applyView(); return; }
  stage.setPointersPositions(evt);
  const p = page.getRelativePointerPosition();
  marquee.setAttrs({ x: Math.min(p.x, drag.x), y: Math.min(p.y, drag.y), width: Math.abs(p.x - drag.x), height: Math.abs(p.y - drag.y) });
  ui.batchDraw();
}
function onUp() {
  if (!drag) return;
  if (!drag.pan) {
    const m = { x: marquee.x(), y: marquee.y(), width: marquee.width(), height: marquee.height() };
    marquee.visible(false);
    if (m.width > 3 || m.height > 3) {
      const hit = doc.els.filter((e) => !e.locked && !e.hidden && Konva.Util.haveIntersection(m, nodes.get(e.id).getClientRect({ relativeTo: page, skipShadow: true }))).map((e) => e.id);
      select([...drag.keep, ...hit]);
    }
    ui.batchDraw();
  }
  drag = null;
}
window.addEventListener('mousemove', onMove);
window.addEventListener('touchmove', onMove, { passive: true });
window.addEventListener('mouseup', onUp);
window.addEventListener('touchend', onUp);
host.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  if (ev.ctrlKey || ev.metaKey) {
    const r = host.getBoundingClientRect();
    zoomTo(view.z * Math.exp(-ev.deltaY * 0.0022), ev.clientX - r.left, ev.clientY - r.top);
  } else { view.auto = false; view.x -= ev.shiftKey ? ev.deltaY : ev.deltaX; view.y -= ev.shiftKey ? 0 : ev.deltaY; applyView(); }
}, { passive: false });

/* ---------- keyboard ---------- */
const typing = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
window.addEventListener('keydown', (ev) => {
  if (typing(ev.target) || document.querySelector('dialog[open]')) return;
  const mod = ev.ctrlKey || ev.metaKey, k = ev.key.toLowerCase();
  if (ev.code === 'Space') { if (ev.target.tagName === 'BUTTON' || ev.target.tagName === 'SUMMARY') return; ev.preventDefault(); if (!panKey) { panKey = true; page.listening(false); host.classList.add('panning'); } return; }
  if (crop) { if (k === 'enter') endCrop(true); else if (k === 'escape') endCrop(false); return; }
  if (mod && k === 'z') { ev.preventDefault(); ev.shiftKey ? redo() : undo(); }
  else if (mod && k === 'y') { ev.preventDefault(); redo(); }
  else if (mod && k === 'd') { ev.preventDefault(); duplicateSel(); }
  else if (mod && k === 'c') copySel();
  else if (mod && k === 'a') { ev.preventDefault(); select(doc.els.filter((e) => !e.locked && !e.hidden).map((e) => e.id)); }
  else if (mod && k === '0') { ev.preventDefault(); fit(); }
  else if (k === 'delete' || k === 'backspace') { ev.preventDefault(); removeSel(); }
  else if (k === 'escape') select([]);
  else if (k === 'pagedown' || k === 'pageup') { ev.preventDefault(); goPage(doc.cur + (k === 'pagedown' ? 1 : -1)); }
  else if (k.startsWith('arrow') && sel.length) {
    ev.preventDefault();
    const d = ev.shiftKey ? 10 : 1;
    nudge(k === 'arrowleft' ? -d : k === 'arrowright' ? d : 0, k === 'arrowup' ? -d : k === 'arrowdown' ? d : 0);
  }
});
window.addEventListener('keyup', (ev) => { if (ev.code === 'Space' && panKey) { panKey = false; page.listening(!crop); host.classList.remove('panning'); } });
window.addEventListener('paste', (ev) => {
  if (typing(ev.target) || document.querySelector('dialog[open]')) return;
  const files = [...(ev.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
  if (files.length) { ev.preventDefault(); addImages(files); } else pasteClip();
});
const mat = $('#mat');
mat.addEventListener('dragover', (ev) => { ev.preventDefault(); document.body.classList.add('dragging'); });
mat.addEventListener('dragleave', () => document.body.classList.remove('dragging'));
mat.addEventListener('drop', (ev) => { ev.preventDefault(); document.body.classList.remove('dragging'); addImages([...ev.dataTransfer.files]); });

/* ---------- right panel: properties ---------- */
const field = (label, input, out) => el('label', { class: 'field' }, el('span', { class: 'lab' }, label, out), input);
function numF(label, val, min, max, on) {
  const i = el('input', { type: 'number', min, max, value: Math.round(val) });
  i.addEventListener('input', () => { if (i.value !== '' && +i.value >= min) on(clamp(+i.value, min, max), false); });
  i.addEventListener('change', () => { const v = Math.round(+i.value); i.value = clamp(Number.isFinite(v) ? v : min, min, max); on(+i.value, true); });
  return field(label, i);
}
function colorF(label, val, on) {
  const i = el('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(val) ? val : '#000000' });
  i.addEventListener('input', () => on(i.value, false));
  i.addEventListener('change', () => on(i.value, true));
  return field(label, i);
}
function rangeF(label, val, min, max, step, fmt, on) {
  const out = el('output', {}, fmt(val));
  const i = el('input', { type: 'range', min, max, step, value: val });
  i.addEventListener('input', () => { out.textContent = fmt(+i.value); on(+i.value, false); });
  i.addEventListener('change', () => on(+i.value, true));
  return field(label, i, out);
}
function selectF(label, val, opts, on) {
  const s = el('select', {}, ...opts.map(([v, t]) => el('option', { value: v }, t)));
  s.value = val;
  s.addEventListener('change', () => on(s.value, true));
  return field(label, s);
}
const actions = (cls, ...btns) => el('div', { class: 'seg ' + cls }, ...btns.map(([t, fn, aria]) => el('button', { type: 'button', class: 'btn', onclick: fn, 'aria-label': aria || t }, t)));
function toggle(label, on, fn) {
  const b = el('button', { type: 'button', class: 'btn', 'aria-pressed': String(on) }, label);
  b.addEventListener('click', () => { const v = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(v)); fn(v); });
  return b;
}

function renderProps() {
  const box = $('#props');
  box.replaceChildren();
  if (crop) return cropProps(box);
  const E = sel.map(byId).filter(Boolean);
  if (!E.length) return pageProps(box);
  const one = E[0], all = (...t) => E.every((e) => t.includes(e.type));
  const set = (k) => (v, final) => {
    E.forEach((e) => { e[k] = v; applyAttrs(e, nodes.get(e.id)); });
    tr.forceUpdate(); stage.batchDraw();
    if (final) commit();
  };
  const NAMES = { text: 'Text', image: 'Image', line: 'Line', rect: 'Shape', ellipse: 'Shape', poly: 'Shape' };
  box.append(el('h2', {}, E.length > 1 ? `${E.length} items` : NAMES[one.type]));
  box.append(actions('', ['Duplicate', duplicateSel], ['Delete', removeSel],
    [E.every((e) => e.locked) ? 'Unlock' : 'Lock', () => { const v = !E.every((e) => e.locked); E.forEach((e) => { e.locked = v; applyAttrs(e, nodes.get(e.id)); }); select(sel); commit(); }]));

  if (all('text')) {
    box.append(selectF('Font', one.font, FONTS.map((f) => [f, f]), (v, f) => { document.fonts.load(`16px "${v}"`).finally(() => { tr.forceUpdate(); stage.batchDraw(); }); set('font')(v, f); }));
    box.append(el('div', { class: 'two' }, numF('Size', one.size, 4, 1000, set('size')), colorF('Colour', one.fill, set('fill'))));
    box.append(el('div', { class: 'seg' }, toggle('Bold', one.bold, (v) => set('bold')(v, true)), toggle('Italic', one.italic, (v) => set('italic')(v, true)), toggle('Underline', one.under, (v) => set('under')(v, true))));
    const al = el('div', { class: 'seg', role: 'group', 'aria-label': 'Text alignment' });
    for (const a of ['left', 'center', 'right']) al.append(el('button', { type: 'button', class: 'btn', 'aria-pressed': String(one.align === a),
      onclick: () => { [...al.children].forEach((b, i) => b.setAttribute('aria-pressed', String(['left', 'center', 'right'][i] === a))); set('align')(a, true); } }, a[0].toUpperCase() + a.slice(1)));
    box.append(al);
    box.append(rangeF('Line spacing', one.lh, 0.8, 2.5, 0.05, (v) => v.toFixed(2), set('lh')));
    box.append(rangeF('Letter spacing', one.ls || 0, -10, 40, 0.5, (v) => v + ' px', set('ls')));
  } else if (all('rect', 'ellipse', 'poly')) {
    box.append(colorF('Colour', one.fill, set('fill')));
    box.append(el('div', { class: 'two' }, colorF('Outline', one.stroke || INK, set('stroke')), numF('Outline width', one.sw || 0, 0, 200, set('sw'))));
  } else if (all('line')) {
    box.append(el('div', { class: 'two' }, colorF('Colour', one.stroke, set('stroke')), numF('Thickness', one.sw, 1, 200, set('sw'))));
    const c = el('input', { type: 'checkbox', checked: !!one.arrow });
    c.addEventListener('change', () => set('arrow')(c.checked, true));
    box.append(el('label', { class: 'check' }, c, 'Arrowhead'));
  }
  if (all('image')) imageProps(box, E);
  if (all('rect', 'image')) box.append(rangeF('Rounded corners', one.radius || 0, 0, Math.round(Math.min(doc.w, doc.h) / 2), 1, (v) => v + ' px', set('radius')));
  box.append(rangeF('Opacity', Math.round((one.opacity ?? 1) * 100), 5, 100, 1, (v) => v + '%', (v, f) => set('opacity')(v / 100, f)));
  box.append(rangeF('Shadow', one.shadow || 0, 0, 100, 1, (v) => (v ? String(v) : 'Off'), set('shadow')));
  if (E.length === 1 && !one.locked) geometryProps(box, one);

  box.append(el('p', { class: 'group-lab' }, 'Place on page'));
  box.append(actions('three', ['Left', () => alignSel('left')], ['Centre', () => alignSel('center')], ['Right', () => alignSel('right')],
    ['Top', () => alignSel('top')], ['Middle', () => alignSel('middle')], ['Bottom', () => alignSel('bottom')]));
  box.append(el('p', { class: 'group-lab' }, 'Stacking order'));
  box.append(actions('', ['Forward', () => reorder('up')], ['Backward', () => reorder('down')]));
  box.append(actions('', ['To front', () => reorder('front')], ['To back', () => reorder('back')]));
}
function imageProps(box, E) {
  const one = E[0], f = { ...FX0, ...one.fx };
  if (E.length === 1) {
    const btns = [['Crop', () => startCrop(one.id)]];
    if (one.crop) btns.push(['Undo crop', () => { uncrop(one); applyAttrs(one, nodes.get(one.id)); select(sel); commit(); }, 'Show the whole image again']);
    box.append(actions('', ...btns));
    const flip = (k) => () => {
      one[k] = !one[k];
      if (one.crop) {                  // the crop is measured on the picture as shown, so mirror it too
        const [iw, ih] = natural(assets.get(one.asset).img), c = one.crop;
        one.crop = k === 'flipX' ? { ...c, x: iw - c.x - c.w } : { ...c, y: ih - c.y - c.h };
      }
      applyAttrs(one, nodes.get(one.id)); stage.batchDraw(); commit();
    };
    box.append(actions('', ['Flip sideways', flip('flipX')], ['Flip upside down', flip('flipY')]));
    box.append(actions('', ['Fill the page', () => fillPage(one), 'Stretch this image over the whole page, behind everything else']));
  }
  if (!FX_OK) return box.append(el('p', { class: 'hint' }, 'Image adjustments need a current version of Chrome, Edge, Firefox or Safari.'));
  const fx = (k) => (v, final) => {
    fxLive = !final;
    E.forEach((e) => { e.fx = { ...FX0, ...e.fx, [k]: v }; applyAttrs(e, nodes.get(e.id)); });
    fxLive = false;
    stage.batchDraw();
    if (final) commit();
  };
  box.append(el('p', { class: 'group-lab' }, 'Adjust'));
  box.append(selectF('Look', f.look, Object.entries(LOOKS).map(([k, v]) => [k, v[0]]), fx('look')));
  box.append(rangeF('Brightness', f.bri, 40, 160, 1, (v) => v - 100 + '', fx('bri')));
  box.append(rangeF('Contrast', f.con, 40, 160, 1, (v) => v - 100 + '', fx('con')));
  box.append(rangeF('Saturation', f.sat, 0, 200, 1, (v) => v - 100 + '', fx('sat')));
  box.append(rangeF('Blur', f.blur, 0, 40, 0.5, (v) => v + ' px', fx('blur')));
  box.append(actions('', ['Reset adjustments', () => { E.forEach((e) => { delete e.fx; applyAttrs(e, nodes.get(e.id)); }); stage.batchDraw(); renderProps(); commit(); }]));
}
function fillPage(e) {
  const [iw, ih] = natural(assets.get(e.asset).img), r = doc.w / doc.h, wide = iw / ih > r;
  const cw = wide ? ih * r : iw, ch = wide ? ih : iw / r;
  Object.assign(e, { crop: { x: (iw - cw) / 2, y: (ih - ch) / 2, w: cw, h: ch }, x: 0, y: 0, w: doc.w, h: doc.h, rot: 0, radius: 0 });
  applyAttrs(e, nodes.get(e.id));
  reorder('back');
  select(sel);
}
function geometryProps(box, e) {
  const n = nodes.get(e.id), ratio = e.h ? e.w / e.h : 1;
  const put = (fn) => (v, final) => { fn(v); applyAttrs(e, n); tr.forceUpdate(); stage.batchDraw(); if (final) commit(); };
  box.append(el('p', { class: 'group-lab' }, 'Position and size'));
  const xF = numF('X', e.x, -20000, 20000, put((v) => { e.x = v; })), yF = numF('Y', e.y, -20000, 20000, put((v) => { e.y = v; }));
  box.append(el('div', { class: 'two' }, xF, yF));
  const wF = numF(e.type === 'line' ? 'Length' : 'Width', e.w, 6, 20000, put((v) => { e.w = v; if (e.type === 'image') { e.h = v / ratio; hF.querySelector('input').value = Math.round(e.h); } }));
  const hF = e.type === 'text' || e.type === 'line' ? null : numF('Height', e.h, 6, 20000, put((v) => { e.h = v; if (e.type === 'image') { e.w = v * ratio; wF.querySelector('input').value = Math.round(e.w); } }));
  box.append(el('div', { class: 'two' }, wF, hF));
  box.append(rangeF('Rotation', Math.round(e.rot || 0), -180, 180, 1, (v) => v + '°', put((v) => {   // turn about the middle, as the handle does
    const hw = e.w / 2, hh = (e.type === 'text' ? n.height() : e.type === 'line' ? 0 : e.h) / 2;
    const a0 = (e.rot || 0) * Math.PI / 180, a1 = v * Math.PI / 180;
    const cx = e.x + hw * Math.cos(a0) - hh * Math.sin(a0), cy = e.y + hw * Math.sin(a0) + hh * Math.cos(a0);
    e.rot = v;
    e.x = cx - (hw * Math.cos(a1) - hh * Math.sin(a1)); e.y = cy - (hw * Math.sin(a1) + hh * Math.cos(a1));
    xF.querySelector('input').value = Math.round(e.x); yF.querySelector('input').value = Math.round(e.y);
  })));
}
function cropProps(box) {
  box.append(el('h2', {}, 'Crop'));
  box.append(el('p', { class: 'hint' }, 'Drag the box or its handles over the part to keep. Enter applies, Esc cancels.'));
  box.append(el('p', { class: 'group-lab' }, 'Shape'));
  const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Crop shape' });
  const RATIOS = [['Free', 0], ['1:1', 1], ['4:5', 0.8], ['16:9', 16 / 9]];
  for (const [t, r] of RATIOS) seg.append(el('button', { type: 'button', class: 'btn', 'aria-pressed': String(crop.ratio === r),
    onclick: () => { cropRatio(r); [...seg.children].forEach((b, i) => b.setAttribute('aria-pressed', String(RATIOS[i][1] === r))); } }, t));
  box.append(seg);
  const row = el('div', { class: 'seg' },
    el('button', { type: 'button', class: 'btn primary', onclick: () => endCrop(true) }, 'Apply crop'),
    el('button', { type: 'button', class: 'btn', onclick: () => endCrop(false) }, 'Cancel'));
  box.append(row);
}
let scaleOnResize = true;
function scaleAll(ow, oh, w, h) {      // keep every page's layout, centred, when the page size changes
  const k = Math.min(w / ow, h / oh), dx = (w - ow * k) / 2, dy = (h - oh * k) / 2;
  doc.pages.forEach((p) => p.els.forEach((e) => {
    e.x = e.x * k + dx; e.y = e.y * k + dy; e.w *= k;
    if (e.h) e.h *= k;
    if (e.size) e.size = Math.max(4, +(e.size * k).toFixed(1));
    if (e.sw) e.sw = Math.max(e.type === 'line' ? 1 : 0, +(e.sw * k).toFixed(1));
    if (e.radius) e.radius *= k;
    if (e.ls) e.ls = +(e.ls * k).toFixed(2);
  }));
}
function pageProps(box) {
  const preset = SIZES.find((s) => s[2] === doc.w && s[3] === doc.h);
  const resize = (w, h) => {
    if (w === doc.w && h === doc.h) return;
    if (scaleOnResize) scaleAll(doc.w, doc.h, w, h);
    doc.w = w; doc.h = h;
    rebuild(); fit(); commit();
  };
  box.append(el('h2', {}, 'Page'));
  if (doc.pages.length > 1) box.append(el('p', { class: 'hint' }, 'All pages share one size.'));
  box.append(selectF('Size', preset ? preset[0] : 'custom', [...SIZES.map((s) => [s[0], `${s[1]} (${s[2]} × ${s[3]})`]), ['custom', 'Custom size']],
    (v) => { const s = SIZES.find((x) => x[0] === v); if (s) resize(s[2], s[3]); }));
  box.append(el('div', { class: 'two' },
    numF('Width (px)', doc.w, 16, 8000, (v, f) => { if (f) resize(v, doc.h); }),
    numF('Height (px)', doc.h, 16, 8000, (v, f) => { if (f) resize(doc.w, v); })));
  if (!isBlank()) {
    const c = el('input', { type: 'checkbox', checked: scaleOnResize });
    c.addEventListener('change', () => { scaleOnResize = c.checked; });
    box.append(el('label', { class: 'check' }, c, 'Scale everything to fit a new size'));
  }
  box.append(colorF('Background', doc.bg, (v, f) => { doc.bg = v; bg.fill(v); layer.batchDraw(); if (f) commit(); }));
  box.append(el('p', { class: 'group-lab' }, doc.pages.length > 1 ? `Page ${doc.cur + 1} of ${doc.pages.length}` : 'Pages'));
  const many = doc.pages.length > 1;
  box.append(actions('', ['Add page', () => addPage(false)], ['Duplicate page', () => addPage(true)]));
  if (many) box.append(actions('', ['Move earlier', () => movePage(-1)], ['Move later', () => movePage(1)], ['Delete page', deletePage]));
  box.append(el('p', { class: 'hint' }, 'Select something on the page to change it. Shift-click or drag across the mat to select several.'));
}

/* ---------- right panel: layers ---------- */
function layerName(e) {
  if (e.type === 'text') return e.text.replace(/\s+/g, ' ').slice(0, 40) || 'Text';
  if (e.type === 'image') return 'Image';
  if (e.type === 'line') return e.arrow ? 'Arrow' : 'Line';
  if (e.type === 'ellipse') return 'Circle';
  if (e.type === 'poly') return e.shape[0].toUpperCase() + e.shape.slice(1);
  return 'Rectangle';
}
function renderLayers() {
  const box = $('#layers');
  box.replaceChildren();
  if (!doc.els.length) return box.append(el('p', { class: 'layer-empty' }, 'Nothing on the page yet. Start with a template, or add text, a shape or an image.'));
  for (const e of [...doc.els].reverse()) {
    const flip = (k) => () => { e[k] = !e[k]; applyAttrs(e, nodes.get(e.id)); select(e.hidden ? sel.filter((i) => i !== e.id) : sel); commit(); };
    box.append(el('div', { class: 'layer' + (sel.includes(e.id) ? ' on' : '') + (e.hidden ? ' dim' : '') },
      el('button', { type: 'button', class: 'layer-name', onclick: (ev) => select(ev.shiftKey ? [...sel, e.id] : [e.id]) }, layerName(e)),
      el('button', { type: 'button', class: 'layer-act', 'aria-pressed': String(!!e.hidden), onclick: flip('hidden') }, e.hidden ? 'Show' : 'Hide'),
      el('button', { type: 'button', class: 'layer-act', 'aria-pressed': String(!!e.locked), onclick: flip('locked') }, e.locked ? 'Unlock' : 'Lock')));
  }
}

/* ---------- left panel ---------- */
const tabs = [...document.querySelectorAll('.tabs [role=tab]')];
tabs.forEach((t) => t.addEventListener('click', () => tabs.forEach((o) => {
  o.setAttribute('aria-selected', String(o === t));
  $('#' + o.getAttribute('aria-controls')).hidden = o !== t;
})));
document.querySelectorAll('.add-text').forEach((b) => b.addEventListener('click', () => addText(b.dataset.text)));
for (const [kind, label, svg] of SHAPES) {
  const b = el('button', { type: 'button', class: 'shape-btn', onclick: () => addShape(kind) });
  b.innerHTML = `<svg viewBox="0 0 40 40" aria-hidden="true">${svg}</svg>`;
  b.append(label);
  $('#shape-grid').append(b);
}
$('#img-pick').addEventListener('click', () => $('#img-file').click());
$('#img-file').addEventListener('change', (ev) => { addImages([...ev.target.files]); ev.target.value = ''; });
function renderUploads() {
  $('#img-grid').replaceChildren(...[...assets].map(([id, a]) => el('button', { type: 'button', 'aria-label': 'Add this image to the page', onclick: () => placeImage(id) }, el('img', { src: a.src, alt: '' }))));
}
function stageOf(t, s) {                // an offscreen render of one page: t = { w, h, bg, els }
  const st = new Konva.Stage({ container: document.createElement('div'), width: Math.round(t.w * s), height: Math.round(t.h * s) }), l = new Konva.Layer();
  const g = new Konva.Group({ scaleX: s, scaleY: s, clip: { x: 0, y: 0, width: t.w, height: t.h } });
  g.add(new Konva.Rect({ width: t.w, height: t.h, fill: t.bg }));
  t.els.forEach((e) => g.add(shapeFor({ ...e, id: newId('t') })));
  st.add(l); l.add(g); l.draw();
  return st;
}
function thumbOf(t, tw, jpeg) {
  const st = stageOf(t, tw / t.w), url = st.toDataURL(jpeg ? { pixelRatio: 2, mimeType: 'image/jpeg', quality: 0.8 } : { pixelRatio: 2 });
  st.destroy();
  return url;
}
function renderTemplates() {
  $('#tpl-grid').replaceChildren(...TEMPLATES.map((t) => el('button', { type: 'button', class: 'tpl', onclick: () => applyTemplate(t) },
    el('img', { src: thumbOf(t, 120), alt: '', width: 120, height: Math.round(120 * t.h / t.w) }),
    el('span', {}, t.name, el('small', {}, `${t.w} × ${t.h}`)))));
}

/* ---------- top bar ---------- */
$('#undo').addEventListener('click', undo);
$('#redo').addEventListener('click', redo);
$('#zoom-in').addEventListener('click', () => zoomTo(view.z * 1.25));
$('#zoom-out').addEventListener('click', () => zoomTo(view.z / 1.25));
$('#zoom-fit').addEventListener('click', fit);
$('#doc-name').addEventListener('change', (ev) => { doc.name = ev.target.value.trim() || 'Untitled design'; ev.target.value = doc.name; commit(); });
const menus = [...document.querySelectorAll('.menu')];
document.addEventListener('click', (ev) => menus.forEach((m) => { if (!m.contains(ev.target)) m.open = false; }));
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') menus.forEach((m) => { m.open = false; }); });

function download(blob, name) {
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const fileBase = () => doc.name.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').toLowerCase() || 'design';
$('#file-new').addEventListener('click', () => { $('#file-menu').open = false; openLibrary(); });
$('#file-lib').addEventListener('click', () => { $('#file-menu').open = false; openLibrary(); });
$('#file-keys').addEventListener('click', () => { $('#file-menu').open = false; $('#keys').showModal(); });
$('#keys-close').addEventListener('click', () => $('#keys').close());

/* ---------- accounts and cloud copies ---------- */
// Signed out, everything works from this browser alone. Signed in, each design is also copied to the account:
// the full design as a file in private storage, plus a small row (name, size, thumbnail) for listing.
const cloudCfg = window.CUTMAT_CLOUD || {};
const sb = cloudCfg.url && cloudCfg.key && window.supabase ? window.supabase.createClient(cloudCfg.url, cloudCfg.key) : null;
let user = null, syncedFor = null;
const pushTimers = new Map();
const blankBundle = (b) => (Array.isArray(b.doc.pages) ? b.doc.pages : [b.doc]).every((p) => !(p.els || []).length);
function setSync(msg) { $('#acct-sync').textContent = msg; }
async function pushDesign(b) {
  const file = new Blob([JSON.stringify(b)], { type: 'application/json' });
  const up = await sb.storage.from('cutmat-designs').upload(`${user.id}/${b.id}.json`, file, { upsert: true, contentType: 'application/json' });
  if (up.error) throw up.error;
  const { error } = await sb.from('cutmat_designs').upsert({ user_id: user.id, id: b.id, name: String(b.doc.name || 'Untitled design').slice(0, 60), width: b.doc.w, height: b.doc.h,
    pages: Array.isArray(b.doc.pages) ? b.doc.pages.length : 1, thumb: b.thumb || null, updated_at: new Date(b.updated || Date.now()).toISOString() });
  if (error) throw error;
}
function queuePush(id) {               // a few seconds after the last change, copy the design to the account
  if (!sb || !user) return;
  clearTimeout(pushTimers.get(id));
  pushTimers.set(id, setTimeout(async () => {
    pushTimers.delete(id);
    try {
      const b = await idb.get('d:' + id);
      if (!b || !user || blankBundle(b)) return;
      setSync('Saving to your account…');
      await pushDesign(b);
      setSync('Everything is saved to your account.');
    } catch { setSync('Could not reach your account. Changes are kept on this device and will be sent later.'); }
  }, 2500));
}
async function cloudList() {
  const { data, error } = await sb.from('cutmat_designs').select('id,name,width,height,pages,thumb,updated_at').order('updated_at', { ascending: false });
  if (error) throw error;
  return data || [];
}
async function pullDesign(id) {
  const { data, error } = await sb.storage.from('cutmat-designs').download(`${user.id}/${id}.json`);
  if (error) throw error;
  const b = JSON.parse(await data.text());
  if (!b || b.app !== 'cutmat-design' || !b.doc) throw new Error('not a Cutmat design');
  b.id = id;
  await idb.set('d:' + id, b);
  return b;
}
async function cloudDelete(id) {
  const rm = await sb.storage.from('cutmat-designs').remove([`${user.id}/${id}.json`]);
  const { error } = await sb.from('cutmat_designs').delete().eq('id', id);
  if (rm.error || error) throw rm.error || error;
}
async function syncAll() {             // send anything this device has that the account lacks or holds an older copy of
  const [local, remote] = await Promise.all([idb.designs(), cloudList()]);
  const at = new Map(remote.map((r) => [r.id, Date.parse(r.updated_at)]));
  for (const b of local) {
    if (!b || !b.id || !b.doc || blankBundle(b)) continue;
    if (!at.has(b.id) || (b.updated || 0) > at.get(b.id) + 1000) await pushDesign(b);
  }
  return remote;
}
async function cloudMerge(mine) {      // the library list with the account's designs folded in
  try {
    const remote = await syncAll(), here = new Set(mine.map((b) => b.id));
    const out = mine.map((b) => { const r = remote.find((x) => x.id === b.id); return { ...b, synced: true, newer: !!r && Date.parse(r.updated_at) > (b.updated || 0) + 1000 }; });
    for (const r of remote) if (!here.has(r.id)) out.push({ id: r.id, updated: Date.parse(r.updated_at), thumb: r.thumb, cloudOnly: true, doc: { name: r.name, w: r.width, h: r.height, pages: Array(r.pages || 1).fill(0) } });
    out.sort((a, b) => (b.updated || 0) - (a.updated || 0));
    $('#lib-cloud').textContent = 'Designs are saved to your account as you work.';
    setSync('Everything is saved to your account.');
    return out;
  } catch {
    $('#lib-cloud').textContent = 'Could not reach your account. Showing the designs on this device.';
    return null;
  }
}

const acct = $('#acct'), acctMsg = $('#acct-msg');
let acctMode = 'in';                   // 'in' sign-in form, 'recover' choosing a new password
function renderAcct() {
  $('#acct-btn').textContent = user ? 'Account' : 'Sign in';
  $('#acct-out').hidden = !!user || acctMode === 'recover';
  $('#acct-in').hidden = !user || acctMode === 'recover';
  $('#acct-new').hidden = acctMode !== 'recover';
  $('#acct-h').textContent = acctMode === 'recover' ? 'Choose a new password' : user ? 'Your account' : 'Sign in to Cutmat';
  $('#acct-email-v').textContent = user ? user.email : '';
}
const acctSay = (msg) => { acctMsg.textContent = msg; };
function authError(e) {
  const m = String(e && e.message || '');
  if (/confirm/i.test(m)) return 'Confirm your email first: open the link in the message we sent, then sign in here.';
  if (/invalid login/i.test(m)) return 'That email and password do not match an account.';
  if (/already registered/i.test(m)) return 'There is already an account for that email. Sign in instead.';
  if (/rate limit|too many/i.test(m)) return 'Too many tries. Wait a few minutes and try again.';
  return m || 'That did not work. Check your connection and try again.';
}
if (sb) {
  const here = location.origin + location.pathname;
  const creds = () => ({ email: $('#acct-email').value.trim(), password: $('#acct-pass').value });
  $('#acct-btn').hidden = false;
  $('#acct-btn').addEventListener('click', () => { acctSay(''); renderAcct(); acct.showModal(); });
  $('#acct-close').addEventListener('click', () => acct.close());
  $('#acct-out').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    acctSay('Signing in…');
    const { error } = await sb.auth.signInWithPassword(creds());
    if (error) return acctSay(authError(error));
    $('#acct-pass').value = '';
    acctSay('');
  });
  $('#acct-create').addEventListener('click', async () => {
    const c = creds();
    if (!c.email || c.password.length < 8) return acctSay('Enter your email and a password of at least 8 characters.');
    acctSay('Creating your account…');
    const { data, error } = await sb.auth.signUp({ ...c, options: { emailRedirectTo: here } });
    if (error) return acctSay(authError(error));
    $('#acct-pass').value = '';
    acctSay(data.session ? '' : 'Almost there. Open the confirmation link we emailed you, then sign in here.');
  });
  $('#acct-forgot').addEventListener('click', async () => {
    const email = $('#acct-email').value.trim();
    if (!email) return acctSay('Enter your email above first.');
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: here });
    acctSay(error ? authError(error) : 'If there is an account for that email, a reset link is on its way.');
  });
  $('#acct-new').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const password = $('#acct-newpass').value;
    if (password.length < 8) return acctSay('Use at least 8 characters.');
    const { error } = await sb.auth.updateUser({ password });
    if (error) return acctSay(authError(error));
    $('#acct-newpass').value = '';
    acctMode = 'in'; renderAcct(); acctSay('Password changed.');
  });
  $('#acct-signout').addEventListener('click', async () => { await sb.auth.signOut(); acctSay('Signed out. Your designs are still on this device.'); });
  sb.auth.onAuthStateChange((event, session) => {
    user = session ? session.user : null;
    if (event === 'PASSWORD_RECOVERY') { acctMode = 'recover'; acctSay(''); if (!acct.open) acct.showModal(); }
    renderAcct();
    if (!user) { syncedFor = null; return; }
    if (syncedFor === user.id) return;
    syncedFor = user.id;
    setTimeout(() => {                 // outside the auth callback, as the client library requires
      setSync('Sending your designs to your account…');
      syncAll().then(() => setSync('Everything is saved to your account.'), () => setSync('Could not reach your account. Designs are kept on this device.'));
    }, 0);
  });
}

/* ---------- library of designs kept in this browser ---------- */
const lib = $('#lib');
async function openLibrary() {
  endCrop(false);
  if (editing) ta.blur();
  if (!isBlank()) await storeNow();
  let list = [];
  try { list = (await idb.designs()).filter((b) => b && b.doc && b.id).sort((a, b) => (b.updated || 0) - (a.updated || 0)); } catch { /* nothing kept */ }
  const mine = list.filter((b) => b.id !== designId || !isBlank());
  const show = (items) => { $('#lib-empty').hidden = items.length > 0; $('#lib-grid').replaceChildren(...items.map(designCard)); };
  show(mine);
  if (!lib.open) lib.showModal();
  $('#lib-cloud').textContent = !sb ? '' : user ? 'Checking your account…' : 'These are kept on this device. Sign in to keep them in your account too.';
  if (sb && user) cloudMerge(mine).then((items) => { if (lib.open && items) show(items); });
}
function designCard(b) {
  const pages = Array.isArray(b.doc.pages) ? b.doc.pages.length : 1;
  const when = new Date(b.updated || Date.now()).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const del = el('button', { type: 'button', class: 'layer-act' }, 'Delete');
  del.addEventListener('click', async () => {
    if (del.dataset.sure !== '1') { del.dataset.sure = '1'; del.textContent = 'Delete for good?'; del.setAttribute('aria-pressed', 'true'); return; }
    await idb.del('d:' + b.id).catch(() => {});
    if (sb && user) await cloudDelete(b.id).catch(() => say('The copy in your account could not be deleted.'));
    if (b.id === designId) {           // the open design was deleted: move to the newest one left, or a blank page
      clearTimeout(saveTimer);
      const rest = (await idb.designs().catch(() => [])).sort((x, y) => (y.updated || 0) - (x.updated || 0))[0];
      if (rest) { await loadBundle(rest); resetHistory(); } else blankDesign(1080, 1080);
    }
    openLibrary();
  });
  return el('div', { class: 'card' },
    el('button', { type: 'button', class: 'card-open', onclick: async () => { if (b.id !== designId || b.newer) await openDesign(b.id, b.cloudOnly || b.newer); lib.close(); } },
      b.thumb ? el('img', { src: b.thumb, alt: '' }) : el('span', { class: 'card-blank' }),
      el('span', { class: 'card-name' }, String(b.doc.name || 'Untitled design')),
      el('small', {}, `${b.doc.w} × ${b.doc.h}` + (pages > 1 ? ` · ${pages} pages` : '') + ` · ${when}` + (b.id === designId ? ' · open now' : '') + (b.cloudOnly ? ' · in your account' : b.synced ? ' · synced' : ''))),
    el('div', { class: 'card-acts' },
      b.cloudOnly ? null : el('button', { type: 'button', class: 'layer-act', onclick: async () => {
        const c = await idb.get('d:' + b.id);
        if (!c) return;
        c.id = newId('d'); c.updated = Date.now(); c.doc.name = (String(c.doc.name || 'Untitled design') + ' copy').slice(0, 60);
        await idb.set('d:' + c.id, c);
        openLibrary();
      } }, 'Duplicate'), del));
}
async function openDesign(id, pull) {
  let b;
  try { b = pull ? await pullDesign(id) : await idb.get('d:' + id); } catch { return say('That design could not be fetched from your account.'); }
  if (!b) return say('That design is no longer in this browser.');
  if (id !== designId) await leaveDesign(); else { endCrop(false); clearTimeout(saveTimer); }
  try { await loadBundle(b); resetHistory(); } catch { say('That design could not be opened.'); }
}
async function newDesign(w, h) {
  await leaveDesign();
  blankDesign(w, h);
  lib.close();
}
$('#size-grid').replaceChildren(...SIZES.map(([, label, w, h]) => {
  const k = 46 / Math.max(w, h);
  return el('button', { type: 'button', class: 'size-card', onclick: () => newDesign(w, h) },
    el('span', { class: 'size-box', style: `width:${Math.round(w * k)}px;height:${Math.round(h * k)}px` }),
    el('span', {}, label, el('small', {}, `${w} × ${h}`)));
}));
$('#lib-close').addEventListener('click', () => lib.close());
$('#file-save').addEventListener('click', () => { download(new Blob([JSON.stringify(bundle())], { type: 'application/json' }), fileBase() + '.cutmat.json'); $('#file-menu').open = false; });
$('#file-open').addEventListener('click', () => { $('#open-file').click(); $('#file-menu').open = false; });
$('#open-file').addEventListener('change', async (ev) => {
  const f = ev.target.files[0]; ev.target.value = '';
  if (!f) return;
  try {
    const b = JSON.parse(await f.text());
    if (!b || b.app !== 'cutmat-design' || !b.doc) throw new Error('not a Cutmat design');
    await leaveDesign();
    await loadBundle(b);
    designId = newId('d');             // a copy from disk never overwrites a design already kept here
    resetHistory();
    say(`Opened ${f.name}.`);
  } catch { say(`${f.name} is not a saved Cutmat design.`); }
});

/* ---------- download ---------- */
function syncScales() {
  $('#dl-scale').replaceChildren(...[1, 2, 3].filter((m) => doc.w * m <= 8192 && doc.h * m <= 8192).map((m) => el('option', { value: m }, `${m}×  ${doc.w * m} × ${doc.h * m} px`)));
  $('#dl-pages-f').hidden = doc.pages.length < 2;
  $('#dl-pages').options[0].textContent = `This page (${doc.cur + 1})`;
  $('#dl-pages').options[1].textContent = `All ${doc.pages.length} pages`;
  syncDlNote();
}
function syncDlNote() {
  const all = doc.pages.length > 1 && $('#dl-pages').value === 'all', fmt = $('#dl-format').value;
  $('#dl-note').textContent = !all ? '' : fmt === 'pdf' ? 'One PDF with every page.' : 'One zip file with an image for each page.';
}
$('#dl-menu').addEventListener('toggle', syncScales);
$('#dl-format').addEventListener('change', syncDlNote);
$('#dl-pages').addEventListener('change', syncDlNote);
function pdfFromJpegs(jpgs, pxW, pxH, ptW, ptH) {   // each page holds one JPEG edge to edge
  const enc = new TextEncoder(), parts = [], offs = [];
  let len = 0;
  const put = (x) => { const u = typeof x === 'string' ? enc.encode(x) : x; parts.push(u); len += u.length; };
  const obj = (n, body) => { offs[n] = len; put(`${n} 0 obj\n`); body(); put('\nendobj\n'); };
  const content = `q ${ptW} 0 0 ${ptH} 0 0 cm /Im0 Do Q`, count = 2 + jpgs.length * 3;
  put('%PDF-1.4\n');
  obj(1, () => put('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => put(`<< /Type /Pages /Kids [${jpgs.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] /Count ${jpgs.length} >>`));
  jpgs.forEach((jpg, i) => {
    const n = 3 + i * 3;
    obj(n, () => put(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptW} ${ptH}] /Resources << /XObject << /Im0 ${n + 1} 0 R >> >> /Contents ${n + 2} 0 R >>`));
    obj(n + 1, () => { put(`<< /Type /XObject /Subtype /Image /Width ${pxW} /Height ${pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`); put(jpg); put('\nendstream'); });
    obj(n + 2, () => put(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
  });
  const xref = len;
  let table = `xref\n0 ${count + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= count; n++) table += String(offs[n]).padStart(10, '0') + ' 00000 n \n';
  put(table);
  put(`trailer\n<< /Size ${count + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function zipOf(files) {                // [{ name, data: Uint8Array }], stored without compression (images are already compressed)
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(12, 0x21, true);
    h.setUint32(14, crc, true); h.setUint32(18, size, true); h.setUint32(22, size, true); h.setUint16(26, name.length, true);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(14, 0x21, true);
    c.setUint32(16, crc, true); c.setUint32(20, size, true); c.setUint32(24, size, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    parts.push(h.buffer, name, f.data);
    central.push(c.buffer, name);
    off += 30 + name.length + size;
  }
  const csize = central.reduce((a, b) => a + b.byteLength, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, e.buffer], { type: 'application/zip' });
}
async function pageBlob(p, mime, mult) {
  const st = stageOf({ w: doc.w, h: doc.h, bg: p.bg, els: p.els }, 1);
  try { return await st.toBlob({ pixelRatio: mult, mimeType: mime, quality: 0.92 }); } finally { st.destroy(); }
}
$('#dl-go').addEventListener('click', async () => {
  const fmt = $('#dl-format').value, mult = +$('#dl-scale').value || 1, base = fileBase();
  const all = doc.pages.length > 1 && $('#dl-pages').value === 'all';
  ta.blur();
  const btn = $('#dl-go');
  btn.disabled = true;
  let blobs = [];
  try { for (const p of all ? doc.pages : [doc.pages[doc.cur]]) blobs.push(await pageBlob(p, fmt === 'png' ? 'image/png' : 'image/jpeg', mult)); }
  catch { blobs = [null]; }
  btn.disabled = false;
  if (blobs.some((b) => !b)) return say('The download could not be made. Try a smaller size.');
  const bytes = async (b) => new Uint8Array(await b.arrayBuffer());
  let out = blobs[0], name = `${base}.${fmt}`;
  if (fmt === 'pdf') out = pdfFromJpegs(await Promise.all(blobs.map(bytes)), Math.round(doc.w * mult), Math.round(doc.h * mult), +(doc.w * 0.75).toFixed(2), +(doc.h * 0.75).toFixed(2));
  else if (blobs.length > 1) {
    out = zipOf(await Promise.all(blobs.map(async (b, i) => ({ name: `${base}-${i + 1}.${fmt}`, data: await bytes(b) }))));
    name = `${base}.zip`;
  }
  download(out, name);
  $('#dl-menu').open = false;
  say(`Downloaded ${name}`);
});

/* ---------- start ---------- */
new ResizeObserver(() => {
  if (!host.clientWidth || (stage.width() === host.clientWidth && stage.height() === host.clientHeight)) return;
  const cx = (stage.width() / 2 - view.x) / view.z, cy = (stage.height() / 2 - view.y) / view.z;
  stage.size({ width: host.clientWidth, height: host.clientHeight });
  if (view.auto) return fit();
  view.x = stage.width() / 2 - cx * view.z; view.y = stage.height() / 2 - cy * view.z;
  applyView();
}).observe(host);

(async () => {
  rebuild(); fit();
  try {
    const legacy = await idb.get('current');                  // the single design kept before the library existed
    if (legacy) { legacy.id = newId('d'); legacy.updated = Date.now(); await idb.set('d:' + legacy.id, legacy); await idb.set('last', legacy.id); await idb.del('current'); }
    const last = await idb.get('last');
    const b = (last && await idb.get('d:' + last)) || (await idb.designs()).sort((x, y) => (y.updated || 0) - (x.updated || 0))[0];
    if (b) await loadBundle(b);
  } catch { /* start blank */ }
  resetHistory();
  if (isBlank()) openLibrary();
  await Promise.all(FONTS.flatMap((f) => [document.fonts.load(`400 16px "${f}"`), document.fonts.load(`700 16px "${f}"`)])).catch(() => {});
  nodes.forEach((n) => { if (n.className === 'Text') n.setAttr('text', n.text()), n._setTextData?.(); });
  tr.forceUpdate(); applyView();
  renderTemplates(); renderPages();
})();
})();
