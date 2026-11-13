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
const fmtBytes = (b) => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(b < 10240 ? 1 : 0) + ' KB' : (b / 1048576).toFixed(2) + ' MB';
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
let uid = 1;

/* ---------- step definitions ---------- */
const POSITIONS = [['tl', 'Top left'], ['tc', 'Top centre'], ['tr', 'Top right'], ['cl', 'Middle left'], ['cc', 'Centre'], ['cr', 'Middle right'], ['bl', 'Bottom left'], ['bc', 'Bottom centre'], ['br', 'Bottom right'], ['tile', 'Repeat across image']];
const BG_MODELS = {
  // Both run on the CPU (wasm): WebGPU gave wrong mattes for MODNet in testing, and the 1024px BiRefNet exports crash in onnxruntime-web.
  objects: { id: 'xrds/isnet-general-onnx-int8', dtype: 'q8', size: '44 MB', devices: ['wasm'] },
  people: { id: 'Xenova/modnet', dtype: 'fp32', size: '26 MB', devices: ['wasm'] },
};
const STEPS = {
  removebg: {
    label: 'Remove background',
    defaults: { subject: 'objects', bg: 'transparent', color: '#ffffff' },
    fields: [
      { k: 'subject', label: 'Subject', type: 'select', options: [['objects', 'Anything: products, pets, objects'], ['people', 'People only (faster)']] },
      { k: 'bg', label: 'Replace with', type: 'select', options: [['transparent', 'Transparent'], ['color', 'A colour']] },
      { k: 'color', label: 'Colour', type: 'color', show: (s) => s.bg === 'color' },
      { type: 'note', text: (s) => `First use downloads a ${(BG_MODELS[s.subject] || BG_MODELS.objects).size} model. Each image then takes a few seconds, and your images still stay on this device.`
        + (s.bg === 'transparent' ? ' Transparency needs PNG or WebP output; JPEG fills it with white.' : '') },
    ],
  },
  upscale: {
    label: 'Upscale',
    defaults: { factor: '2', quality: navigator.gpu ? 'best' : 'fast' },
    fields: [
      { k: 'factor', label: 'Enlarge', type: 'select', options: [['2', '2× larger'], ['4', '4× larger']] },
      { k: 'quality', label: 'Quality', type: 'select', options: [['max', 'Maximum detail (very slow, 161 MB model)'], ['best', 'Best (slower, 67 MB model)'], ['fast', 'Fast (5 MB model)']] },
      { type: 'note', text: (s) => (s.quality === 'max'
        ? 'Maximum keeps the most true detail and needs a graphics card; expect several minutes for a 640 px photo and over an hour at 2048 px.'
        : s.quality === 'best'
        ? 'Best redraws more detail and needs a graphics card; expect about a minute for a 640 px photo and around ten at 2048 px.'
        : 'Fast takes seconds and works on any computer, with softer detail.')
        + ' Time left shows under the preview once it starts.'
        + ` Scroll on the preview to zoom in and check it. Any size works as long as the result fits in a browser image (16,384 px a side); large images take much longer. Your images still stay on this device.` },
    ],
  },
  restorefaces: {
    label: 'Restore faces',
    defaults: { strength: 80 },
    fields: [
      { k: 'strength', label: 'Strength', type: 'range', min: 0, max: 100, unit: '%' },
      { type: 'note', text: () => `Finds faces and redraws them sharper; it can subtly change how a face looks. Works best placed after Upscale. First use downloads a ${FACE_MODEL.size} model`
        + (FACE_MODEL.ep === 'wasm' ? ', and without a graphics card each face takes about a minute' : '') + '. Your images still stay on this device.' },
    ],
  },
  resize: {
    label: 'Resize',
    defaults: { mode: 'fit', w: 1920, h: 1920, pct: 50, noUp: true },
    fields: [
      { k: 'mode', label: 'Method', type: 'select', options: [['fit', 'Fit inside a box'], ['width', 'Set width'], ['height', 'Set height'], ['percent', 'Scale by percent']] },
      { k: 'w', label: 'Width (px)', type: 'number', min: 1, max: 20000, show: (s) => s.mode === 'fit' || s.mode === 'width' },
      { k: 'h', label: 'Height (px)', type: 'number', min: 1, max: 20000, show: (s) => s.mode === 'fit' || s.mode === 'height' },
      { k: 'pct', label: 'Scale', type: 'range', min: 1, max: 200, unit: '%', show: (s) => s.mode === 'percent' },
      { k: 'noUp', label: 'Never enlarge', type: 'check' },
    ],
  },
  crop: {
    label: 'Crop',
    defaults: { ratio: 'free', fx: 0.1, fy: 0.1, fw: 0.8, fh: 0.8, rw: 4, rh: 3, x: 50, y: 50 },
    fields: [
      { k: 'ratio', label: 'Shape', type: 'select', after: (s) => { cropEdit = s.ratio === 'free' ? s.id : null; },
        options: [['free', 'Free box (drag on the preview)'], ['1:1', 'Square 1:1'], ['4:5', 'Portrait 4:5'], ['3:2', 'Photo 3:2'], ['16:9', 'Wide 16:9'], ['9:16', 'Story 9:16'], ['custom', 'Custom ratio']] },
      { k: 'rw', label: 'Ratio width', type: 'number', min: 1, max: 100, show: (s) => s.ratio === 'custom' },
      { k: 'rh', label: 'Ratio height', type: 'number', min: 1, max: 100, show: (s) => s.ratio === 'custom' },
      { k: 'x', label: 'Keep: left ↔ right', type: 'range', min: 0, max: 100, unit: '%', show: (s) => s.ratio !== 'free' },
      { k: 'y', label: 'Keep: top ↔ bottom', type: 'range', min: 0, max: 100, unit: '%', show: (s) => s.ratio !== 'free' },
      { type: 'actions', show: (s) => s.ratio === 'free', actions: [
        [(s) => cropEdit === s.id ? 'Done' : 'Edit crop box', (s) => { cropEdit = cropEdit === s.id ? null : s.id; }],
        ['Whole image', (s) => { s.fx = s.fy = 0; s.fw = s.fh = 1; }],
      ] },
      { type: 'note', show: (s) => s.ratio === 'free', text: () => 'Drag the box or its handles on the preview, then press Done. The same proportions are cut from every image in the batch.' },
    ],
  },
  rotate: {
    label: 'Rotate',
    defaults: { angle: 0, trim: false, flipH: false, flipV: false },
    fields: [
      { type: 'note', text: () => 'Drag a corner of the preview to rotate freely. Hold Shift to snap to 15°.' },
      { k: 'angle', label: 'Angle', type: 'range', min: -180, max: 180, step: 0.5, unit: '°' },
      { type: 'actions', actions: [
        ['↺ 90°', (s) => { s.angle = normAngle(Number(s.angle) - 90); }],
        ['↻ 90°', (s) => { s.angle = normAngle(Number(s.angle) + 90); }],
        ['Reset', (s) => { s.angle = 0; }],
      ] },
      { k: 'trim', label: 'Trim empty corners', type: 'check' },
      { k: 'flipH', label: 'Mirror left to right', type: 'check' },
      { k: 'flipV', label: 'Flip top to bottom', type: 'check' },
    ],
  },
  adjust: {
    label: 'Adjust',
    defaults: { bri: 100, con: 100, sat: 100, blur: 0, gray: false },
    fields: [
      { k: 'bri', label: 'Brightness', type: 'range', min: 0, max: 200, unit: '%' },
      { k: 'con', label: 'Contrast', type: 'range', min: 0, max: 200, unit: '%' },
      { k: 'sat', label: 'Saturation', type: 'range', min: 0, max: 200, unit: '%' },
      { k: 'blur', label: 'Blur', type: 'range', min: 0, max: 20, unit: 'px' },
      { k: 'gray', label: 'Black and white', type: 'check' },
    ],
  },
  watermark: {
    label: 'Watermark',
    defaults: { text: '© Your name', pos: 'br', size: 4, opacity: 70, color: '#ffffff' },
    fields: [
      { k: 'text', label: 'Text', type: 'text' },
      { k: 'pos', label: 'Position', type: 'select', options: POSITIONS },
      { k: 'size', label: 'Size', type: 'range', min: 1, max: 20, unit: '% of width' },
      { k: 'opacity', label: 'Opacity', type: 'range', min: 5, max: 100, unit: '%' },
      { k: 'color', label: 'Colour', type: 'color' },
    ],
  },
};

