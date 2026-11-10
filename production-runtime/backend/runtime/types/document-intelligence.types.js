export function validateDocumentDraft(draft) {
    if (!draft.organizationId || !draft.createdByUserId)
        throw new Error('Organization and user context are required');
    if (!draft.provenance?.source || !draft.provenance?.extractedAt)
        throw new Error('Document provenance is required');
    if (!Number.isFinite(draft.confidence) || draft.confidence < 0 || draft.confidence > 1) {
        throw new Error('Document confidence must be a finite number between 0 and 1');
    }
    if (draft.requiresConfirmation !== true)
        throw new Error('Document drafts always require confirmation');
    for (const match of draft.matches) {
        if (!Number.isFinite(match.confidence) || match.confidence < 0 || match.confidence > 1) {
            throw new Error('Entity match confidence must be a finite number between 0 and 1');
        }
    }
}
export function validateBusinessMessageIntent(message) {
    if (!message.organizationId || !message.userId)
        throw new Error('Organization and user context are required');
    if (!message.body.trim())
        throw new Error('Message body is required');
    if (message.requiresAuthorization !== true)
        throw new Error('Business messages require authorization');
}
export function getDocumentDuplicateKey(draft) {
    validateDocumentDraft(draft);
    const sourceHash = draft.provenance.sourceHash?.trim();
    if (!sourceHash)
        throw new Error('Document source hash is required before posting');
    return `${draft.organizationId}:${draft.documentType}:${sourceHash}`;
}
export function assertDocumentNotDuplicate(draft, existingKeys) {
    const key = getDocumentDuplicateKey(draft);
    if (existingKeys.has(key))
        throw new Error('Duplicate document detected');
}
//# sourceMappingURL=document-intelligence.types.js.map