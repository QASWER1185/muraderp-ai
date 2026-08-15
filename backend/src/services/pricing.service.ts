import type {
  PriceResolutionContext,
  PricingCandidate,
  RateListDefinition,
  RateListItemDefinition,
  RateListVersionDefinition,
  ResolvedPrice,
} from "../types/pricing.types.js";
import type {
  RateListItemRecord,
  RateListRecord,
  RateListRepository,
  RateListVersionRecord,
  RateListLifecycleRepository,
} from "../repositories/rate-list.repository.js";

export interface PricingRepository {
  findBestRateListItem(context: PriceResolutionContext): Promise<ResolvedPrice | null>;
}

export interface PricingService {
  resolvePrice(context: PriceResolutionContext): Promise<ResolvedPrice | null>;
  resolveCandidate(candidate: PricingCandidate, base: Omit<PriceResolutionContext, "product_id" | "quantity" | "rate_list_id">): Promise<ResolvedPrice | null>;
}

export class DefaultPricingService implements PricingService {
  constructor(
    private readonly repository: PricingRepository,
    private readonly rateListHintResolver?: RateListHintResolver,
  ) {}

  async resolvePrice(context: PriceResolutionContext): Promise<ResolvedPrice | null> {
    if (!Number.isInteger(context.product_id) || context.product_id <= 0) throw new Error("product_id must be a positive integer");
    if (!Number.isFinite(context.quantity) || context.quantity <= 0) throw new Error("quantity must be greater than zero");
    if (!context.as_of || Number.isNaN(Date.parse(context.as_of))) throw new Error("as_of must be a valid date/time");
    if (context.rate_list_id != null && (!Number.isInteger(context.rate_list_id) || context.rate_list_id <= 0)) {
      throw new Error("rate_list_id must be a positive integer when provided");
    }
    const resolved = await this.repository.findBestRateListItem(context);
    if (resolved && context.rate_list_id != null && resolved.rate_list_id !== context.rate_list_id) {
      throw new Error("resolved price does not belong to the requested rate list");
    }
    return resolved;
  }

  async resolveCandidate(
    candidate: PricingCandidate,
    base: Omit<PriceResolutionContext, "product_id" | "quantity" | "rate_list_id">,
  ): Promise<ResolvedPrice | null> {
    if (!Number.isInteger(candidate.product_id) || candidate.product_id <= 0) throw new Error("candidate product_id must be a positive integer");
    if (!Number.isFinite(candidate.quantity) || candidate.quantity <= 0) throw new Error("candidate quantity must be greater than zero");
    if (!candidate.selection_source) throw new Error("candidate selection_source is required");

    let rateListId = candidate.selected_rate_list_id ?? null;
    if (candidate.rate_list_hint?.trim()) {
      if (!this.rateListHintResolver) throw new Error("rate-list hint resolver is required when a rate_list_hint is provided");
      const matches = await this.rateListHintResolver.findRateListsByHint(candidate.rate_list_hint.trim(), base);
      if (matches.length > 1) return null;
      const match = matches[0];
      if (match) rateListId = match.id;
      if (matches.length === 0 && rateListId == null) return null;
    }

    return this.resolvePrice({
      ...base,
      product_id: candidate.product_id,
      quantity: candidate.quantity,
      rate_list_id: rateListId,
    });
  }
}

export interface RateListHintResolver {
  findRateListsByHint(hint: string, context: Pick<PriceResolutionContext, "price_type" | "vendor_id" | "customer_id">): Promise<RateListRecord[]>;
}

export interface RateListAuthoringService {
  createRateList(input: RateListDefinition): Promise<RateListRecord>;
  createVersion(input: RateListVersionDefinition): Promise<RateListVersionRecord>;
  createItem(input: RateListItemDefinition): Promise<RateListItemRecord>;
  listActiveSaleRateLists(): Promise<RateListRecord[]>;
  activateVersion(versionId: number): Promise<RateListVersionRecord>;
  archiveVersion(versionId: number): Promise<RateListVersionRecord>;
}

function requirePositiveInteger(value: number, field: string): void { if (!Number.isInteger(value) || value <= 0) throw new Error(`${field} must be a positive integer`); }
function requireNonBlank(value: string, field: string): void { if (!value.trim()) throw new Error(`${field} is required`); }
function requireValidDate(value: string, field: string): void { if (!value || Number.isNaN(Date.parse(value))) throw new Error(`${field} must be a valid date/time`); }

export class DefaultRateListAuthoringService implements RateListAuthoringService {
  constructor(private readonly repository: RateListRepository, private readonly lifecycleRepository: RateListLifecycleRepository) {}
  async createRateList(input: RateListDefinition): Promise<RateListRecord> {
    requireNonBlank(input.name, "name"); requireNonBlank(input.code, "code"); requireNonBlank(input.currency_code, "currency_code");
    if (input.scope_type === "VENDOR") requirePositiveInteger(input.vendor_id ?? 0, "vendor_id");
    if (input.scope_type === "CUSTOMER") requirePositiveInteger(input.customer_id ?? 0, "customer_id");
    if (input.scope_type === "GLOBAL" && (input.vendor_id != null || input.customer_id != null)) throw new Error("GLOBAL rate lists cannot target a vendor or customer");
    return this.repository.createRateList({ ...input, name: input.name.trim(), code: input.code.trim(), currency_code: input.currency_code.trim().toUpperCase() });
  }
  async createVersion(input: RateListVersionDefinition): Promise<RateListVersionRecord> {
    requirePositiveInteger(input.rate_list_id, "rate_list_id"); requirePositiveInteger(input.version_number, "version_number"); requireValidDate(input.effective_from, "effective_from");
    if (input.effective_to != null) { requireValidDate(input.effective_to, "effective_to"); if (Date.parse(input.effective_to) <= Date.parse(input.effective_from)) throw new Error("effective_to must be later than effective_from"); }
    return this.repository.createVersion({ ...input, status: input.status ?? "DRAFT" });
  }
  async createItem(input: RateListItemDefinition): Promise<RateListItemRecord> {
    requirePositiveInteger(input.rate_list_version_id, "rate_list_version_id"); requirePositiveInteger(input.product_id, "product_id");
    const minimumQuantity = input.minimum_quantity ?? 1;
    if (!Number.isFinite(minimumQuantity) || minimumQuantity <= 0) throw new Error("minimum_quantity must be greater than zero");
    if (!Number.isFinite(input.unit_price) || input.unit_price < 0) throw new Error("unit_price must be zero or greater");
    requireNonBlank(input.unit, "unit");
    return this.repository.createItem({ ...input, minimum_quantity: minimumQuantity, unit: input.unit.trim() });
  }
  listActiveSaleRateLists(): Promise<RateListRecord[]> { return this.repository.listActiveSaleRateLists(); }
  async activateVersion(versionId: number): Promise<RateListVersionRecord> { requirePositiveInteger(versionId, "versionId"); const version = await this.lifecycleRepository.getVersion(versionId); if (version.status !== "DRAFT") throw new Error("only DRAFT rate-list versions can be activated"); return this.lifecycleRepository.activateVersion(versionId); }
  async archiveVersion(versionId: number): Promise<RateListVersionRecord> { requirePositiveInteger(versionId, "versionId"); const version = await this.lifecycleRepository.getVersion(versionId); if (version.status !== "ACTIVE") throw new Error("only ACTIVE rate-list versions can be archived"); return this.lifecycleRepository.archiveVersion(versionId); }
}

export type { RateListDefinition, RateListItemDefinition, RateListVersionDefinition };