let cropEdit = null;      // id of the Crop step whose box is being dragged on the preview, if any

/* ---------- state ---------- */
const state = {
  files: [],            // {id, file, url}
  sel: null,
  recipe: [],           // {id, type, on, ...params}
  out: { format: 'keep', quality: 80, targetKB: '', pattern: '{name}' },
};
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
function loadSnapshot(snap) {
  if (!snap) return;
  if (Array.isArray(snap.recipe)) {
    state.recipe = snap.recipe.filter((s) => STEPS[s.type]).map((s) => ({ ...STEPS[s.type].defaults, ...s, id: uid++ }));
    for (const s of state.recipe) if (s.type === 'rotate') s.angle = normAngle(Number(s.angle) || 0);   // older recipes stored '90' etc.
  }
  if (snap.out) Object.assign(state.out, snap.out);
}
const snapshot = () => ({ recipe: state.recipe.map(({ id, ...s }) => s), out: { ...state.out } });
loadSnapshot(store.get('cutmat.last'));

/* ---------- canvas pipeline ---------- */
function mk(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
function scaleTo(c, w, h) {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  let cur = c;
  // halve in stages so large reductions stay sharp
  while (cur.width / 2 > w && cur.height / 2 > h) {
    const n = mk(cur.width / 2, cur.height / 2);
    const x = n.getContext('2d'); x.imageSmoothingQuality = 'high';
    x.drawImage(cur, 0, 0, n.width, n.height);
    cur = n;
  }
  const o = mk(w, h);
  const x = o.getContext('2d'); x.imageSmoothingQuality = 'high';
  x.drawImage(cur, 0, 0, w, h);
  return o;
}
function normAngle(a) { a = ((a + 180) % 360 + 360) % 360 - 180; return a === -180 ? 180 : Math.round(a * 2) / 2; }
// largest axis-aligned rectangle that fits inside a w×h rectangle rotated by the angle with these |sin|, |cos|
function inscribed(w, h, sin, cos) {
  const long = Math.max(w, h), short = Math.min(w, h);
  if (short <= 2 * sin * cos * long || Math.abs(sin - cos) < 1e-10) {
    const x = 0.5 * short;
    return w >= h ? [x / sin, x / cos] : [x / cos, x / sin];
  }
  const c2 = cos * cos - sin * sin;
  return [(w * cos - h * sin) / c2, (h * cos - w * sin) / c2];
}
/* ---------- background removal (model runs locally via transformers.js) ---------- */
const TF_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1';
const segmenters = new Map();          // subject -> Promise<{run, RawImage}>
const cutouts = new WeakMap();         // File -> {key, canvas} (last cut-out only, to bound memory)
let bgQueue = Promise.resolve();       // one inference at a time
function userError(msg, cause) { const e = new Error(msg); e.userMsg = msg; e.cause = cause; return e; }
function loadSegmenter(subject) {
  if (!segmenters.has(subject)) {
    const m = BG_MODELS[subject];
    const p = (async () => {
      setStatus(`Getting the background model ready (${m.size}, first time only)…`);
      const tf = await import(TF_URL);
      const progress = (d) => {
        if (d.status === 'progress' && /\.onnx/.test(d.file || '') && d.total) setStatus(`Downloading the background model: ${Math.round(d.loaded / d.total * 100)}% of ${m.size}`);
      };
      let seg;
      // WebGPU gave wrong mattes for MODNet in testing, so each model lists the devices it is trusted on
      const devices = m.devices.filter((d) => d !== 'webgpu' || navigator.gpu);
      for (const device of devices) {
        try { seg = await tf.pipeline('background-removal', m.id, { dtype: m.dtype, device, progress_callback: progress }); break; }
        catch (e) { if (device === devices[devices.length - 1]) throw e; }
      }
      return { seg, RawImage: tf.RawImage };
    })();
    p.catch(() => segmenters.delete(subject));
    segmenters.set(subject, p);
  }
  return segmenters.get(subject);
}
async function cutout(c, s, ctx) {
  if (!BG_MODELS[s.subject]) s = { ...s, subject: 'objects' };
  const key = s.subject + '|' + ctx.prior;
  const hit = cutouts.get(ctx.file);
  if (hit && hit.key === key) return hit.canvas;
  const job = bgQueue.then(async () => {
    let model;
    try { model = await loadSegmenter(s.subject); }
    catch (e) { throw userError('The background model could not be downloaded. Check your connection and try again.', e); }
    setStatus('Removing the background…');
    try {
      const f = Math.min(1, 1024 / Math.max(c.width, c.height));
      const small = f < 1 ? scaleTo(c, c.width * f, c.height * f) : c;
      const out = await model.seg(model.RawImage.fromCanvas(small).rgb());
      const matte = (Array.isArray(out) ? out[0] : out).toCanvas();   // RGBA, alpha = subject
      const o = mk(c.width, c.height), x = o.getContext('2d');
      x.drawImage(c, 0, 0);
      x.globalCompositeOperation = 'destination-in';
      x.imageSmoothingQuality = 'high';
      x.drawImage(matte, 0, 0, o.width, o.height);
      return o;
    } catch (e) { throw userError('Background removal could not run in this browser. Turn the step off to keep working.', e); }
  });
  bgQueue = job.catch(() => {});
  const canvas = await job;
  cutouts.set(ctx.file, { key, canvas });
  return canvas;
}

/* ---------- AI upscaling (Real-ESRGAN general x4v3, BSD-3, run with onnxruntime-web) ---------- */
const ORT_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';
async function fetchModel(url, name, size) {   // download with a progress readout
  const res = await fetch(url);
  if (!res.ok) throw new Error('model download failed: ' + res.status);
  const total = Number(res.headers.get('content-length')) || 0, chunks = [];
  let got = 0;
  for (const reader = res.body.getReader(); ;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    if (total) setStatus(`Downloading the ${name} model: ${Math.round(got / total * 100)}% of ${size}`);
  }
  const buf = new Uint8Array(got);
  let off = 0;
  for (const ch of chunks) { buf.set(ch, off); off += ch.length; }
  return buf;
}
const SR_MODELS = {
  // Real-ESRGAN general x4v3 (compact): any tile size, runs on CPU or graphics card
  fast: { url: 'https://huggingface.co/CoderViking/realesr-general-x4v3-onnx/resolve/main/realesr-general-x4v3.onnx', size: '5 MB', input: 'input', output: 'output', inner: 192, fixed: 0, eps: ['webgpu', 'wasm'] },
  // Real-ESRGAN x4plus (full RRDBNet): fixed 128 px tiles, far too slow without a graphics card
  best: { url: 'https://huggingface.co/bukuroo/RealESRGAN-ONNX/resolve/main/real-esrgan-x4plus-128.onnx', size: '67 MB', input: 'image', output: 'upscaled_image', inner: 112, fixed: 128, eps: ['webgpu'] },
  // HAT (Real_HAT_GAN_SRx4_sharper, Apache-2.0): fixed 192 px tiles, ~15 s per tile even on a graphics card
  max: { url: 'https://huggingface.co/MahoCommerce/Real_HAT_GAN_sharper-ONNX/resolve/main/onnx/model.onnx', size: '161 MB', input: 'pixel_values', output: 'reconstruction', inner: 176, fixed: 192, eps: ['webgpu'] },
};
const CANVAS_SIDE = 16384, CANVAS_AREA = 16384 * 16384;   // Chrome's canvas limits; phones and Safari hold less
let bigUpscale = null;                // the one file allowed to keep a very large cached result
const upscales = new WeakMap();        // File -> {key, canvas} (the 4x result)
const upscalers = new Map();           // quality -> Promise<{ort, session}>
function loadUpscaler(q) {
  if (!upscalers.has(q)) {
    const m = SR_MODELS[q];
    const p = (async () => {
      setStatus(`Getting the upscaling model ready (${m.size}, first time only)…`);
      const ort = await import(ORT_BASE + 'ort.webgpu.min.mjs');
      ort.env.wasm.wasmPaths = ORT_BASE;
      const buf = await fetchModel(m.url, 'upscaling', m.size);
      let session, lastErr;
      for (const ep of m.eps.filter((e) => e !== 'webgpu' || navigator.gpu)) {
        try { session = await ort.InferenceSession.create(buf, { executionProviders: [ep] }); break; }
        catch (e) { lastErr = e; }
      }
      if (!session) throw lastErr || new Error('no usable device');
      return { ort, session };
    })();
    p.catch(() => upscalers.delete(q));
    upscalers.set(q, p);
  }
  return upscalers.get(q);
}
async function upscale4(c, s, ctx) {
  const q = SR_MODELS[s.quality] ? s.quality : 'fast', cfg = SR_MODELS[q];
  const F = s.factor === '2' ? 2 : 4;   // the models always make 4x; for 2x each tile is halved as it is placed
  const key = q + '|' + F + '|' + ctx.prior;
  const hit = upscales.get(ctx.file);
  if (hit && hit.key === key) return hit.canvas;
  // No size cap of our own: the only limit is what a browser canvas can physically hold.
  const ow = c.width * F, oh = c.height * F;
  if (Math.max(ow, oh) > CANVAS_SIDE || ow * oh > CANVAS_AREA) {
    throw userError(`${F}× of this ${c.width} × ${c.height} image would be ${ow} × ${oh}, which is more than a browser can hold in one image.`
      + (F === 4 && Math.max(ow, oh) / 2 <= CANVAS_SIDE && ow * oh / 4 <= CANVAS_AREA ? ' Choose 2× in the Upscale step.' : ' Add a Resize step above Upscale.'));
  }
  if (!cfg.eps.includes('wasm') && !navigator.gpu) {
    throw userError('This quality needs a graphics card this browser can use (WebGPU). Choose Fast in the Upscale step instead.');
  }
  const job = bgQueue.then(async () => {
    let m;
    try { m = await loadUpscaler(q); }
    catch (e) { throw userError('The upscaling model could not be loaded. Check your connection, or choose the other quality.', e); }
    try {
      const W = c.width, H = c.height, T = cfg.inner, P = 8;   // tile size and the overlap that hides tile seams
      let src = c;
      if (cfg.fixed && (W < cfg.fixed || H < cfg.fixed)) {      // fixed-size model: pad small images by stretching their edges
        src = mk(Math.max(W, cfg.fixed), Math.max(H, cfg.fixed));
        const px = src.getContext('2d');
        px.drawImage(c, 0, 0);
        if (W < src.width) px.drawImage(c, W - 1, 0, 1, H, W, 0, src.width - W, H);
        if (H < src.height) px.drawImage(src, 0, H - 1, src.width, 1, 0, H, src.width, src.height - H);
      }
      const sx = src.getContext('2d', { willReadFrequently: true });
      const out = mk(W * F, H * F), ox = out.getContext('2d');
      if (!ox) throw userError(`This device could not make a ${W * F} × ${H * F} image. Choose 2×, or add a Resize step above Upscale.`);
      ox.imageSmoothingQuality = 'high';
      const tmp = F === 4 ? null : mk(1, 1);
      const total = Math.ceil(W / T) * Math.ceil(H / T);
      let done = 0;
      const started = performance.now();
      for (let y0 = 0; y0 < H; y0 += T) {
        for (let x0 = 0; x0 < W; x0 += T) {
          let eta = '';
          if (done) {                                            // time left, from the average tile so far
            const left = (performance.now() - started) / done * (total - done) / 1000;
            eta = left >= 90 ? ` · about ${Math.round(left / 60)} min left` : left >= 10 ? ` · about ${Math.round(left / 5) * 5} s left` : '';
          }
          setStatus(`Upscaling: ${Math.round(done++ / total * 100)}%${eta}`);
          const w = Math.min(T, W - x0), h = Math.min(T, H - y0);
          let px, py, pw, ph;
          if (cfg.fixed) {
            pw = ph = cfg.fixed;
            px = clamp(x0 - P, 0, src.width - pw); py = clamp(y0 - P, 0, src.height - ph);
          } else {
            px = Math.max(0, x0 - P); py = Math.max(0, y0 - P);
            pw = Math.min(W, x0 + w + P) - px; ph = Math.min(H, y0 + h + P) - py;
          }
          const d = sx.getImageData(px, py, pw, ph).data, n = pw * ph;
          const f = new Float32Array(3 * n);
          for (let i = 0; i < n; i++) { f[i] = d[i * 4] / 255; f[n + i] = d[i * 4 + 1] / 255; f[2 * n + i] = d[i * 4 + 2] / 255; }
          const res = await m.session.run({ [cfg.input]: new m.ort.Tensor('float32', f, [1, 3, ph, pw]) });
          const o = res[cfg.output].data, OW = pw * 4, plane = OW * ph * 4;
          const tw = w * 4, th = h * 4, offX = (x0 - px) * 4, offY = (y0 - py) * 4;
          const img = new ImageData(tw, th), id = img.data;
          for (let y = 0; y < th; y++) {
            for (let x = 0; x < tw; x++) {
              const si = (y + offY) * OW + x + offX, di = (y * tw + x) * 4;
              id[di] = o[si] * 255; id[di + 1] = o[plane + si] * 255; id[di + 2] = o[2 * plane + si] * 255; id[di + 3] = 255;
            }
          }
          if (F === 4) ox.putImageData(img, x0 * 4, y0 * 4);
          else {
            tmp.width = tw; tmp.height = th;
            tmp.getContext('2d').putImageData(img, 0, 0);
            ox.drawImage(tmp, x0 * F, y0 * F, w * F, h * F);
          }
          await new Promise((r) => setTimeout(r));     // let the page repaint between tiles
        }
      }
      ox.globalCompositeOperation = 'destination-in';  // the model is RGB only: carry transparency over from the source
      ox.imageSmoothingQuality = 'high';
      ox.drawImage(c, 0, 0, out.width, out.height);
      return out;
    } catch (e) { throw e.userMsg ? e : userError('Upscaling could not run in this browser. Turn the step off to keep working.', e); }
  });
  bgQueue = job.catch(() => {});
  const canvas = await job;
  if (canvas.width * canvas.height > 20e6) {            // ~80 MB or more each: keep only the latest one in memory
    if (bigUpscale && bigUpscale !== ctx.file) upscales.delete(bigUpscale);
    bigUpscale = ctx.file;
  }
  upscales.set(ctx.file, { key, canvas });
  return canvas;
}

/* ---------- face restoration (MediaPipe face detector + GFPGAN v1.4, both Apache-2.0) ---------- */
const MP_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const FACE_DET = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
// The half-precision file gave grey output on WebGPU in testing, so the graphics card gets the full-precision file
// and the CPU path (about 45 s per face) gets the smaller one.
const FACE_MODEL = navigator.gpu
  ? { url: 'https://huggingface.co/neurobytemind/GFPGANv1.4.onnx/resolve/main/GFPGANv1.4.onnx', size: '340 MB', ep: 'webgpu' }
  : { url: 'https://huggingface.co/sidkonduru/gfpgan-v1.4-onnx/resolve/main/gfpgan14-fp16.onnx', size: '170 MB', ep: 'wasm' };
// where GFPGAN expects the eyes and mouth centre inside its 512 px crop (FFHQ alignment)
const FACE_TEMPLATE = [[192.98, 239.95], [318.90, 240.19], [257.18, 371.28]];
const faceCache = new WeakMap();       // File -> {key, faces: [{inv, canvas}]}
let faceTools = null;
function loadFaceTools() {
  if (!faceTools) {
    faceTools = (async () => {
      setStatus(`Getting the face model ready (${FACE_MODEL.size}, first time only)…`);
      const mp = await import(MP_BASE + '/vision_bundle.mjs');
      const fileset = await mp.FilesetResolver.forVisionTasks(MP_BASE + '/wasm');
      const detector = await mp.FaceDetector.createFromOptions(fileset, { baseOptions: { modelAssetPath: FACE_DET }, runningMode: 'IMAGE', minDetectionConfidence: 0.4 });
      const ort = await import(ORT_BASE + 'ort.webgpu.min.mjs');
      ort.env.wasm.wasmPaths = ORT_BASE;
      const buf = await fetchModel(FACE_MODEL.url, 'face', FACE_MODEL.size);
      const session = await ort.InferenceSession.create(buf, { executionProviders: [FACE_MODEL.ep] });
      return { ort, session, detector };
    })();
    faceTools.catch(() => { faceTools = null; });
  }
  return faceTools;
}
// least-squares similarity transform (rotate + uniform scale + move) taking points p onto points q
function similarity(p, q) {
  const n = p.length, mean = (a, i) => a.reduce((s, v) => s + v[i], 0) / n;
  const px = mean(p, 0), py = mean(p, 1), qx = mean(q, 0), qy = mean(q, 1);
  let a = 0, b = 0, d = 0;
  for (let i = 0; i < n; i++) {
    const x = p[i][0] - px, y = p[i][1] - py, u = q[i][0] - qx, v = q[i][1] - qy;
    a += x * u + y * v; b += x * v - y * u; d += x * x + y * y;
  }
  a /= d; b /= d;
  return { a, b, tx: qx - (a * px - b * py), ty: qy - (b * px + a * py) };
}
async function findAndRestoreFaces(c, ctx) {
  const hit = faceCache.get(ctx.file);
  if (hit && hit.key === ctx.prior) return hit.faces;
  const job = bgQueue.then(async () => {
    let t;
    try { t = await loadFaceTools(); }
    catch (e) { throw userError('The face model could not be loaded. Check your connection and try again.', e); }
    try {
      setStatus('Looking for faces…');
      const found = t.detector.detect(c).detections.filter((d) => d.keypoints && d.keypoints.length >= 4).slice(0, 12);
      const faces = [], S = 512, n = S * S;
      for (let i = 0; i < found.length; i++) {
        const k = found[i].keypoints.map((p) => [p.x * c.width, p.y * c.height]);
        const m = similarity([k[0], k[1], k[3]], FACE_TEMPLATE);       // right eye, left eye, mouth
        const scale = Math.hypot(m.a, m.b);
        if (scale < 0.75) continue;                                    // face is already larger than the model's 512 px output
        setStatus(`Restoring faces: ${i + 1} of ${found.length}`);
        const crop = mk(S, S), cx = crop.getContext('2d', { willReadFrequently: true });
        cx.imageSmoothingQuality = 'high';
        cx.setTransform(m.a, m.b, -m.b, m.a, m.tx, m.ty);
        cx.drawImage(c, 0, 0);
        cx.setTransform(1, 0, 0, 1, 0, 0);
        const d = cx.getImageData(0, 0, S, S).data, f = new Float32Array(3 * n);
        for (let j = 0; j < n; j++) { f[j] = d[j * 4] / 127.5 - 1; f[n + j] = d[j * 4 + 1] / 127.5 - 1; f[2 * n + j] = d[j * 4 + 2] / 127.5 - 1; }
        const res = await t.session.run({ [t.session.inputNames[0]]: new t.ort.Tensor('float32', f, [1, 3, S, S]) });
        const o = res[t.session.outputNames[0]].data, img = new ImageData(S, S), id = img.data;
        for (let j = 0; j < n; j++) {
          id[j * 4] = (o[j] + 1) * 127.5; id[j * 4 + 1] = (o[n + j] + 1) * 127.5; id[j * 4 + 2] = (o[2 * n + j] + 1) * 127.5; id[j * 4 + 3] = 255;
        }
        cx.putImageData(img, 0, 0);
        const mask = mk(S, S), mx = mask.getContext('2d');             // soft-edged patch so the paste has no visible border
        mx.filter = 'blur(22px)'; mx.fillRect(52, 52, S - 104, S - 104);
        cx.globalCompositeOperation = 'destination-in'; cx.drawImage(mask, 0, 0);
        const s2 = m.a * m.a + m.b * m.b, ia = m.a / s2, ib = -m.b / s2;
        faces.push({ canvas: crop, inv: [ia, ib, -ib, ia, -(ia * m.tx - ib * m.ty), -(ib * m.tx + ia * m.ty)] });
        await new Promise((r) => setTimeout(r));
      }
      return faces;
    } catch (e) { throw userError('Face restoration could not run in this browser. Turn the step off to keep working.', e); }
  });
  bgQueue = job.catch(() => {});
  const faces = await job;
  faceCache.set(ctx.file, { key: ctx.prior, faces });
  return faces;
}

const APPLY = {
  async restorefaces(c, s, ctx) {
    const faces = await findAndRestoreFaces(c, ctx);
    if (!faces.length) return c;
    const o = mk(c.width, c.height), x = o.getContext('2d');
    x.drawImage(c, 0, 0);
    x.imageSmoothingQuality = 'high';
    x.globalAlpha = clamp(s.strength, 0, 100) / 100;
    for (const f of faces) { x.setTransform(...f.inv); x.drawImage(f.canvas, 0, 0); }
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'destination-in';                   // keep any transparency the image already had
    x.drawImage(c, 0, 0);
    return o;
  },
  async upscale(c, s, ctx) {
    return upscale4(c, s, ctx);
  },
  async removebg(c, s, ctx) {
    const cut = await cutout(c, s, ctx);
    const o = mk(c.width, c.height), x = o.getContext('2d');
    if (s.bg === 'color') { x.fillStyle = s.color; x.fillRect(0, 0, o.width, o.height); }
    x.drawImage(cut, 0, 0);
    return o;
  },
  resize(c, s) {
    const W = c.width, H = c.height;
    let f = 1;
    if (s.mode === 'fit') f = Math.min(s.w / W, s.h / H);
    else if (s.mode === 'width') f = s.w / W;
    else if (s.mode === 'height') f = s.h / H;
    else f = s.pct / 100;
    if (s.noUp) f = Math.min(f, 1);
    if (!(f > 0) || f === 1) return c;
    return scaleTo(c, W * f, H * f);
  },
  crop(c, s) {
    const W = c.width, H = c.height;
    if (s.ratio === 'free') {
      const x0 = Math.round(clamp(s.fx, 0, 1) * W), y0 = Math.round(clamp(s.fy, 0, 1) * H);
      const o = mk(Math.min(W - x0, s.fw * W), Math.min(H - y0, s.fh * H));
      o.getContext('2d').drawImage(c, -x0, -y0);
      return o;
    }
    let [a, b] = s.ratio === 'custom' ? [s.rw, s.rh] : s.ratio.split(':').map(Number);
    const r = (a || 1) / (b || 1);
    let nw = W, nh = H;
    if (W / H > r) nw = H * r; else nh = W / r;
    const o = mk(nw, nh);
    o.getContext('2d').drawImage(c, -Math.round((W - o.width) * s.x / 100), -Math.round((H - o.height) * s.y / 100));
    return o;
  },
  rotate(c, s) {
    const a = Number(s.angle) || 0;
    if (!a && !s.flipH && !s.flipV) return c;
    const rad = a * Math.PI / 180, w = c.width, h = c.height;
    const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
    const free = a % 90 !== 0;
    // full bounding box, or (trim) the largest upright rectangle with no empty corners
    const [ow, oh] = free && s.trim ? inscribed(w, h, sin, cos) : [w * cos + h * sin, w * sin + h * cos];
    const o = mk(Math.round(ow * 1000) / 1000, Math.round(oh * 1000) / 1000);
    const x = o.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.translate(o.width / 2, o.height / 2);
    x.scale(s.flipH ? -1 : 1, s.flipV ? -1 : 1);
    x.rotate(rad);
    x.drawImage(c, -w / 2, -h / 2);
    return o;
  },
  adjust(c, s) {
    const o = mk(c.width, c.height);
    const x = o.getContext('2d');
    x.filter = `brightness(${s.bri}%) contrast(${s.con}%) saturate(${s.gray ? 0 : s.sat}%) blur(${s.blur}px)`;
    x.drawImage(c, 0, 0);
    return o;
  },
  watermark(c, s) {
    const text = String(s.text || '').trim();
    if (!text) return c;
    const o = mk(c.width, c.height);
    const x = o.getContext('2d');
    x.drawImage(c, 0, 0);
    const fs = Math.max(8, c.width * s.size / 100);
    x.font = `600 ${fs}px "Instrument Sans", "Segoe UI", sans-serif`;
    x.fillStyle = s.color;
    x.globalAlpha = s.opacity / 100;
    if (s.pos === 'tile') {
      x.textAlign = 'center'; x.textBaseline = 'middle';
      const tw = x.measureText(text).width + fs * 3, th = fs * 4;
      const d = Math.hypot(c.width, c.height);
      x.translate(c.width / 2, c.height / 2);
      x.rotate(-Math.PI / 6);
      for (let y = -d, row = 0; y <= d; y += th, row++) {
        for (let px = -d - (row % 2 ? tw / 2 : 0); px <= d; px += tw) x.fillText(text, px, y);
      }
    } else {
      const m = fs * 0.8, [v, h] = s.pos;
      x.textAlign = h === 'l' ? 'left' : h === 'r' ? 'right' : 'center';
      x.textBaseline = v === 't' ? 'top' : v === 'b' ? 'bottom' : 'middle';
      const px = h === 'l' ? m : h === 'r' ? c.width - m : c.width / 2;
      const py = v === 't' ? m : v === 'b' ? c.height - m : c.height / 2;
      x.fillText(text, px, py);
    }
    return o;
  },
};

async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // e.g. SVG, which createImageBitmap refuses from a file
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally { URL.revokeObjectURL(url); }
  }
}
const activeSteps = () => state.recipe.filter((s) => s.on);
async function render(file, stopBefore) {
  const bmp = await decode(file);
  if (!bmp.width || !bmp.height) throw new Error('empty image');
  let c = mk(bmp.width, bmp.height);
  c.getContext('2d').drawImage(bmp, 0, 0);
  if (bmp.close) bmp.close();
  const src = { w: c.width, h: c.height };
  let prior = '';
  for (const s of activeSteps()) {
    if (s.id === stopBefore) break;
    c = await APPLY[s.type](c, s, { file, prior });
    const { id, on, ...params } = s;
    prior += JSON.stringify(params);
  }
  return { canvas: c, src };
}

