import { z } from "zod";
import { ApiError } from "../errors/api-error.js";

const name = z.string().trim().min(1).max(200);
const confidence = z.number().finite().min(0).max(1);

// Names/codes are proposals. Providers cannot supply authoritative ERP IDs.
export const extractedLineSchema = z.strictObject({
  productName: name,
  productCode: name.nullable(),
  brandHint: name.nullable(),
  quantity: z.number().finite().positive().nullable(),
  unit: z.string().trim().min(1).max(50).nullable(),
  unitRate: z.number().finite().nonnegative().nullable(),
  confidence,
});
export const documentExtractionSchema = z.strictObject({
  customerName: name.nullable(),
  vendorName: name.nullable(),
  warehouseName: name.nullable(),
  documentNumber: z.string().trim().min(1).max(100).nullable(),
  documentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  currencyCode: z.string().regex(/^[A-Z]{3}$/).nullable(),
  lines: z.array(extractedLineSchema).max(500),
  confidence,
  warnings: z.array(z.string().max(500)).max(30),
});
export type DocumentExtraction = z.infer<typeof documentExtractionSchema>;
export type ExtractedLine = z.infer<typeof extractedLineSchema>;

export const MEDIA_LIMIT = 8 * 1024 * 1024;
export const mediaSchema = z.strictObject({
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf", "audio/webm", "audio/mp4", "audio/mpeg", "audio/wav", "audio/ogg"]),
  base64: z.string().min(4).max(Math.ceil(MEDIA_LIMIT / 3) * 4).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
});

export function decodeMedia(input: unknown) {
  const media = mediaSchema.parse(input);
  const bytes = Buffer.from(media.base64, "base64");
  if (!bytes.length || bytes.length > MEDIA_LIMIT) throw new ApiError(413, "MEDIA_TOO_LARGE", "Media must be between 1 byte and 8 MB");
  const prefix = bytes.subarray(0, 12);
  const valid = media.mimeType === "application/pdf" ? prefix.toString("ascii").startsWith("%PDF-")
    : media.mimeType === "image/jpeg" ? prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff
    : media.mimeType === "image/png" ? prefix.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : media.mimeType === "image/webp" ? prefix.toString("ascii", 0, 4) === "RIFF" && prefix.toString("ascii", 8, 12) === "WEBP"
    : media.mimeType === "audio/wav" ? prefix.toString("ascii", 0, 4) === "RIFF" && prefix.toString("ascii", 8, 12) === "WAVE"
    : media.mimeType === "audio/mp4" ? prefix.toString("ascii", 4, 8) === "ftyp"
    : media.mimeType === "audio/ogg" ? prefix.toString("ascii", 0, 4) === "OggS"
    : media.mimeType === "audio/webm" ? prefix.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
    : prefix.toString("ascii", 0, 3) === "ID3" || (prefix[0] === 0xff && (prefix[1]! & 0xe0) === 0xe0);
  if (!valid) throw new ApiError(422, "INVALID_MEDIA", "File contents do not match the selected media type");
  return { ...media, bytes };
}
