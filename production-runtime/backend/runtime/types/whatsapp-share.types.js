export function normalizePakistanPhone(phone) {
    const digits = (phone ?? "").replace(/\D/g, "");
    if (digits.startsWith("92") && digits.length === 12)
        return digits;
    if (digits.startsWith("0") && digits.length === 11)
        return `92${digits.slice(1)}`;
    throw new Error("phone must be a valid Pakistan mobile number");
}
//# sourceMappingURL=whatsapp-share.types.js.map