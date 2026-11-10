// Match saved line descriptions AND catalog names, including common Urdu spellings.
export function normalizeEstimateSearch(value) {
    return value.normalize('NFKC').toLocaleLowerCase()
        .replace(/(?:dora|dura)\s*flow/g, ' duraflow ')
        .replace(/کنڈیوٹ|کنڈویٹ|کنڈٹ/g, ' conduit ')
        .replace(/الیکٹرک|الیکٹرکل|electrical/g, ' electric ')
        .replace(/پنکھا\s*باکس|فین\s*باکس/g, ' fan box ')
        .replace(/پی\s*پی\s*آر\s*سی|ppr[\s-]*c/g, ' pprc ')
        .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
export function matchesEstimateSearch(record, search) {
    if (!search?.trim())
        return true;
    const query = normalizeEstimateSearch(search);
    const header = normalizeEstimateSearch([record.estimate_number, record.customer_name].join(' '));
    if (header.includes(query))
        return true;
    const tokens = query.split(' ').filter(Boolean);
    // Electric is a category qualifier; conduit itself identifies these saved items.
    const terms = tokens.includes('conduit') ? tokens.filter(t => t !== 'electric') : tokens;
    return terms.length > 0 && (record.lines ?? []).some((line) => {
        const text = normalizeEstimateSearch([line.description, line.product_name, line.products?.name, line.category].join(' '));
        return terms.every(term => text.includes(term));
    });
}
export function estimateSearchResult(record) {
    return { ...record, total_amount: record.customer_payable_total ?? record.grand_total,
        line_item_summary: (record.lines ?? []).map((line) => ({ name: line.product_name, description: line.description, quantity: line.quantity, unit: line.unit })) };
}
//# sourceMappingURL=estimate-search.js.map