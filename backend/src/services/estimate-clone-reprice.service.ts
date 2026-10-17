import type { EstimateDefinition, EstimateDocument } from "../types/estimate-document.types.js";
import type { EstimateItemRecord, EstimateRepository, EstimateRecord } from "../repositories/estimate.repository.js";
import type { PricedEstimateLine } from "../types/estimate.types.js";
import type { PricingService } from "./pricing.service.js";
import type { ResolvedPrice } from "../types/pricing.types.js";
import { createHash } from "node:crypto";
import { ApiError } from "../errors/api-error.js";
import type { TenantAccessService } from "../auth/tenant-access.service.js";
import type { RateListRepository } from "../repositories/rate-list.repository.js";

export const ESTIMATE_CONVERSION_MODES = [
  "REPRICE_ALL_TO_TARGET_RATE_LIST",
  "PRESERVE_LINE_BRAND_CONTEXT",
] as const;
export type EstimateConversionMode = typeof ESTIMATE_CONVERSION_MODES[number];

export type EstimateConversionStatus =
  | "RESOLVED"
  | "MISSING_RATE"
  | "AMBIGUOUS"
  | "UNRESOLVED_BRAND"
  | "INVALID_TARGET";

export interface EstimateAggregate {
  record: EstimateRecord;
  items: EstimateItemRecord[];
  source_fingerprint: string;
}

export interface EstimateCloneRepriceRepository extends Pick<EstimateRepository, "createEstimateAtomic"> {
  getEstimateAggregate(estimateId: number, organizationId: string): Promise<EstimateAggregate | null>;
  getConversionReplay(organizationId: string, actorId: string, key: string): Promise<{ request: unknown; result: EstimateAggregate } | null>;
}

export interface EstimateConversionLinePreview {
  line_number: number;
  product_id: number;
  quantity: number;
  unit: string;
  original_rate_list_id: number | null;
  original_brand_hint: string | null;
  original_price: number;
  target_rate_list_id: number | null;
  target_brand_hint: string | null;
  target_price: number | null;
  difference: number | null;
  resolution_source: "EXPLICIT_TARGET" | "LINE_CONTEXT" | "NONE";
  status: EstimateConversionStatus;
  message?: string;
  resolved_price?: ResolvedPrice;
}

export interface EstimateConversionPreview {
  source_estimate_id: number;
  organization_id: string;
  mode: EstimateConversionMode;
  target_rate_list_id: number | null;
  lines: EstimateConversionLinePreview[];
  can_create: boolean;
  pricing_date: string;
  preview_fingerprint: string;
}

export interface EstimateCloneRequest {
  source_estimate_id: number;
  organization_id: string;
  mode: EstimateConversionMode;
  target_rate_list_id?: number | null;
  target_estimate_number: string;
  actor_user_id: string;
  branch_id: string;
  pricing_date: string;
  preview_fingerprint: string;
  idempotency_key?: string | null;
}

export type EstimatePreviewRequest = Omit<EstimateCloneRequest, "target_estimate_number" | "idempotency_key" | "preview_fingerprint">;

export interface EstimateCloneRepriceService {
  preview(request: EstimatePreviewRequest): Promise<EstimateConversionPreview>;
  execute(request: EstimateCloneRequest): Promise<EstimateDocument>;
}

const failureStatuses = new Set<EstimateConversionStatus>([
  "MISSING_RATE", "AMBIGUOUS", "UNRESOLVED_BRAND", "INVALID_TARGET",
]);

