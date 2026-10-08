// Lecture de texte dans une image (Tesseract.js, chargé à la demande depuis un CDN, gratuit et hors serveur).
const V = '5.1.1';
const base = () => window.FARDE_OCR_BASE || 'https://cdn.jsdelivr.net/npm/';
let workerP = null;

function loadScript(src) {
  return new Promise((ok, ko) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = ok; s.onerror = () => ko(new Error('Module de lecture indisponible : vérifie ta connexion internet.'));
    document.head.appendChild(s);
  });
}

/** Prépare le lecteur (environ 3 Mo téléchargés la première fois, puis gardés en cache par le navigateur). */
export function getWorker(onProgress) {
  if (!workerP) {
    workerP = (async () => {
      const b = base();
      if (!window.Tesseract) await loadScript(`${b}tesseract.js@${V}/dist/tesseract.min.js`);
      const w = await window.Tesseract.createWorker('eng', 1, {
        workerPath: `${b}tesseract.js@${V}/dist/worker.min.js`,
        corePath: `${b}tesseract.js-core@${V}`,
        langPath: `${b}@tesseract.js-data/eng@1.0.0/4.0.0_best_int`,
        logger: (m) => onProgress?.(m),
      });
      await w.setParameters({
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/ ',
        tessedit_pageseg_mode: '11',     // texte épars : quelques mots sur une ligne
        preserve_interword_spaces: '1',
      });
      return w;
    })();
    workerP.catch(() => { workerP = null; });
  }
  return workerP;
}

/**
 * Extrait une zone d'une image ou d'une vidéo, en niveaux de gris contrastés, agrandie pour la lecture.
 * invert : texte clair sur fond sombre (cartes full art) -> on inverse.
 */
export function prepare(src, sx, sy, sw, sh, { width = 1400, invert = false } = {}) {
  const scale = width / sw;
  const c = document.createElement('canvas');
  c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const img = g.getImageData(0, 0, c.width, c.height), d = img.data;
  // Niveaux de gris + étirement du contraste (2e et 98e centiles)
  const hist = new Uint32Array(256), lum = new Uint8ClampedArray(d.length / 4);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) { const v = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000; lum[j] = v; hist[lum[j]]++; }
  const n = lum.length; let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > n * 0.02) { lo = v; break; } }
  acc = 0; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > n * 0.02) { hi = v; break; } }
  const k = 255 / Math.max(1, hi - lo);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    let v = (lum[j] - lo) * k; if (invert) v = 255 - v;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Texte lu dans un canvas. */
export async function readText(canvas) {
  const w = await getWorker();
  const { data } = await w.recognize(canvas);
  return data.text || '';
}