const NATIVE = ['image/jpeg', 'image/png', 'image/webp'];
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' };
const outType = (file) => state.out.format !== 'keep' ? state.out.format : NATIVE.includes(file.type) ? file.type : 'image/png';
const toBlob = (c, t, q) => new Promise((res, rej) => c.toBlob((b) => b ? res(b) : rej(new Error('encode failed')), t, q));

async function encode(canvas, type, file, src) {
  let c = canvas;
  if (type === 'image/jpeg') {           // JPEG has no transparency: put it on white
    const o = mk(c.width, c.height), x = o.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, o.width, o.height); x.drawImage(c, 0, 0);
    c = o;
  }
  const lossy = type !== 'image/png';
  const target = parseFloat(state.out.targetKB) * 1024;
  let blob;
  if (!(target > 0)) {
    blob = await toBlob(c, type, state.out.quality / 100);
  } else {
    if (lossy) {                          // find the best quality that fits
      let lo = 0.05, hi = 0.95;
      for (let i = 0; i < 7; i++) {
        const mid = (lo + hi) / 2, b = await toBlob(c, type, mid);
        if (b.size <= target) { blob = b; lo = mid; } else hi = mid;
      }
    }
    for (let i = 0; !blob && i < 14; i++) { // still too big: shrink the pixels
      const b = await toBlob(c, type, lossy ? 0.5 : undefined);
      if (b.size <= target || (c.width <= 16 && c.height <= 16)) { blob = b; break; }
      const f = clamp(Math.sqrt(target / b.size), 0.5, 0.9);
      c = scaleTo(c, c.width * f, c.height * f);
    }
    if (!blob) blob = await toBlob(c, type, lossy ? 0.5 : undefined);
  }
  // nothing changed and re-encoding made it bigger: hand back the original
  const untouched = !activeSteps().length && type === file.type && c.width === src.w && c.height === src.h;
  if (untouched && blob.size >= file.size && !(target > 0 && file.size > target)) {
    return { blob: file, w: src.w, h: src.h, kept: true };
  }
  return { blob, w: c.width, h: c.height, kept: false };
}
async function processFile(file) {
  const { canvas, src } = await render(file);
  const res = await encode(canvas, outType(file), file, src);
  return { ...res, src, type: res.kept ? file.type : outType(file) };
}

