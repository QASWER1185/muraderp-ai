/** Roman Urdu stays Urdu by default; explicit English questions use English. */
export function isEnglishRequest(message) {
    return !/[\u0600-\u06ff]/u.test(message) && /\b(?:what|how|which|show|please|check|compare|give|list|tell)\b/i.test(message) && !/\b(?:ka|ki|hy|hai|kya|kia|kitna|kitni|batao|bata|dikhao|karo|kro)\b/i.test(message);
}
//# sourceMappingURL=language.js.map