function positiveId(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${field} must be a positive integer`);
}

function modeIsValid(mode: string): mode is EstimateConversionMode {
  return (ESTIMATE_CONVERSION_MODES as readonly string[]).includes(mode);
}

export class DefaultEstimateCloneRepriceService implements EstimateCloneRepriceService {
  constructor(
    private readonly repository: EstimateCloneRepriceRepository,
    private readonly pricing: PricingService,
    private readonly authorization: Pick<TenantAccessService, "assertAuthorized">,
    private readonly rateLists: Pick<RateListRepository, "listActiveSaleRateLists">,
  ) {}

  private async authorize(request: EstimatePreviewRequest): Promise<void> {
    await this.authorization.assertAuthorized(
      { userId: request.actor_user_id, organizationId: request.organization_id },
      "sales.create", { kind: "branch", branchId: request.branch_id },
    );
    if (!modeIsValid(request.mode)) throw new ApiError(400, "INVALID_TARGET", "conversion mode is invalid");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(request.pricing_date) || !Number.isFinite(Date.parse(request.pricing_date)) || new Date(request.pricing_date).toISOString().slice(0, 10) !== request.pricing_date) throw new ApiError(400, "INVALID_TARGET", "pricing_date must be a valid YYYY-MM-DD date");
    if (request.mode === "PRESERVE_LINE_BRAND_CONTEXT" && request.target_rate_list_id != null) throw new ApiError(400, "INVALID_TARGET", "preserve-line mode does not accept a target rate list");
  }

  private async load(request: Pick<EstimateCloneRequest, "source_estimate_id" | "organization_id" | "branch_id">): Promise<EstimateAggregate> {
    positiveId(request.source_estimate_id, "source_estimate_id");
    if (!request.organization_id?.trim()) throw new Error("organization_id is required");
    const aggregate = await this.repository.getEstimateAggregate(request.source_estimate_id, request.organization_id);
    if (!aggregate || aggregate.record.organization_id !== request.organization_id) throw new ApiError(404, "NOT_FOUND", "source estimate was not found in the organization");
    if (!aggregate.record.branch_id) throw new ApiError(409, "SOURCE_BRANCH_REQUIRED", "Historical estimate has no branch ownership; resolve its branch before conversion");
    if (request.branch_id !== aggregate.record.branch_id) throw new ApiError(403, "BRANCH_ACCESS_DENIED", "source estimate branch mismatch");
    if (!aggregate.items.length) throw new ApiError(422, "EMPTY_ESTIMATE", "source estimate has no lines");
    return aggregate;
  }

  async preview(request: EstimatePreviewRequest): Promise<EstimateConversionPreview> {
    await this.authorize(request);
    const source = await this.load(request);
    return this.buildPreview(request, source);
  }

  private async buildPreview(request: EstimatePreviewRequest, source: EstimateAggregate): Promise<EstimateConversionPreview> {
    const targetId = request.target_rate_list_id ?? null;
    if (targetId != null) positiveId(targetId, "target_rate_list_id");
    const lists = await this.rateLists.listActiveSaleRateLists(request.organization_id);
    const lines = await Promise.all([...source.items].sort((a, b) => a.line_number - b.line_number).map(async (item) => {
      const id = request.mode === "REPRICE_ALL_TO_TARGET_RATE_LIST" ? targetId : item.rate_list_id;
      if (id != null && !lists.some((list) => list.id === id && list.organization_id === request.organization_id && list.is_active && list.price_type === "SALE" && list.currency_code === source.record.currency_code && (list.scope_type !== "CUSTOMER" || list.customer_id === source.record.customer_id))) return this.invalidLine(item, "target rate list is inactive, foreign, or incompatible with this customer/currency");
      return this.resolveLine(source.record, item, request.mode, targetId, request.pricing_date);
    }));
    const fingerprint = createHash("sha256").update(JSON.stringify({
      source: source.source_fingerprint, actor: request.actor_user_id, branch: request.branch_id,
      mode: request.mode, target: targetId, date: request.pricing_date, lines,
    })).digest("hex");
    return {
      source_estimate_id: source.record.id, organization_id: source.record.organization_id,
      mode: request.mode, target_rate_list_id: targetId, lines,
      can_create: lines.every((line) => !failureStatuses.has(line.status)),
      pricing_date: request.pricing_date, preview_fingerprint: fingerprint,
    };
  }

  private invalidLine(item: EstimateItemRecord, message: string): EstimateConversionLinePreview {
    return {
      line_number: item.line_number, product_id: item.product_id, quantity: item.quantity, unit: item.unit,
      original_rate_list_id: item.rate_list_id, original_brand_hint: item.brand_hint ?? null, original_price: item.unit_price,
      target_rate_list_id: null, target_brand_hint: null, target_price: null, difference: null,
      resolution_source: "NONE", status: "INVALID_TARGET", message,
    };
  }

  private async resolveLine(source: EstimateRecord, item: EstimateItemRecord, mode: EstimateConversionMode, targetId: number | null, pricingDate: string): Promise<EstimateConversionLinePreview> {
    const lineTargetId = mode === "REPRICE_ALL_TO_TARGET_RATE_LIST" ? targetId : item.rate_list_id;
    if (mode === "REPRICE_ALL_TO_TARGET_RATE_LIST" && lineTargetId == null) return this.invalidLine(item, "target rate list is required");
    const sourceType = lineTargetId == null ? "NONE" : mode === "REPRICE_ALL_TO_TARGET_RATE_LIST" ? "EXPLICIT_TARGET" : "LINE_CONTEXT";
    const base = {
      organization_id: source.organization_id, price_type: "SALE" as const, as_of: pricingDate,
      customer_id: source.customer_id, rate_list_id: lineTargetId,
    };
    const basePreview = {
      line_number: item.line_number, product_id: item.product_id, quantity: item.quantity, unit: item.unit,
      original_rate_list_id: item.rate_list_id, original_brand_hint: item.brand_hint ?? null, original_price: item.unit_price,
      target_rate_list_id: lineTargetId, target_brand_hint: mode === "PRESERVE_LINE_BRAND_CONTEXT" ? item.brand_hint ?? null : null,
      resolution_source: sourceType as "EXPLICIT_TARGET" | "LINE_CONTEXT" | "NONE",
    };
    if (lineTargetId == null) return { ...basePreview, target_price: null, difference: null, status: item.brand_hint ? "UNRESOLVED_BRAND" : "INVALID_TARGET", message: item.brand_hint ? "line brand context has no approved rate list" : "line has no rate list context" };
    try {
      const resolved = await this.pricing.resolvePrice({ ...base, product_id: item.product_id, quantity: item.quantity, rate_list_id: lineTargetId });
      if (!resolved) return { ...basePreview, target_price: null, difference: null, status: "MISSING_RATE", message: `no applicable price for product_id ${item.product_id} in rate_list_id ${lineTargetId}` };
      if (resolved.product_id !== item.product_id || resolved.rate_list_id !== lineTargetId || resolved.unit !== item.unit || resolved.currency_code !== source.currency_code || !Number.isFinite(resolved.unit_price) || resolved.unit_price < 0 || item.quantity * resolved.unit_price < item.discount_amount) return { ...basePreview, target_price: null, difference: null, status: "INVALID_TARGET", message: "target price has incompatible product, unit, currency, or discount" };
      return { ...basePreview, target_price: resolved.unit_price, difference: resolved.unit_price - item.unit_price, status: "RESOLVED", resolved_price: resolved };
    } catch (error) {
      const message = error instanceof Error ? error.message : "pricing resolution failed";
      if (!/ambiguous/i.test(message)) throw error;
      const status: EstimateConversionStatus = "AMBIGUOUS";
      return { ...basePreview, target_price: null, difference: null, status, message };
    }
  }

  async execute(request: EstimateCloneRequest): Promise<EstimateDocument> {
    await this.authorize(request);
    if (!request.target_estimate_number?.trim()) throw new Error("target_estimate_number is required");
    if (!request.idempotency_key?.trim() || request.idempotency_key.length > 255) throw new ApiError(400, "VALIDATION_ERROR", "idempotency_key is required");
    if (!/^[a-f0-9]{64}$/.test(request.preview_fingerprint ?? "")) throw new ApiError(400, "PREVIEW_REQUIRED", "Confirm a resolved preview before creating the estimate");
    const conversionRequest = { source_estimate_id: request.source_estimate_id, organization_id: request.organization_id, branch_id: request.branch_id, actor_user_id: request.actor_user_id, mode: request.mode, target_rate_list_id: request.target_rate_list_id ?? null, pricing_date: request.pricing_date, preview_fingerprint: request.preview_fingerprint, target_estimate_number: request.target_estimate_number.trim() };
    const replay = await this.repository.getConversionReplay(request.organization_id, request.actor_user_id, request.idempotency_key.trim());
    if (replay) {
      if (JSON.stringify(stable(replay.request)) !== JSON.stringify(stable(conversionRequest))) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "idempotency key was reused for a different estimate request");
      return estimateDocument(replay.result);
    }
    const source = await this.load(request);
    const preview = await this.buildPreview(request, source);
    if (!preview.can_create) {
      const failed = preview.lines.filter((line) => failureStatuses.has(line.status));
      throw new ApiError(422, "CONVERSION_BLOCKED", `estimate conversion blocked: ${failed.map((line) => `line ${line.line_number} ${line.status}`).join(", ")}`, failed);
    }
    if (preview.preview_fingerprint !== request.preview_fingerprint) throw new ApiError(409, "PREVIEW_CHANGED", "Source or prices changed; review a new preview before confirmation");
    const sourceDefinition: EstimateDefinition = {
      organization_id: source.record.organization_id, branch_id: request.branch_id ?? source.record.branch_id ?? null,
      customer_id: source.record.customer_id, estimate_number: request.target_estimate_number.trim(), issue_date: source.record.issue_date,
      currency_code: source.record.currency_code, notes: source.record.notes ?? null,
      ...(source.record.pass_through_rent !== undefined ? { pass_through_rent: source.record.pass_through_rent } : {}),
      ...(source.record.pass_through_rent_payee !== undefined ? { pass_through_rent_payee: source.record.pass_through_rent_payee } : {}),
      ...(source.record.layout_key !== undefined ? { layout_key: source.record.layout_key } : {}),
    };
    const sourceItems = [...source.items].sort((a, b) => a.line_number - b.line_number);
    const lines: PricedEstimateLine[] = sourceItems.map((item, index) => {
      const target = preview.lines[index];
      if (!target) throw new Error(`conversion preview missing line ${item.line_number}`);
      if (!target.resolved_price || target.target_price == null) throw new Error(`conversion preview missing resolved price for line ${item.line_number}`);
      return {
        line_number: item.line_number, product_id: item.product_id, quantity: item.quantity, unit: item.unit,
        description: item.description,
        unit_price: target.target_price!, pricing_source: "RESOLVED_RATE", rate_list_id: target.target_rate_list_id,
        rate_list_version_id: target.resolved_price?.rate_list_version_id ?? null,
        rate_list_selection_source: "LINE_OVERRIDE",
        brand_hint: target.target_brand_hint, discount_amount: item.discount_amount ?? 0, resolved_price: target.resolved_price,
      };
    });
    const created = await this.repository.createEstimateAtomic({ definition: sourceDefinition, lines, branch_id: request.branch_id, actor_user_id: request.actor_user_id, idempotency_key: request.idempotency_key.trim(), source_type: "MANUAL", source_reference: `estimate-clone:${source.record.id}`, conversion_request: conversionRequest, source_fingerprint: source.source_fingerprint });
    return estimateDocument(created);
  }
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}

export function estimateDocument(aggregate: Pick<EstimateAggregate, "record" | "items">): EstimateDocument {
  const record = aggregate.record;
  const lines: PricedEstimateLine[] = [...aggregate.items].sort((a, b) => a.line_number - b.line_number).map((item) => ({
    line_number: item.line_number, product_id: item.product_id, description: item.description,
    quantity: Number(item.quantity), unit: item.unit, unit_price: Number(item.unit_price), discount_amount: Number(item.discount_amount),
    pricing_source: item.pricing_source, rate_list_id: item.rate_list_id, rate_list_version_id: item.rate_list_version_id, brand_hint: item.brand_hint ?? null,
    rate_list_selection_source: item.rate_list_selection_source === "INHERITED" ? "ESTIMATE_DEFAULT" : item.rate_list_selection_source === "AI_SUGGESTED" ? "OCR_BRAND_MATCH" : item.rate_list_selection_source === "MANUAL" ? "MANUAL_OVERRIDE" : "LINE_OVERRIDE",
  }));
  const definition: EstimateDefinition = { organization_id: record.organization_id, branch_id: record.branch_id ?? null, customer_id: record.customer_id, estimate_number: record.estimate_number, issue_date: record.issue_date, currency_code: record.currency_code, notes: record.notes ?? null, pass_through_rent: Number(record.pass_through_rent ?? 0), pass_through_rent_payee: record.pass_through_rent_payee ?? null, ...(record.layout_key ? { layout_key: record.layout_key } : {}) };
  const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0);
  const discount_total = lines.reduce((sum, line) => sum + (line.discount_amount ?? 0), 0);
  const rent = definition.pass_through_rent ?? 0;
  return { id: record.id, status: record.status, definition, lines, totals: { subtotal, discount_total, grand_total: subtotal - discount_total, pass_through_rent: rent, customer_payable_total: subtotal - discount_total + rent } };
}
