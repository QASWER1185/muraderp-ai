/** Numeric fields only: identifiers and source text are never rewritten. */
export function westernDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, (digit) => String(digit.charCodeAt(0) - (digit >= "۰" ? 0x06f0 : 0x0660)));
}

export function parseDocumentNumber(raw: unknown): { value: number | null; original: string | null; issue: string | null } {
  const original = raw == null ? null : String(raw);
  if (raw == null || original?.trim() === "") return { value: null, original, issue: null };
  if (typeof raw !== "string" && typeof raw !== "number") return { value: null, original, issue: "Invalid numeric field" };
  const text = westernDigits(original!).trim().replaceAll("٫", ".").replaceAll("٬", ",");
  // Only conventional groups of three are accepted. Fractions, dimensions and labels are not amounts.
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) return { value: null, original, issue: "Ambiguous or illegible numeric field" };
  const value = Number(text.replaceAll(",", ""));
  if (!Number.isFinite(value) || value > Number.MAX_SAFE_INTEGER) return { value: null, original, issue: "Numeric field is outside the safe range" };
  return { value, original, issue: null };
}

export function normalizeDocumentDate(raw: string | null): { value: string | null; issue: string | null } {
  if (!raw) return { value: null, issue: null };
  const value = westernDigits(raw.trim());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) return { value: null, issue: "Date requires an unambiguous valid ISO date" };
  return { value, issue: null };
}
