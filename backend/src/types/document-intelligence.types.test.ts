import { describe, expect, it } from 'vitest';
import {
  assertDocumentNotDuplicate,
  getDocumentDuplicateKey,
  validateDocumentDraft,
} from './document-intelligence.types.js';
import type { DocumentDraft } from './document-intelligence.types.js';

const draft: DocumentDraft = {
  organizationId: 'org-1',
  createdByUserId: 'user-1',
  documentType: 'supplier_bill',
  status: 'needs_review',
  provenance: {
    source: 'upload',
    extractedAt: '2026-08-19T12:00:00.000Z',
    sourceHash: 'sha256:invoice-001',
  },
  extractedFields: { total: 1000 },
  matches: [
    {
      entityType: 'vendor',
      inputValue: 'Vendor A',
      matchedId: 'vendor-1',
      confidence: 0.98,
    },
  ],
  confidence: 0.95,
  requiresConfirmation: true,
};

describe('Phase 15 document intelligence safety boundary', () => {
  it('accepts a valid organization-scoped draft with provenance and confirmation', () => {
    expect(() => validateDocumentDraft(draft)).not.toThrow();
  });

  it('rejects non-finite document confidence', () => {
    expect(() => validateDocumentDraft({ ...draft, confidence: Number.NaN })).toThrow(
      /finite number/,
    );
    expect(() => validateDocumentDraft({ ...draft, confidence: Number.POSITIVE_INFINITY })).toThrow(
      /finite number/,
    );
  });

  it('rejects non-finite entity match confidence', () => {
    expect(() =>
      validateDocumentDraft({
        ...draft,
        matches: [{ ...draft.matches[0], confidence: Number.NaN }],
      }),
    ).toThrow(/finite number/);
  });

  it('creates an organization-scoped deterministic duplicate key', () => {
    expect(getDocumentDuplicateKey(draft)).toBe('org-1:supplier_bill:sha256:invoice-001');
  });

  it('requires a source hash before an authoritative posting boundary', () => {
    expect(() =>
      getDocumentDuplicateKey({
        ...draft,
        provenance: { ...draft.provenance, sourceHash: undefined },
      }),
    ).toThrow(/source hash is required/);
  });

  it('blocks duplicate documents without performing any mutation', () => {
    const key = getDocumentDuplicateKey(draft);
    expect(() => assertDocumentNotDuplicate(draft, new Set([key]))).toThrow(/Duplicate document/);
    expect(() => assertDocumentNotDuplicate(draft, new Set())).not.toThrow();
  });
});
