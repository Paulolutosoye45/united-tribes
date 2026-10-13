/** Largest side of the stored portrait. Faces stay clear at this size and the file stays small. */
export const PHOTO_SIDE = 480;
/** The database accepts up to 150,000 bytes. Aim well under. */
export const PHOTO_TARGET_BYTES = 120_000;

/** The size to draw a picture at so its longest side is `side`, never bigger than the original. */
export function fitWithin(width: number, height: number, side: number = PHOTO_SIDE): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, side / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** The largest centred square inside a picture, as the crop to draw. */
export function centredSquare(width: number, height: number): { x: number; y: number; size: number } {
  const size = Math.min(width, height);
  return { x: Math.floor((width - size) / 2), y: Math.floor((height - size) / 2), size };
}

/**
 * Turns a chosen picture into a small square JPEG, in the browser, and hands back base64 with no prefix.
 * It tries lower qualities until the file fits. Returns null if the file is not a picture the browser can read.
 */
export async function shrinkPhoto(file: File): Promise<{ base64: string; mime: "image/jpeg"; previewUrl: string } | null> {
  if (!file.type.startsWith("image/")) return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  const crop = centredSquare(bitmap.width, bitmap.height);
  const out = fitWithin(crop.size, crop.size);
  const canvas = document.createElement("canvas");
  canvas.width = out.width;
  canvas.height = out.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, crop.x, crop.y, crop.size, crop.size, 0, 0, out.width, out.height);
  bitmap.close();

  for (const quality of [0.86, 0.76, 0.66, 0.56, 0.46]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) return null;
    if (blob.size <= PHOTO_TARGET_BYTES || quality === 0.46) {
      if (blob.size > 149_000) return null;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { base64: btoa(binary), mime: "image/jpeg", previewUrl: URL.createObjectURL(blob) };
    }
  }
  return null;
}