/* ---------- zip (stored, no compression: images are already compressed) ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
async function makeZip(entries) {
  const enc = new TextEncoder(), parts = [], central = [];
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  let offset = 0;
  for (const e of entries) {
    const data = new Uint8Array(await e.blob.arrayBuffer());
    const name = enc.encode(e.name), crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, 0, true); lh.setUint16(10, time, true); lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(lh.buffer, name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true); ch.setUint16(12, time, true); ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(ch.buffer, name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((n, p) => n + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}
function save(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/* ---------- recipe UI ---------- */
const stepsEl = $('#steps');
function persist() { store.set('cutmat.last', snapshot()); }
let refreshTimer;
function changed() {
  persist();
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 160);
}
function fieldEl(step, f) {
  if (f.type === 'note') return el('p', { class: 'hint' }, f.text(step));
  if (f.type === 'actions') {
    return el('div', { class: 'row actions' }, ...f.actions.map(([label, fn]) =>
      el('button', { class: 'btn', type: 'button', onclick: () => { fn(step); renderRecipe(); changed(); } }, typeof label === 'function' ? label(step) : label)));
  }
  const set = (v, rerender) => { step[f.k] = v; if (f.after) f.after(step); if (rerender) renderRecipe(); changed(); };
  if (f.type === 'check') {
    return el('label', { class: 'check' },
      el('input', { type: 'checkbox', checked: !!step[f.k], onchange: (e) => set(e.target.checked) }), f.label);
  }
  let input, out = null;
  if (f.type === 'select') {
    input = el('select', { value: String(step[f.k]), onchange: (e) => set(e.target.value, true) },
      ...f.options.map(([v, t]) => el('option', { value: v }, t)));
  } else if (f.type === 'range') {
    const unit = /^(px|%|°)$/.test(f.unit) ? f.unit : ' ' + f.unit;
    out = el('output', {}, `${step[f.k]}${unit}`);
    input = el('input', { type: 'range', min: f.min, max: f.max, step: f.step || 1, value: step[f.k], oninput: (e) => {
      out.textContent = `${e.target.value}${unit}`;
      set(Number(e.target.value));
    } });
  } else if (f.type === 'number') {
    input = el('input', { type: 'number', min: f.min, max: f.max, value: step[f.k], inputMode: 'numeric', oninput: (e) => {
      const v = Number(e.target.value);
      if (v >= f.min) set(clamp(Math.round(v), f.min, f.max));
    } });
  } else {
    input = el('input', { type: f.type, value: step[f.k], oninput: (e) => set(e.target.value) });
  }
  return el('label', { class: 'field' }, el('span', { class: 'lab' }, f.label, out), input);
}
function renderRecipe() {
  const focusPath = document.activeElement && stepsEl.contains(document.activeElement)
    ? [...stepsEl.querySelectorAll('input,select,button')].indexOf(document.activeElement) : -1;
  stepsEl.replaceChildren();
  if (!state.recipe.length) {
    stepsEl.append(el('p', { class: 'steps-empty' }, 'No steps yet. Images are only re-saved with the output settings — add a step below to change them.'));
  }
  state.recipe.forEach((step, i) => {
    const def = STEPS[step.type];
    const move = (d) => { state.recipe.splice(i + d, 0, state.recipe.splice(i, 1)[0]); renderRecipe(); changed(); };
    const head = el('div', { class: 'step-head' },
      el('label', { class: 'check' },
        el('input', { type: 'checkbox', checked: step.on, 'aria-label': `Use ${def.label} step`, onchange: (e) => { step.on = e.target.checked; renderRecipe(); changed(); } }),
        def.label),
      el('button', { class: 'icon', type: 'button', 'aria-label': `Move ${def.label} up`, disabled: i === 0, onclick: () => move(-1) }, '↑'),
      el('button', { class: 'icon', type: 'button', 'aria-label': `Move ${def.label} down`, disabled: i === state.recipe.length - 1, onclick: () => move(1) }, '↓'),
      el('button', { class: 'icon', type: 'button', 'aria-label': `Remove ${def.label}`, onclick: () => { state.recipe.splice(i, 1); renderRecipe(); changed(); } }, '✕'));
    const body = el('div', { class: 'step-body' }, ...def.fields.filter((f) => !f.show || f.show(step)).map((f) => fieldEl(step, f)));
    stepsEl.append(el('div', { class: 'step' + (step.on ? '' : ' off') }, head, body));
  });
  if (focusPath >= 0) { const t = stepsEl.querySelectorAll('input,select,button')[focusPath]; if (t) t.focus(); }
}
for (const type in STEPS) {
  $('#add-row').append(el('button', { class: 'btn', type: 'button', onclick: () => {
    const step = { id: uid++, type, on: true, ...STEPS[type].defaults };
    state.recipe.push(step);
    if (type === 'crop') cropEdit = step.id;      // open straight into the drag-a-box editor
    renderRecipe(); changed();
  } }, '+ ' + STEPS[type].label));
}

