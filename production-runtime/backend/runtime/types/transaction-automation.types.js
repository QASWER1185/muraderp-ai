const documentTypeByTransaction = {
    ESTIMATE: "estimate",
    CUSTOMER_INVOICE: "customer_invoice",
    SUPPLIER_BILL: "supplier_bill",
    CUSTOMER_RETURN: "customer_return",
    PURCHASE_RETURN: "purchase_return",
    INVENTORY_COUNT: "inventory_count",
};
export function expectedDocumentType(transactionType) {
    return documentTypeByTransaction[transactionType];
}
export function isConfirmedDraft(draft) {
    return draft.status === "confirmed" && draft.requiresConfirmation === true;
}
//# sourceMappingURL=transaction-automation.types.js.map