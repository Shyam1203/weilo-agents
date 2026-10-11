// Turns picked, pasted or dropped files into what a message carries. Images become PNG or JPEG
// data URLs (big or other-format ones are redrawn as JPEG, at most MAX_SIDE pixels on the longer
// side, so messages stay small); other files become base64.

const MAX_SIDE = 2048;
const MAX_BYTES = 3 * 1024 * 1024;

const readAsDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Cannot read ${blob instanceof File ? blob.name : "the file"}.`));
    reader.readAsDataURL(blob);
  });

export const base64Of = async (file: File) => (await readAsDataUrl(file)).split(",")[1];

export async function toImageDataUrl(file: File): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`Cannot open ${file.name} as an image.`);
  }
  const fits = bitmap.width <= MAX_SIDE && bitmap.height <= MAX_SIDE;
  if (/^image\/(png|jpeg)$/.test(file.type) && fits && file.size <= MAX_BYTES) {
    bitmap.close();
    return readAsDataUrl(file);
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff"; // JPEG has no transparency
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.88);
}