/* ---------- saved recipes ---------- */
const presetList = $('#preset-list'), presetDel = $('#preset-del'), presetName = $('#preset-name');
function renderPresets(selected = '') {
  const all = store.get('cutmat.presets', {});
  const names = Object.keys(all).sort();
  presetList.replaceChildren(el('option', { value: '' }, names.length ? 'Load a saved recipe…' : 'Nothing saved yet'),
    ...names.map((n) => el('option', { value: n }, n)));
  presetList.disabled = !names.length;
  presetList.value = selected;
  presetDel.hidden = !selected;
}
presetList.addEventListener('change', () => {
  const name = presetList.value, all = store.get('cutmat.presets', {});
  presetDel.hidden = !name;
  if (!name || !all[name]) return;
  loadSnapshot(all[name]);
  presetName.value = name;
  renderRecipe(); syncOutput(); changed();
});
$('#preset-save').addEventListener('click', () => {
  const name = presetName.value.trim();
  if (!name) { presetName.focus(); return; }
  const all = store.get('cutmat.presets', {});
  all[name] = snapshot();
  store.set('cutmat.presets', all);
  renderPresets(name);
});
presetDel.addEventListener('click', () => {
  const all = store.get('cutmat.presets', {});
  delete all[presetList.value];
  store.set('cutmat.presets', all);
  renderPresets();
});

