import { randomUUID } from "node:crypto";
import { ApiError } from "../errors/api-error.js";
import { AiInputPipeline, InMemoryAiInputGateway } from "../ai-input/pipeline.js";
import type { AiInputIntent, AiInputRequest, AiInputSource, ExtractedField } from "../ai-input/ai-input.types.js";
import type { AiDraftLine, AiInputIntent as CopilotDraftIntent } from "../ai-input/contracts.js";
import type { AssistantIntentResolver } from "../ai-assistant/assistant.types.js";
import type { StructuredAiProvider } from "../ai-input/openai.provider.js";
import { ProviderDocumentExtractor } from "../ai-input/openai.provider.js";

const MAX_CATALOG_ROWS = 5_000;
const MATCH_CANDIDATE_LIMIT = 5;
const MATCHED_THRESHOLD = 0.9;
const AMBIGUITY_MARGIN = 0.15;

export interface CopilotCatalogProduct {
  id: number;
  name: string;
  sku: string;
  unit: string;
  brandName?: string;
}

export interface CopilotCatalogParty {
  id: number;
  name: string;
}

export interface CopilotCatalogWarehouse {
  id: number;
  name: string;
}

export interface CopilotCatalogRateList {
  id: number;
  name: string;
  code: string;
  priceType: "SALE" | "PURCHASE";
  scopeType: "GLOBAL" | "VENDOR" | "CUSTOMER";
  vendorId?: number | null;
  customerId?: number | null;
  currencyCode: string;
}

export interface CopilotCatalog {
  products: CopilotCatalogProduct[];
  customers: CopilotCatalogParty[];
  vendors: CopilotCatalogParty[];
  warehouses: CopilotCatalogWarehouse[];
  rateLists: CopilotCatalogRateList[];
}

export interface CopilotCatalogRepository {
  getCatalog(organizationId: string): Promise<CopilotCatalog>;
}

type CatalogDatabase = { from(table: string): any };

/** Read-only, organization-filtered catalog access used for review suggestions. */
export class SupabaseCopilotCatalogRepository implements CopilotCatalogRepository {
  constructor(private readonly clientFactory: () => CatalogDatabase) {}

