export type WhatsAppDeliveryMode = "WEB_LINK" | "MOBILE_LINK" | "PDF_ATTACHMENT";

export interface WhatsAppEstimateDelivery {
  channel: "WHATSAPP";
  mode: WhatsAppDeliveryMode;
  phone: string;
  message: string;
  document_name: string;
  document_format: "PDF";
}

export function normalizePakistanPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("92") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 11) return `92${digits.slice(1)}`;
  throw new Error("phone must be a valid Pakistan mobile number");
}