/* ---------- output panel ---------- */
const oFormat = $('#o-format'), oQuality = $('#o-quality'), oQualityV = $('#o-quality-v'), oNote = $('#o-quality-note'), oTarget = $('#o-target'), oPattern = $('#o-pattern');
function syncOutput() {
  if (![...oFormat.options].some((o) => o.value === state.out.format)) state.out.format = 'keep';
  oFormat.value = state.out.format;
  oQuality.value = state.out.quality;
  oTarget.value = state.out.targetKB;
  oPattern.value = state.out.pattern;
  syncQualityNote();
}
function syncQualityNote() {
  oQualityV.textContent = state.out.quality;
  const hasTarget = parseFloat(state.out.targetKB) > 0;
  const png = state.out.format === 'image/png';
  oQuality.disabled = hasTarget || png;
  oNote.hidden = !(hasTarget || png);
  oNote.textContent = hasTarget
    ? 'Quality is chosen for you to fit the size limit. Images shrink in pixels only if that is not enough.'
    : 'PNG is lossless, so quality does not apply. Use JPEG or WebP for smaller photos.';
}
function initOutput(avif) {
  const opts = [['keep', 'Same as original'], ['image/jpeg', 'JPEG'], ['image/png', 'PNG'], ['image/webp', 'WebP']];
  if (avif) opts.push(['image/avif', 'AVIF']);
  oFormat.replaceChildren(...opts.map(([v, t]) => el('option', { value: v }, t)));
  syncOutput();
}
oFormat.addEventListener('change', () => { state.out.format = oFormat.value; syncQualityNote(); changed(); });
oQuality.addEventListener('input', () => { state.out.quality = Number(oQuality.value); syncQualityNote(); changed(); });
oTarget.addEventListener('input', () => { state.out.targetKB = oTarget.value; syncQualityNote(); changed(); });
oPattern.addEventListener('input', () => { state.out.pattern = oPattern.value; persist(); });

/* ---------- files ---------- */
const fileInput = $('#file'), strip = $('#strip'), empty = $('#empty'), frame = $('#frame'), stage = $('#stage');
const imgAfter = $('#img-after'), imgBefore = $('#img-before'), stageMsg = $('#stage-msg');
const readout = $('#readout'), statsEl = $('#stats'), toggleOrig = $('#toggle-orig'), exportBtn = $('#export'), exportMsg = $('#export-msg');
const current = () => state.files.find((f) => f.id === state.sel);
function setStatus(text) { statsEl.textContent = text; }

