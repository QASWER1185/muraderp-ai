export type DocumentTemplate = "sanitary_electric" | "building_material";

export function isDocumentTemplate(value: unknown): value is DocumentTemplate {
  return value === "sanitary_electric" || value === "building_material";
}
