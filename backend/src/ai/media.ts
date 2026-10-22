/** Normalize transport spelling only; content signatures are validated separately. */
export function normalizeMediaMimeType(value: string): string {
  const mime = value.trim().toLowerCase();
  return mime === "image/jpg" ? "image/jpeg" : mime;
}

export function parseMediaDataUrl(value: string): { mimeType: string; data: string } | null {
  const match = /^data:([^;,]+);base64,([\s\S]*)$/i.exec(value.trim());
  return match ? { mimeType: normalizeMediaMimeType(match[1]!), data: match[2]!.trim() } : null;
}

export function normalizeMediaInput(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const input = value as Record<string, unknown>;
  const mimeType = typeof input.mimeType === "string" ? normalizeMediaMimeType(input.mimeType) : input.mimeType;
  if (typeof input.base64 !== "string") return { ...input, mimeType };
  const inline = parseMediaDataUrl(input.base64);
  // A conflicting transport header must not disguise another file type.
  const base64 = inline && inline.mimeType === mimeType ? inline.data : input.base64.trim();
  return { ...input, mimeType, base64 };
}
