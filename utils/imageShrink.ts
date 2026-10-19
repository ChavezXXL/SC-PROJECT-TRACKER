/**
 * imageShrink.ts — make a photo small enough to live inside a Firestore doc.
 *
 * Cloud Storage needs the paid Blaze plan, so on the free plan every photo
 * ends up embedded (base64) in its document, and a document can't pass
 * ~1 MB. A full-size phone photo (3–6 MB → 4–8 MB as base64) "saved" on the
 * device and was then rejected by the server and lost. This steps the size
 * and quality down until the photo fits a budget.
 */

/** Room for one embedded photo, leaving the rest of the doc space for its data. */
export const PHOTO_BUDGET_BYTES = 450_000;
/** Non-image attachments can't be shrunk — this is the most one file can be. */
export const FILE_BUDGET_BYTES = 600_000;

const STEPS: [number, number][] = [[1600, 0.7], [1400, 0.6], [1100, 0.55], [900, 0.5], [700, 0.45], [500, 0.4]];

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image'));
    img.src = src;
  });
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error('Could not read that file'));
    r.readAsDataURL(file);
  });
}

/** Rough decoded size of a data URL (what Firestore stores is the string itself). */
export const dataUrlBytes = (s: string) => s.length;

/**
 * Shrink an image (File/Blob or data URL) to a JPEG data URL under `budget`
 * characters. Throws if even the smallest step doesn't fit.
 */
export async function shrinkImage(input: Blob | string, budget = PHOTO_BUDGET_BYTES): Promise<string> {
  const src = typeof input === 'string' ? input : await readAsDataUrl(input);
  if (src.startsWith('data:image/') && src.length <= budget) return src;   // already fits
  const img = await loadImage(src);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process that image');
  for (const [maxW, q] of STEPS) {
    const scale = Math.min(1, maxW / Math.max(img.width, img.height));
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    ctx.fillStyle = '#fff';                       // transparent PNGs → white, not black
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = canvas.toDataURL('image/jpeg', q);
    if (out.length <= budget) return out;
  }
  throw new Error('That photo is too large to save — try a smaller one');
}