function addFiles(list) {
  const imgs = [...list].filter((f) => f.type.startsWith('image/'));
  const skipped = list.length - imgs.length;
  for (const file of imgs) state.files.push({ id: uid++, file, url: URL.createObjectURL(file) });
  if (imgs.length) state.sel = state.files[state.files.length - imgs.length].id;
  exportMsg.textContent = skipped ? `${skipped} file${skipped > 1 ? 's were' : ' was'} skipped because ${skipped > 1 ? 'they are' : 'it is'} not an image.` : '';
  renderFiles(); refresh();
}
function removeFile(id) {
  const i = state.files.findIndex((f) => f.id === id);
  if (i < 0) return;
  URL.revokeObjectURL(state.files[i].url);
  state.files.splice(i, 1);
  if (state.sel === id) state.sel = (state.files[i] || state.files[i - 1] || {}).id ?? null;
  renderFiles(); refresh();
}
function renderFiles() {
  const n = state.files.length;
  empty.hidden = n > 0;
  strip.hidden = readout.hidden = n === 0;
  exportBtn.disabled = n === 0;
  exportBtn.textContent = n === 0 ? 'Download' : n === 1 ? 'Download image' : `Download ${n} images (.zip)`;
  strip.replaceChildren(
    ...state.files.map((f) => el('div', { class: 'thumb-wrap' },
      el('button', { class: 'thumb', type: 'button', title: f.file.name, 'aria-label': f.file.name, 'aria-current': String(f.id === state.sel),
        onclick: () => { state.sel = f.id; renderFiles(); refresh(); } },
        el('img', { src: f.url, alt: '', loading: 'lazy' })),
      el('button', { class: 'thumb-x', type: 'button', 'aria-label': `Remove ${f.file.name}`, onclick: () => removeFile(f.id) }, '✕'))),
    el('button', { class: 'strip-btn', type: 'button', onclick: () => fileInput.click() }, 'Add more'),
    el('button', { class: 'strip-btn', type: 'button', onclick: () => { state.files.forEach((f) => URL.revokeObjectURL(f.url)); state.files = []; state.sel = null; renderFiles(); refresh(); } }, 'Clear all'));
}
$('#pick').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });
let dragDepth = 0;
addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging'); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
addEventListener('paste', (e) => { const fs = e.clipboardData && e.clipboardData.files; if (fs && fs.length) { e.preventDefault(); addFiles(fs); } });
addEventListener('keydown', (e) => {
  if (!/^Arrow(Left|Right)$/.test(e.key) || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || state.files.length < 2) return;
  const i = state.files.findIndex((f) => f.id === state.sel) + (e.key === 'ArrowRight' ? 1 : -1);
  if (state.files[i]) { state.sel = state.files[i].id; renderFiles(); refresh(); }
});

/* ---------- preview ---------- */
let token = 0, afterUrl = null, view = null, showOrig = false;
function fitFrame() {
  if (!view) return;
  const box = stage.getBoundingClientRect();
  const d = showOrig && !view.match ? view.src : view.out;
  const s = Math.min((box.width - 56) / d.w, (box.height - 56) / d.h, 1);
  frame.style.width = Math.max(1, Math.round(d.w * s)) + 'px';
  frame.style.height = Math.max(1, Math.round(d.h * s)) + 'px';
}
new ResizeObserver(fitFrame).observe(stage);
function setOrig(on) {
  showOrig = on;
  toggleOrig.setAttribute('aria-pressed', String(on));
  frame.classList.toggle('orig', on && view && !view.match);
  fitFrame();
}
toggleOrig.addEventListener('click', () => setOrig(!showOrig));
$('#cmp').addEventListener('input', (e) => frame.style.setProperty('--pos', e.target.value + '%'));

/* zoom and pan the preview: scroll to zoom at the pointer, drag to move, double-click to reset */
const zoom = { z: 1, x: 0, y: 0 }, zoomBtn = $('#zoom-reset'), cmpInput = $('#cmp');
let rotPreview = 0, zoomedItem = null;
function applyTransform() {
  const r = frame.getBoundingClientRect ? { w: frame.offsetWidth, h: frame.offsetHeight } : { w: 0, h: 0 };
  zoom.x = clamp(zoom.x, -r.w * zoom.z / 2, r.w * zoom.z / 2);       // keep part of the image in view
  zoom.y = clamp(zoom.y, -r.h * zoom.z / 2, r.h * zoom.z / 2);
  frame.style.transform = zoom.z === 1 && !rotPreview ? '' : `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.z}) rotate(${rotPreview}deg)`;
  frame.style.setProperty('--iz', 1 / zoom.z);
  frame.classList.toggle('zoomed', zoom.z > 1);
  zoomBtn.hidden = zoom.z === 1;
  zoomBtn.textContent = `${Math.round(zoom.z * 100)}% · Reset zoom`;
}
function resetZoom() { zoom.z = 1; zoom.x = zoom.y = 0; applyTransform(); }
zoomBtn.addEventListener('click', resetZoom);
stage.addEventListener('dblclick', (e) => { if (zoom.z > 1 && !e.target.closest('button')) resetZoom(); });
stage.addEventListener('wheel', (e) => {
  if (frame.hidden) return;
  e.preventDefault();
  const r = stage.getBoundingClientRect();
  const px = e.clientX - (r.left + r.width / 2), py = e.clientY - (r.top + r.height / 2);
  const nz = clamp(zoom.z * Math.exp(-e.deltaY * 0.0015), 1, 16);
  if (nz === 1) { zoom.x = zoom.y = 0; } else {
    const k = nz / zoom.z;                                           // keep the point under the pointer fixed
    zoom.x = px - k * (px - zoom.x); zoom.y = py - k * (py - zoom.y);
  }
  zoom.z = nz;
  applyTransform();
}, { passive: false });
stage.addEventListener('pointerdown', (e) => {
  if (zoom.z === 1 || frame.hidden || e.button !== 0 || e.target.closest('.rot, button')) return;
  e.preventDefault();
  stage.setPointerCapture(e.pointerId);
  const onHandle = e.target.classList.contains('handle');
  const sx = e.clientX, sy = e.clientY, ox = zoom.x, oy = zoom.y;
  const move = (ev) => {
    if (onHandle) {                                                  // drag the compare line
      const fr = frame.getBoundingClientRect();
      const pos = clamp((ev.clientX - fr.left) / fr.width * 100, 0, 100);
      cmpInput.value = pos; frame.style.setProperty('--pos', pos + '%');
    } else { zoom.x = ox + ev.clientX - sx; zoom.y = oy + ev.clientY - sy; applyTransform(); }
  };
  const up = () => { stage.removeEventListener('pointermove', move); stage.removeEventListener('pointerup', up); stage.removeEventListener('pointercancel', up); };
  stage.addEventListener('pointermove', move);
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
});

/* free crop: while editing, the preview shows the image as it reaches the Crop step, with a draggable box on top */
const cropBox = $('#cropbox');
function cropStep() {
  const s = state.recipe.find((r) => r.id === cropEdit);
  if (s && s.on && s.type === 'crop' && s.ratio === 'free') return s;
  cropEdit = null;
  return null;
}
function drawCropBox(s) {
  cropBox.style.left = s.fx * 100 + '%'; cropBox.style.top = s.fy * 100 + '%';
  cropBox.style.width = s.fw * 100 + '%'; cropBox.style.height = s.fh * 100 + '%';
  if (view) setStatus(`Crop to ${Math.round(s.fw * view.out.w)} × ${Math.round(s.fh * view.out.h)} px · drag the box or its handles, then press Done`);
}
cropBox.addEventListener('pointerdown', (e) => {
  const s = cropStep();
  if (!s || e.button !== 0) return;
  e.preventDefault(); e.stopPropagation();           // keep the pan and rotate handlers out of it
  cropBox.setPointerCapture(e.pointerId);
  const r = frame.getBoundingClientRect(), h = e.target.dataset.h || 'move', MIN = 0.03;
  const st = { x: e.clientX, y: e.clientY, x0: s.fx, y0: s.fy, x1: s.fx + s.fw, y1: s.fy + s.fh };
  const move = (ev) => {
    const dx = (ev.clientX - st.x) / r.width, dy = (ev.clientY - st.y) / r.height;
    let { x0, y0, x1, y1 } = st;
    if (h === 'move') {
      const mx = clamp(dx, -x0, 1 - x1), my = clamp(dy, -y0, 1 - y1);
      x0 += mx; x1 += mx; y0 += my; y1 += my;
    } else {
      if (h.includes('w')) x0 = clamp(x0 + dx, 0, x1 - MIN);
      if (h.includes('e')) x1 = clamp(x1 + dx, x0 + MIN, 1);
      if (h.includes('n')) y0 = clamp(y0 + dy, 0, y1 - MIN);
      if (h.includes('s')) y1 = clamp(y1 + dy, y0 + MIN, 1);
    }
    s.fx = x0; s.fy = y0; s.fw = x1 - x0; s.fh = y1 - y0;
    drawCropBox(s);
  };
  const up = () => {
    cropBox.removeEventListener('pointermove', move); cropBox.removeEventListener('pointerup', up); cropBox.removeEventListener('pointercancel', up);
    persist();
  };
  cropBox.addEventListener('pointermove', move); cropBox.addEventListener('pointerup', up); cropBox.addEventListener('pointercancel', up);
});