  private async rows(table: string, selection: string, organizationId: string): Promise<any[]> {
    const { data, error } = await this.clientFactory()
      .from(table)
      .select(selection)
      .eq("organization_id", organizationId)
      .limit(MAX_CATALOG_ROWS);
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  async getCatalog(organizationId: string): Promise<CopilotCatalog> {
    const [products, brands, customers, vendors, warehouses, rateLists] = await Promise.all([
      this.rows("products", "id, name, sku, unit, brand_id", organizationId),
      this.rows("brands", "id, name", organizationId),
      this.rows("customers", "id, name", organizationId),
      this.rows("vendors", "id, name", organizationId),
      this.rows("warehouses", "id, name", organizationId),
      this.rows("rate_lists", "id, name, code, price_type, scope_type, vendor_id, customer_id, currency_code", organizationId),
    ]);
    const brandNames = new Map<number, string>(brands.map((brand) => [Number(brand.id), String(brand.name)]));
    return {
      products: products.map((product) => ({
        id: Number(product.id), name: String(product.name), sku: String(product.sku), unit: String(product.unit),
        ...(product.brand_id == null || !brandNames.has(Number(product.brand_id)) ? {} : { brandName: brandNames.get(Number(product.brand_id))! }),
      })),
      customers: customers.map((party) => ({ id: Number(party.id), name: String(party.name) })),
      vendors: vendors.map((party) => ({ id: Number(party.id), name: String(party.name) })),
      warehouses: warehouses.map((warehouse) => ({ id: Number(warehouse.id), name: String(warehouse.name) })),
      rateLists: rateLists
        .filter((rateList) => rateList.price_type === "SALE" || rateList.price_type === "PURCHASE")
        .map((rateList) => ({
          id: Number(rateList.id), name: String(rateList.name), code: String(rateList.code),
          priceType: rateList.price_type, scopeType: rateList.scope_type,
          ...(rateList.vendor_id == null ? {} : { vendorId: Number(rateList.vendor_id) }),
          ...(rateList.customer_id == null ? {} : { customerId: Number(rateList.customer_id) }),
          currencyCode: String(rateList.currency_code),
        })),
    };
  }
}

export interface CopilotMatchCandidate {
  id: number;
  label: string;
  confidence: number;
  details?: Record<string, string | number>;
}

export type CopilotMatchStatus = "matched" | "ambiguous" | "unresolved" | "not_requested";

export interface CopilotMatch {
  input: string | null;
  status: CopilotMatchStatus;
  selectedId?: number;
  candidates: CopilotMatchCandidate[];
}

export interface CopilotLineReview {
  lineNumber: number;
  productName: string;
  productCode: string | null;
  brandHint: string | null;
  quantity: number | null;
  unit: string | null;
  explicitUnitRate: number | null;
  confidence: number;
  product: CopilotMatch;
  rateList: CopilotMatch;
  warnings: string[];
}

export interface CopilotReviewProposal {
  organizationId: string;
  intent: CopilotDraftIntent;
  source: AiInputSource;
  customerId?: ExtractedField<string>;
  vendorId?: ExtractedField<string>;
  documentNumber?: ExtractedField<string>;
  documentDate?: ExtractedField<string>;
  currencyCode?: ExtractedField<string>;
  lines: AiDraftLine[];
  confidence: number;
  requiresHumanConfirmation: true;
}

export interface CopilotReview {
  reviewId: string;
  organizationId: string;
  userId: string;
  intent: CopilotDraftIntent;
  source: AiInputSource;
  confidence: number;
  warnings: string[];
  blockingReasons: string[];
  customer: CopilotMatch;
  vendor: CopilotMatch;
  warehouse: CopilotMatch;
  lines: CopilotLineReview[];
  proposal: CopilotReviewProposal;
  requiresConfirmation: true;
}

export interface CopilotReviewRequest {
  organizationId: string;
  userId: string;
  source: AiInputSource;
  intent?: CopilotDraftIntent;
  text?: string;
  media?: NonNullable<AiInputRequest["media"]>;
  customerId?: number;
  vendorId?: number;
  warehouseId?: number;
  rateListId?: number;
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

function tokens(value: string): Set<string> {
  return new Set(normalize(value).split(" ").filter(Boolean));
}

function score(query: string, candidate: string): number {
  const left = normalize(query);
  const right = normalize(candidate);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (right.includes(left) || left.includes(right)) return 0.86;
  const a = tokens(left); const b = tokens(right);
  if (!a.size || !b.size) return 0;
  const overlap = [...a].filter((token) => b.has(token)).length;
  return Math.min(0.84, overlap / Math.max(a.size, b.size) * 0.84);
}

function candidateStatus(candidates: CopilotMatchCandidate[], input: string | null, threshold = MATCHED_THRESHOLD): CopilotMatchStatus {
  if (!input?.trim()) return "not_requested";
  const best = candidates[0];
  if (!best || best.confidence < threshold) return "unresolved";
  const second = candidates[1];
  if (second && best.confidence - second.confidence < AMBIGUITY_MARGIN) return "ambiguous";
  return "matched";
}

function matchValues(input: string | null, values: Array<{ id: number; label: string; aliases?: string[]; details?: Record<string, string | number> }>, threshold = MATCHED_THRESHOLD): CopilotMatch {
  const candidates = input?.trim()
    ? values.map((value) => ({
      id: value.id,
      label: value.label,
      confidence: Math.max(score(input, value.label), ...(value.aliases ?? []).map((alias) => score(input, alias)), 0),
      ...(value.details ? { details: value.details } : {}),
    })).filter((value) => value.confidence > 0.2).sort((a, b) => b.confidence - a.confidence || a.id - b.id).slice(0, MATCH_CANDIDATE_LIMIT)
    : [];
  const status = candidateStatus(candidates, input, threshold);
  return { input, status, ...(status === "matched" ? { selectedId: candidates[0]!.id } : {}), candidates };
}

function matchSelectedId(selectedId: number | undefined, fallback: CopilotMatch, values: Array<{ id: number; label: string }>): CopilotMatch {
  if (selectedId === undefined) return fallback;
  const selected = values.find((value) => value.id === selectedId);
  if (!selected) return { input: String(selectedId), status: "unresolved", candidates: [] };
  return { input: String(selectedId), status: "matched", selectedId, candidates: [{ id: selectedId, label: selected.label, confidence: 1 }] };
}

function intentToInput(intent: CopilotDraftIntent): AiInputIntent {
  const mapping: Record<CopilotDraftIntent, AiInputIntent> = {
    estimate: "estimate.create",
    invoice: "invoice.create",
    customer_return: "customer_return.create",
    supplier_bill: "supplier_bill.create",
    inventory_adjustment: "inventory.adjust",
    rate_list_update: "rate_list.import",
  };
  return mapping[intent];
}

function inputToIntent(intent: AiInputIntent): CopilotDraftIntent {
  const mapping: Partial<Record<AiInputIntent, CopilotDraftIntent>> = {
    "estimate.create": "estimate",
    "invoice.create": "invoice",
    "customer_return.create": "customer_return",
    "supplier_bill.create": "supplier_bill",
    "inventory.adjust": "inventory_adjustment",
    "rate_list.import": "rate_list_update",
  };
  const result = mapping[intent];
  if (!result) throw new ApiError(422, "AI_CLARIFICATION_REQUIRED", "This extracted document cannot be sent to the Copilot transaction workflow.");
  return result;
}

function assistantIntentToInput(intent: string | null): AiInputIntent | undefined {
  const mapping: Record<string, AiInputIntent> = {
    "estimate.create_draft": "estimate.create",
    "customer_return.create_draft": "customer_return.create",
    "supplier_bill.create_draft": "supplier_bill.create",
    "inventory.adjust_draft": "inventory.adjust",
  };
  return intent ? mapping[intent] : undefined;
}

function toField<T>(value: T, source: AiInputSource, confidence: number): ExtractedField<T> {
  return { value, source, confidence };
}

function buildProposal(request: CopilotReviewRequest, intent: CopilotDraftIntent, source: AiInputSource, confidence: number, lines: CopilotLineReview[], customer: CopilotMatch, vendor: CopilotMatch, documentNumber: string | null, documentDate: string | null, currencyCode: string | null): CopilotReviewProposal {
  return {
    organizationId: request.organizationId,
    intent,
    source,
    ...(customer.selectedId === undefined ? {} : { customerId: toField(String(customer.selectedId), source, confidence) }),
    ...(vendor.selectedId === undefined ? {} : { vendorId: toField(String(vendor.selectedId), source, confidence) }),
    ...(documentNumber === null ? {} : { documentNumber: toField(documentNumber, source, confidence) }),
    ...(documentDate === null ? {} : { documentDate: toField(documentDate, source, confidence) }),
    ...(currencyCode === null ? {} : { currencyCode: toField(currencyCode, source, confidence) }),
    lines: lines.map((line) => ({
      productName: { ...toField(line.productName, source, line.confidence), ...(line.brandHint ? { rawText: line.brandHint } : {}) },
      ...(line.product.selectedId === undefined ? {} : { productId: toField(String(line.product.selectedId), source, line.product.candidates[0]?.confidence ?? line.confidence) }),
      ...(line.quantity == null ? {} : { quantity: toField(line.quantity, source, line.confidence) }),
      ...(line.unit == null ? {} : { unit: toField(line.unit, source, line.confidence) }),
      ...(line.explicitUnitRate == null ? {} : { unitRate: toField(line.explicitUnitRate, source, line.confidence) }),
      ...(line.rateList.selectedId === undefined ? {} : { rateListId: toField(String(line.rateList.selectedId), source, line.rateList.candidates[0]?.confidence ?? line.confidence) }),
    })),
    confidence,
    requiresHumanConfirmation: true,
  };
}

export class CopilotReviewService {
  private readonly pipeline: AiInputPipeline;

