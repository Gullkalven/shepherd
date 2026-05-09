/** Client-side prep for room documentation photos: resize + WebP/JPEG to keep uploads small on mobile. */

const TARGET_MAX_BYTES = 950 * 1024;
const INITIAL_MAX_EDGE = 2048;
const MIN_MAX_EDGE = 1024;

function detectWebpEncode(): boolean {
  try {
    const c = document.createElement('canvas');
    c.width = 2;
    c.height = 2;
    const d = c.toDataURL('image/webp', 0.5);
    return d.startsWith('data:image/webp');
  } catch {
    return false;
  }
}

function blobToFile(blob: Blob, originalName: string, mime: string): File {
  const ext = mime === 'image/webp' ? '.webp' : '.jpg';
  const stem = originalName.replace(/\.[^.]+$/, '') || 'photo';
  const safeStem = stem.replace(/[^\w.-]+/g, '_').slice(0, 120) || 'photo';
  return new File([blob], `${safeStem}${ext}`, { type: mime, lastModified: Date.now() });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), type, quality);
  });
}

function renderToCanvas(bitmap: ImageBitmap, maxEdge: number, whiteMatte: boolean): HTMLCanvasElement {
  const srcW = bitmap.width;
  const srcH = bitmap.height;
  const scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
  const tw = Math.max(1, Math.round(srcW * scale));
  const th = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  if (whiteMatte) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, tw, th);
  }
  ctx.drawImage(bitmap, 0, 0, tw, th);
  return canvas;
}

/**
 * Returns a smaller raster file when practical; returns the original file if decoding fails,
 * or for SVG/GIF, or if re-encoding would not help.
 */
export async function compressImageForUpload(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') return file;

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  try {
    const maxSrcEdge = Math.max(bitmap.width, bitmap.height);
    if (file.size <= TARGET_MAX_BYTES && maxSrcEdge <= INITIAL_MAX_EDGE) {
      return file;
    }

    const webpOk = detectWebpEncode();
    const needsMatteForJpeg =
      file.type === 'image/png' || file.type === 'image/webp' || file.type === 'image/avif';

    const webpQs = [0.82, 0.74, 0.66, 0.58, 0.52, 0.46];
    const jpegQs = [0.85, 0.76, 0.68, 0.6, 0.52, 0.46];

    let best: { blob: Blob; mime: string } | null = null;

    const consider = (blob: Blob | null, mime: string) => {
      if (!blob) return;
      if (!best || blob.size < best.blob.size) best = { blob, mime };
    };

    const preferCompressed = () => maxSrcEdge > INITIAL_MAX_EDGE;

    let maxEdge = INITIAL_MAX_EDGE;
    while (maxEdge >= MIN_MAX_EDGE) {
      const canvasWebp = renderToCanvas(bitmap, maxEdge, false);
      if (webpOk) {
        for (const q of webpQs) {
          const blob = await canvasToBlob(canvasWebp, 'image/webp', q);
          consider(blob, 'image/webp');
          if (blob && blob.size <= TARGET_MAX_BYTES) {
            const out = blobToFile(blob, file.name, 'image/webp');
            if (preferCompressed() || out.size < file.size) return out;
            return file;
          }
        }
      }

      const canvasJpeg = renderToCanvas(bitmap, maxEdge, needsMatteForJpeg);
      for (const q of jpegQs) {
        const blob = await canvasToBlob(canvasJpeg, 'image/jpeg', q);
        consider(blob, 'image/jpeg');
        if (blob && blob.size <= TARGET_MAX_BYTES) {
          const out = blobToFile(blob, file.name, 'image/jpeg');
          if (preferCompressed() || out.size < file.size) return out;
          return file;
        }
      }

      maxEdge = Math.round(maxEdge * 0.82);
    }

    if (best) {
      const out = blobToFile(best.blob, file.name, best.mime);
      if (preferCompressed() || out.size < file.size) return out;
      return file;
    }

    const lastCanvas = renderToCanvas(bitmap, MIN_MAX_EDGE, needsMatteForJpeg);
    const blob = await canvasToBlob(lastCanvas, 'image/jpeg', 0.42);
    if (blob && (preferCompressed() || blob.size < file.size)) {
      return blobToFile(blob, file.name, 'image/jpeg');
    }
  } finally {
    bitmap.close();
  }

  return file;
}