/* drag a corner of the preview to rotate: edits the last active Rotate step, so it applies to every image */
const rotStep = () => [...state.recipe].reverse().find((s) => s.type === 'rotate' && s.on);
function syncRotatable() { frame.classList.toggle('rotatable', !!rotStep()); }
frame.addEventListener('pointerdown', (e) => {
  const st = rotStep();
  if (!st || !e.target.classList.contains('rot')) return;
  e.preventDefault();
  const handle = e.target;
  handle.setPointerCapture(e.pointerId);
  const r = frame.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const a0 = Math.atan2(e.clientY - cy, e.clientX - cx), base = Number(st.angle) || 0;
  const dir = st.flipH !== st.flipV ? -1 : 1;      // a single flip mirrors the turn direction
  let next = base;
  const move = (ev) => {
    let d = (Math.atan2(ev.clientY - cy, ev.clientX - cx) - a0) * 180 / Math.PI;
    next = normAngle(base + dir * d);
    if (ev.shiftKey) next = normAngle(Math.round(next / 15) * 15);
    d = dir * (next - base);
    rotPreview = d; applyTransform();
    setStatus(`Rotate: ${next}°`);
  };
  const up = () => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', up);
    handle.removeEventListener('pointercancel', up);
    if (next === base) { rotPreview = 0; applyTransform(); refresh(); return; }
    st.angle = next;
    renderRecipe(); changed();                     // the transform is cleared when the new preview lands
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up);
  handle.addEventListener('pointercancel', up);
});

async function refresh() {
  const item = current();
  const t = ++token;
  syncRotatable();
  if ((item && item.id) !== zoomedItem) { zoomedItem = item && item.id; zoom.z = 1; zoom.x = zoom.y = 0; }
  if (!item) { rotPreview = 0; applyTransform(); frame.hidden = true; stageMsg.hidden = true; view = null; return; }
  frame.classList.add('busy');
  try {
    const cs = cropStep();
    if (cs) {                                        // crop editing: show the uncropped image with the box over it
      const { canvas, src } = await render(item.file, cs.id);
      const blob = await toBlob(canvas, 'image/webp', 0.9);
      if (t !== token) return;
      if (afterUrl) URL.revokeObjectURL(afterUrl);
      afterUrl = URL.createObjectURL(blob);
      imgAfter.src = afterUrl; imgBefore.src = item.url;
      view = { src, out: { w: canvas.width, h: canvas.height }, match: false };
      frame.classList.remove('cmp', 'orig'); frame.classList.add('cropping');
      toggleOrig.hidden = true; stageMsg.hidden = true; frame.hidden = false; showOrig = false;
      fitFrame(); drawCropBox(cs);
      return;
    }
    frame.classList.remove('cropping');
    const r = await processFile(item.file);
    if (t !== token) return;
    if (afterUrl) URL.revokeObjectURL(afterUrl);
    afterUrl = URL.createObjectURL(r.blob);
    imgAfter.src = afterUrl;
    imgBefore.src = item.url;
    view = { src: r.src, out: { w: r.w, h: r.h }, match: Math.abs(r.src.w / r.src.h - r.w / r.h) < 0.01 };
    frame.classList.toggle('cmp', view.match);
    toggleOrig.hidden = view.match;
    stageMsg.hidden = true; frame.hidden = false;
    setOrig(view.match ? false : showOrig);
    const pct = Math.round((1 - r.blob.size / item.file.size) * 100);
    const delta = r.kept ? 'already as small as it gets — original kept' : pct >= 0 ? `${pct}% smaller` : `${-pct}% larger`;
    statsEl.replaceChildren(
      `${r.src.w} × ${r.src.h} · ${fmtBytes(item.file.size)}  →  ${r.w} × ${r.h} · ${fmtBytes(r.blob.size)} ${EXT[r.type].toUpperCase()}  `,
      el('span', { class: 'saved-pct' }, delta));
  } catch (err) {
    if (t !== token) return;
    console.error(err);
    view = null; frame.hidden = true; toggleOrig.hidden = true;
    stageMsg.hidden = false;
    stageMsg.textContent = err.userMsg || `This browser can't open ${item.file.name}. Try a JPEG, PNG, WebP, GIF, AVIF, BMP or SVG file.`;
    statsEl.textContent = '';
  } finally {
    if (t === token) { frame.classList.remove('busy'); rotPreview = 0; applyTransform(); }
  }
}

/* ---------- export ---------- */
function outName(item, r, n, used) {
  const base = item.file.name.replace(/\.[^.]+$/, '');
  let name = (state.out.pattern.trim() || '{name}')
    .replace(/\{name\}/g, base).replace(/\{w\}/g, r.w).replace(/\{h\}/g, r.h).replace(/\{n\}/g, String(n).padStart(2, '0'))
    .replace(/[\\/:*?"<>|]/g, '_');
  const ext = EXT[r.type];
  let full = `${name}.${ext}`, k = 2;
  while (used.has(full.toLowerCase())) full = `${name}-${k++}.${ext}`;
  used.add(full.toLowerCase());
  return full;
}
exportBtn.addEventListener('click', async () => {
  const items = [...state.files], label = exportBtn.textContent;
  const entries = [], failed = [], used = new Set();
  let before = 0, after = 0, reason = '';
  exportBtn.disabled = true;
  for (let i = 0; i < items.length; i++) {
    exportBtn.textContent = `Processing ${i + 1} of ${items.length}…`;
    try {
      const r = await processFile(items[i].file);
      entries.push({ name: outName(items[i], r, i + 1, used), blob: r.blob });
      before += items[i].file.size; after += r.blob.size;
    } catch (err) { console.error(err); failed.push(items[i].file.name); if (err.userMsg) reason = ' ' + err.userMsg; }
  }
  if (entries.length === 1) save(entries[0].blob, entries[0].name);
  else if (entries.length) save(await makeZip(entries), 'cutmat-images.zip');
  exportBtn.textContent = label; exportBtn.disabled = false;
  const parts = [];
  if (entries.length) parts.push(`Downloaded ${entries.length} image${entries.length > 1 ? 's' : ''}: ${fmtBytes(before)} → ${fmtBytes(after)}.`);
  if (failed.length) parts.push(`Could not process: ${failed.join(', ')}.${reason}`);
  refresh();
  exportMsg.textContent = parts.join(' ');
});

/* ---------- start ---------- */
renderRecipe();
renderPresets();
initOutput(false);
mk(1, 1).toBlob((b) => { if (b && b.type === 'image/avif') initOutput(true); }, 'image/avif');
})();
