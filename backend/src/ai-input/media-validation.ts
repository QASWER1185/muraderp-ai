import { ApiError } from "../errors/api-error.js";
import { decodeMedia, MEDIA_LIMIT } from "./document-extraction.js";
import type { AiInputSource } from "./ai-input.types.js";

const MAX_PIXELS = 16_000_000;
function invalid(): never { throw new ApiError(422, "INVALID_MEDIA", "Unreadable or invalid media. Upload a supported image, PDF (up to 3 pages), or non-empty audio recording."); }
function dimensions(width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width * height > MAX_PIXELS) {
    throw new ApiError(413, "MEDIA_DIMENSIONS_LIMIT", "Image dimensions exceed the 16 megapixel limit.");
  }
}
export async function validateAgentMedia(input: unknown, source: AiInputSource) {
  const media = decodeMedia(input), b = media.bytes;
  if (b.toString("base64") !== media.base64) invalid();
  if ((source === "voice") !== media.mimeType.startsWith("audio/")) invalid();
  if (b.length < 32) invalid();
  if (media.mimeType === "application/pdf") {
    if (!b.subarray(-2048).includes(Buffer.from("%%EOF"))) invalid();
  } else if (media.mimeType.startsWith("image/")) {
    let width = 0, height = 0;
    if (media.mimeType === "image/png") {
      if (b.toString("ascii", 12, 16) !== "IHDR" || !b.subarray(-12).includes(Buffer.from("IEND"))) invalid();
      width = b.readUInt32BE(16); height = b.readUInt32BE(20);
    } else if (media.mimeType === "image/jpeg") {
      if (b[b.length - 2] !== 255 || b[b.length - 1] !== 217) invalid();
      for (let p = 2; p + 8 < b.length;) {
        if (b[p] !== 255) invalid();
        const marker = b[p + 1]!, size = b.readUInt16BE(p + 2);
        if (size < 2 || p + size + 2 > b.length) invalid();
        if ([192,193,194].includes(marker)) { height = b.readUInt16BE(p + 5); width = b.readUInt16BE(p + 7); break; }
        p += size + 2;
      }
    } else {
      if (b.readUInt32LE(4) + 8 !== b.length) invalid();
      const chunk = b.toString("ascii", 12, 16);
      if (chunk === "VP8X") { width = b.readUIntLE(24,3) + 1; height = b.readUIntLE(27,3) + 1; }
      else if (chunk === "VP8 ") { width = b.readUInt16LE(26) & 0x3fff; height = b.readUInt16LE(28) & 0x3fff; }
      else if (chunk === "VP8L") { const bits = b.readUInt32LE(21); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1; }
      else invalid();
    }
    dimensions(width,height);
    try {
      const { loadImage } = await import("@napi-rs/canvas");
      const image = await loadImage(b);
      if (image.width !== width || image.height !== height) invalid();
    } catch { invalid(); }
  } else if (media.mimeType === "audio/wav") {
    if (b.readUInt32LE(4) + 8 !== b.length) invalid();
    let hasFormat = false, hasData = false;
    for (let p = 12; p + 8 <= b.length;) {
      const size = b.readUInt32LE(p + 4), end = p + 8 + size;
      if (end > b.length) invalid();
      const chunk = b.toString("ascii",p,p+4);
      if (chunk === "fmt " && size >= 16) {
        const encoding = b.readUInt16LE(p+8), channels = b.readUInt16LE(p+10), sampleRate = b.readUInt32LE(p+12);
        const byteRate = b.readUInt32LE(p+16), blockAlign = b.readUInt16LE(p+20), bits = b.readUInt16LE(p+22);
        hasFormat = encoding === 1 && channels >= 1 && channels <= 2 && sampleRate >= 8000 && sampleRate <= 192000 &&
          [8,16,24,32].includes(bits) && blockAlign === channels * bits / 8 && byteRate === sampleRate * blockAlign;
      }
      if (chunk === "data") hasData = size > 0 && b.subarray(p+8,end).some(value => value !== 0);
      p = end + size % 2;
    }
    if (!hasFormat || !hasData) invalid();
  } else {
    // Check a real container payload, not just an extension or a magic prefix.
    if (b.length < 128) invalid();
    if (media.mimeType === "audio/webm" && (!b.includes(Buffer.from("webm")) || !["A_OPUS","A_VORBIS"].some(codec=>b.includes(Buffer.from(codec))))) invalid();
    if (media.mimeType === "audio/mp4" && (!b.includes(Buffer.from("mdat")) || !b.includes(Buffer.from("moov")) || !b.includes(Buffer.from("soun")))) invalid();
    if (media.mimeType === "audio/ogg" && !["OpusHead","vorbis"].some(codec=>b.includes(Buffer.from(codec)))) invalid();
    if (media.mimeType === "audio/mpeg" && !b.subarray(3).some((value,i)=>value === 255 && (b[i+4]! & 0xe0) === 0xe0)) invalid();
  }
  return media;
}

/** Local in-memory PDF rasterization. Never fetch embedded URLs or retain files. */
export async function visionContent(media: ReturnType<typeof decodeMedia>): Promise<unknown[]> {
  if (media.mimeType !== "application/pdf") return [{ type: "input_image", image_url: `data:${media.mimeType};base64,${media.base64}`, detail: "high" }];
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(media.bytes), enableXfa: false, maxImageSize: MAX_PIXELS,
    stopAtErrors: true, disableFontFace: true, useSystemFonts: true, verbosity: 0 });
  const timeout = setTimeout(()=>void task.destroy(),15_000);
  try {
    const pdf = await task.promise;
    if (pdf.numPages < 1 || pdf.numPages > 3) throw new ApiError(413,"PDF_PAGE_LIMIT","PDFs must contain 1–3 pages. Split the document before uploading.");
    const content: unknown[] = [];
    let totalBytes = 0;
    for (let index=1;index<=pdf.numPages;index++) {
      const page = await pdf.getPage(index), viewport = page.getViewport({ scale: 1.5 });
      dimensions(Math.ceil(viewport.width),Math.ceil(viewport.height));
      const factory = pdf.canvasFactory as { create(width:number,height:number): { canvas: any; context: any }; destroy(value:any):void };
      const canvas = factory.create(Math.ceil(viewport.width),Math.ceil(viewport.height));
      try {
        await page.render({ canvasContext: canvas.context, canvas: canvas.canvas, viewport }).promise;
        const bytes: Buffer = canvas.canvas.toBuffer("image/png"); totalBytes += bytes.length;
        if (totalBytes > MEDIA_LIMIT) throw new ApiError(413,"MEDIA_TOO_LARGE","Rendered PDF exceeds the 8 MB image limit.");
        content.push({ type:"input_image",image_url:`data:image/png;base64,${bytes.toString("base64")}`,detail:"high" });
      } finally { factory.destroy(canvas); page.cleanup(); }
    }
    return content;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    invalid();
  } finally { clearTimeout(timeout); await task.destroy(); }
}