  constructor(
    provider: StructuredAiProvider,
    private readonly catalog: CopilotCatalogRepository,
    private readonly resolver?: AssistantIntentResolver,
  ) {
    this.pipeline = new AiInputPipeline(new ProviderDocumentExtractor(provider), new InMemoryAiInputGateway());
  }

  async prepare(request: CopilotReviewRequest): Promise<CopilotReview> {
    const inputIntent = request.intent ? intentToInput(request.intent) : undefined;
    let resolvedIntent = inputIntent;
    if (!resolvedIntent) {
      if (request.source !== "text" || !request.text?.trim() || !this.resolver) {
        throw new ApiError(422, "AI_CLARIFICATION_REQUIRED", "Choose an ERP action before analyzing this input.");
      }
      const resolved = await this.resolver.resolve(request.text);
      resolvedIntent = assistantIntentToInput(resolved.intent);
      if (!resolvedIntent || resolved.decision !== "draft" || resolved.confidence < 0.8) {
        throw new ApiError(422, "AI_CLARIFICATION_REQUIRED", resolved.clarification ?? "Please specify the ERP action to prepare.");
      }
    }

    const extraction = await this.pipeline.createDraft({
      source: request.source,
      intent: resolvedIntent,
      organizationId: request.organizationId,
      userId: request.userId,
      ...(request.text === undefined ? {} : { text: request.text }),
      ...(request.media === undefined ? {} : { media: request.media, mediaReference: "request-media" }),
    });
    const rawDocument = extraction.fields.document?.value;
    if (!rawDocument || typeof rawDocument !== "object") throw new ApiError(422, "AI_INVALID_OUTPUT", "The provider did not return a document proposal.");
    const document = rawDocument as { customerName: string | null; vendorName: string | null; warehouseName: string | null; documentNumber: string | null; documentDate: string | null; currencyCode: string | null; lines: Array<{ productName: string; productCode: string | null; brandHint: string | null; quantity: number | null; unit: string | null; unitRate: number | null; confidence: number }>; confidence: number; warnings: string[] };
    const catalog = await this.catalog.getCatalog(request.organizationId);
    const selectedTargetRateList = request.rateListId === undefined
      ? undefined
      : catalog.rateLists.find((rateList) => rateList.id === request.rateListId);
    const ratePriceType = resolvedIntent === "supplier_bill.create"
      ? "PURCHASE"
      : resolvedIntent === "rate_list.import" && selectedTargetRateList
        ? selectedTargetRateList.priceType
        : "SALE";
    const customerValues = catalog.customers.map((party) => ({ id: party.id, label: party.name }));
    const vendorValues = catalog.vendors.map((party) => ({ id: party.id, label: party.name }));
    const warehouseValues = catalog.warehouses.map((entry) => ({ id: entry.id, label: entry.name }));
    const customer = matchSelectedId(request.customerId, matchValues(document.customerName, customerValues), customerValues);
    const vendor = matchSelectedId(request.vendorId, matchValues(document.vendorName, vendorValues), vendorValues);
    const warehouse = matchSelectedId(request.warehouseId, matchValues(document.warehouseName, warehouseValues), warehouseValues);
    const effectiveCustomerId = customer.selectedId;
    const effectiveVendorId = vendor.selectedId;
    const lines: CopilotLineReview[] = document.lines.map((line, index) => {
      const product = matchValues(line.productCode ?? line.productName, catalog.products.map((candidate) => ({
        id: candidate.id,
        label: candidate.name,
        aliases: [candidate.sku, `${candidate.brandName ?? ""} ${candidate.name}`],
        details: { sku: candidate.sku, unit: candidate.unit, ...(candidate.brandName ? { brand: candidate.brandName } : {}) },
      })));
      const rateInput = line.brandHint;
      const applicableLists = catalog.rateLists.filter((rateList) => rateList.priceType === ratePriceType)
        .filter((rateList) => rateList.scopeType === "GLOBAL" || (rateList.scopeType === "CUSTOMER" && effectiveCustomerId != null && rateList.customerId === effectiveCustomerId) || (rateList.scopeType === "VENDOR" && effectiveVendorId != null && rateList.vendorId === effectiveVendorId));
      const rateList = request.rateListId !== undefined
        ? matchValues(String(request.rateListId), applicableLists.map((candidate) => ({ id: candidate.id, label: String(candidate.id), aliases: [candidate.name, candidate.code], details: { name: candidate.name, code: candidate.code, currency: candidate.currencyCode } })))
        : matchValues(rateInput, applicableLists.map((candidate) => ({ id: candidate.id, label: candidate.name, aliases: [candidate.code], details: { code: candidate.code, currency: candidate.currencyCode, scope: candidate.scopeType } })), 0.8);
      const warnings: string[] = [];
      if (product.status !== "matched") warnings.push(product.status === "ambiguous" ? "Multiple products match this line; choose one." : "Product could not be matched; enter or choose a Product ID.");
      if (rateInput && rateList.status !== "matched" && line.unitRate == null) warnings.push(rateList.status === "ambiguous" ? "Multiple Rate Lists match this brand/company hint; choose one." : "Brand/company rate context could not be matched; choose a Rate List or enter an explicit rate.");
      if (line.quantity == null) warnings.push("Quantity is missing or unclear.");
      return { lineNumber: index + 1, productName: line.productName, productCode: line.productCode, brandHint: line.brandHint, quantity: line.quantity, unit: line.unit, explicitUnitRate: line.unitRate, confidence: line.confidence, product, rateList, warnings };
    });
    const blockingReasons = lines.flatMap((line) => line.warnings.map((warning) => `line-${line.lineNumber}:${warning}`));
    if (lines.length === 0) blockingReasons.push("no-lines-extracted");
    if (customer.status === "ambiguous" || customer.status === "unresolved") blockingReasons.push("customer-match-requires-review");
    if (vendor.status === "ambiguous" || vendor.status === "unresolved") blockingReasons.push("vendor-match-requires-review");
    if (warehouse.status === "ambiguous" || warehouse.status === "unresolved") blockingReasons.push("warehouse-match-requires-review");
    const confidence = Math.min(document.confidence, ...lines.map((line) => line.confidence), 1);
    const proposal = buildProposal(request, inputToIntent(resolvedIntent), request.source, confidence, lines, customer, vendor, document.documentNumber, document.documentDate, document.currencyCode);
    return {
      reviewId: randomUUID(), organizationId: request.organizationId, userId: request.userId,
      intent: proposal.intent, source: request.source, confidence,
      warnings: [...document.warnings, ...lines.flatMap((line) => line.warnings)], blockingReasons,
      customer, vendor, warehouse, lines, proposal, requiresConfirmation: true,
    };
  }
}
