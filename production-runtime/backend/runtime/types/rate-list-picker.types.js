export function filterSelectableRateLists(options, priceType = "SALE") {
    return options.filter((option) => option.is_active && option.price_type === priceType);
}
//# sourceMappingURL=rate-list-picker.types.js.map