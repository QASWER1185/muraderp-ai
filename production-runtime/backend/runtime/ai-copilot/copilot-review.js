import { randomUUID } from "node:crypto";
import { ApiError } from "../errors/api-error.js";
import { AiInputPipeline, InMemoryAiInputGateway } from "../ai-input/pipeline.js";
import { ProviderDocumentExtractor } from "../ai-input/provider-extraction.js";
import { explicitBrand } from "./productResolver.js";
import { isOpenBrandRateList } from "../repositories/rate-list.repository.js";
const MAX_CATALOG_ROWS = 5_000;
const MATCH_CANDIDATE_LIMIT = 5;
const MATCHED_THRESHOLD = 0.9;
const AMBIGUITY_MARGIN = 0.15;
/** Read-only, organization-filtered catalog access used for review suggestions. */
export class SupabaseCopilotCatalogRepository {
    clientFactory;
    constructor(clientFactory) {
        this.clientFactory = clientFactory;
    }
    async rows(table, selection, organizationId) {
        const { data, error } = await this.clientFactory()
            .from(table)
            .select(selection)
            .eq("organization_id", organizationId)
            .limit(MAX_CATALOG_ROWS);
        if (error)
            throw error;
        return Array.isArray(data) ? data : [];
    }
    async getCatalog(organizationId) {
        const [products, brands, customers, vendors, warehouses, rateLists] = await Promise.all([
            this.rows("products", "id, name, sku, unit, brand_id", organizationId),
            this.rows("brands", "id, name", organizationId),
            this.rows("customers", "id, name", organizationId),
            this.rows("vendors", "id, name", organizationId),
            this.rows("warehouses", "id, name", organizationId),
            this.rows("rate_lists", "id, name, code, price_type, scope_type, vendor_id, customer_id, currency_code, is_active", organizationId),
        ]);
        const brandNames = new Map(brands.map((brand) => [Number(brand.id), String(brand.name)]));
        return {
            products: products.map((product) => ({
                id: Number(product.id), name: String(product.name), sku: String(product.sku), unit: String(product.unit),
                ...(product.brand_id == null || !brandNames.has(Number(product.brand_id)) ? {} : { brandName: brandNames.get(Number(product.brand_id)) }),
            })),
            customers: customers.map((party) => ({ id: Number(party.id), name: String(party.name) })),
            vendors: vendors.map((party) => ({ id: Number(party.id), name: String(party.name) })),
            warehouses: warehouses.map((warehouse) => ({ id: Number(warehouse.id), name: String(warehouse.name) })),
            rateLists: rateLists
                .filter((rateList) => (rateList.price_type === "SALE" || rateList.price_type === "PURCHASE") && rateList.is_active === true)
                .map((rateList) => ({
                id: Number(rateList.id), name: String(rateList.name), code: String(rateList.code),
                priceType: rateList.price_type, scopeType: rateList.scope_type,
                ...(rateList.vendor_id == null ? {} : { vendorId: Number(rateList.vendor_id) }),
                ...(rateList.customer_id == null ? {} : { customerId: Number(rateList.customer_id) }),
                currencyCode: String(rateList.currency_code), isActive: true,
            })),
        };
    }
}
function normalize(value) {
    return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}
function requestedRateListHint(text) {
    const match = text?.match(/\busing\s+([^.,;]+?)(?=\s+(?:for|to|with)\b|[.,;]|$)/iu);
    return match?.[1]?.trim() || null;
}
function tokens(value) {
    return new Set(normalize(value).split(" ").filter(Boolean));
}
function score(query, candidate) {
    const left = normalize(query);
    const right = normalize(candidate);
    if (!left || !right)
        return 0;
    if (left === right)
        return 1;
    if (right.includes(left) || left.includes(right))
        return 0.86;
    const a = tokens(left);
    const b = tokens(right);
    if (!a.size || !b.size)
        return 0;
    const overlap = [...a].filter((token) => b.has(token)).length;
    return Math.min(0.84, overlap / Math.max(a.size, b.size) * 0.84);
}
function candidateStatus(candidates, input, threshold = MATCHED_THRESHOLD) {
    if (!input?.trim())
        return "not_requested";
    const best = candidates[0];
    if (!best || best.confidence < threshold)
        return "unresolved";
    const second = candidates[1];
    if (best.confidence === 1 && (!second || second.confidence < 1))
        return "matched";
    if (second && best.confidence - second.confidence < AMBIGUITY_MARGIN)
        return "ambiguous";
    return "matched";
}
function matchValues(input, values, threshold = MATCHED_THRESHOLD) {
    const candidates = input?.trim()
        ? values.map((value) => ({
            id: value.id,
            label: value.label,
            confidence: Math.max(score(input, value.label), ...(value.aliases ?? []).map((alias) => score(input, alias)), 0),
            ...(value.details ? { details: value.details } : {}),
        })).filter((value) => value.confidence > 0.2).sort((a, b) => b.confidence - a.confidence || a.id - b.id).slice(0, MATCH_CANDIDATE_LIMIT)
        : [];
    const status = candidateStatus(candidates, input, threshold);
    return { input, status, ...(status === "matched" ? { selectedId: candidates[0].id } : {}), candidates };
}
function matchSelectedId(selectedId, fallback, values) {
    if (selectedId === undefined)
        return fallback;
    const selected = values.find((value) => value.id === selectedId);
    if (!selected)
        return { input: String(selectedId), status: "unresolved", candidates: [] };
    return { input: String(selectedId), status: "matched", selectedId, candidates: [{ id: selectedId, label: selected.label, confidence: 1 }] };
}
function intentToInput(intent) {
    const mapping = {
        estimate: "estimate.create",
        invoice: "invoice.create",
        customer_return: "customer_return.create",
        supplier_bill: "supplier_bill.create",
        inventory_adjustment: "inventory.adjust",
        rate_list_update: "rate_list.import",
    };
    return mapping[intent];
}
function inputToIntent(intent) {
    const mapping = {
        "estimate.create": "estimate",
        "invoice.create": "invoice",
        "customer_return.create": "customer_return",
        "supplier_bill.create": "supplier_bill",
        "inventory.adjust": "inventory_adjustment",
        "rate_list.import": "rate_list_update",
    };
    const result = mapping[intent];
    if (!result)
        throw new ApiError(422, "AI_CLARIFICATION_REQUIRED", "This extracted document cannot be sent to the Copilot transaction workflow.");
    return result;
}
function assistantIntentToInput(intent) {
    const mapping = {
        "estimate.create_draft": "estimate.create",
        "customer_return.create_draft": "customer_return.create",
        "supplier_bill.create_draft": "supplier_bill.create",
        "inventory.adjust_draft": "inventory.adjust",
    };
    return intent ? mapping[intent] : undefined;
}
function toField(value, source, confidence) {
    return { value, source, confidence };
}
function buildProposal(request, intent, source, confidence, lines, customer, vendor, documentNumber, documentDate, currencyCode) {
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
            ...(intent === "estimate" || line.explicitUnitRate == null ? {} : { unitRate: toField(line.explicitUnitRate, source, line.confidence) }),
            ...(line.rateList.selectedId === undefined ? {} : { rateListId: toField(String(line.rateList.selectedId), source, line.rateList.candidates[0]?.confidence ?? line.confidence) }),
        })),
        confidence,
        requiresHumanConfirmation: true,
    };
}
export class CopilotReviewService {
    catalog;
    resolver;
    pricing;
    pipeline;
    constructor(provider, catalog, resolver, pricing) {
        this.catalog = catalog;
        this.resolver = resolver;
        this.pricing = pricing;
        this.pipeline = new AiInputPipeline(new ProviderDocumentExtractor(provider), new InMemoryAiInputGateway());
    }
    async quoteLine(request) {
        if (!this.pricing)
            throw new ApiError(503, "COPILOT_NOT_CONFIGURED", "Authoritative pricing is not configured");
        const catalog = await this.catalog.getCatalog(request.organizationId);
        if (!catalog.products.some((product) => product.id === request.productId))
            throw new ApiError(422, "PRODUCT_NOT_FOUND", "Product is not available in this organization");
        if (request.customerId !== undefined && !catalog.customers.some((customer) => customer.id === request.customerId))
            throw new ApiError(422, "CUSTOMER_NOT_FOUND", "Customer is not available in this organization");
        const selectedProduct = catalog.products.find((product) => product.id === request.productId);
        const productBrand = selectedProduct.brandName ?? explicitBrand(selectedProduct.name);
        if (request.rateListId !== undefined && !catalog.rateLists.some((list) => list.id === request.rateListId && list.priceType === "SALE" && list.isActive !== false && (list.scopeType === "GLOBAL" || (list.scopeType === "CUSTOMER" && list.customerId === request.customerId) || (list.scopeType === "CUSTOMER" && isOpenBrandRateList({ scope_type: list.scopeType, name: list.name, code: list.code }, productBrand))))) {
            throw new ApiError(422, "SALE_RATE_LIST_NOT_FOUND", "Active sale Rate List is not available for this customer");
        }
        try {
            const resolvedPrice = await this.pricing.resolvePrice({
                organization_id: request.organizationId, price_type: "SALE", product_id: request.productId,
                quantity: request.quantity, as_of: new Date().toISOString(),
                ...(request.customerId === undefined ? {} : { customer_id: request.customerId }),
                rate_list_brand: productBrand,
                ...(request.rateListId === undefined ? {} : { rate_list_id: request.rateListId }),
            });
            if (!resolvedPrice)
                return { resolvedPrice: null, amount: null, warning: "No current authorized sale rate was found; choose a valid rate context or ask for clarification." };
            if (normalize(request.unit) !== normalize(resolvedPrice.unit))
                return { resolvedPrice: null, amount: null, warning: `Sale rate uses ${resolvedPrice.unit}, while the request uses ${request.unit}; confirm a supported unit conversion before calculating.` };
            return { resolvedPrice, amount: request.quantity * resolvedPrice.unit_price, warning: null };
        }
        catch (error) {
            if (!(error instanceof Error) || !error.message.startsWith("Ambiguous pricing:"))
                throw error;
            return { resolvedPrice: null, amount: null, warning: "Multiple active sale Rate Lists apply; choose the authorized list." };
        }
    }
    async prepare(request) {
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
        if (!rawDocument || typeof rawDocument !== "object")
            throw new ApiError(422, "AI_INVALID_OUTPUT", "The provider did not return a document proposal.");
        const document = rawDocument;
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
        const lines = await Promise.all(document.lines.map(async (line, index) => {
            const product = matchValues(line.productCode ?? line.productName, catalog.products.map((candidate) => ({
                id: candidate.id,
                label: candidate.name,
                aliases: [candidate.sku, `${candidate.brandName ?? ""} ${candidate.name}`],
                details: { sku: candidate.sku, unit: candidate.unit, ...(candidate.brandName ? { brand: candidate.brandName } : {}) },
            })));
            const matchedProduct = catalog.products.find((candidate) => candidate.id === product.selectedId);
            const productBrand = matchedProduct?.brandName ?? explicitBrand(matchedProduct?.name ?? line.productName);
            const applicableLists = catalog.rateLists.filter((rateList) => rateList.priceType === ratePriceType)
                .filter((rateList) => rateList.isActive !== false)
                .filter((rateList) => rateList.scopeType === "GLOBAL" || (rateList.scopeType === "CUSTOMER" && effectiveCustomerId != null && rateList.customerId === effectiveCustomerId) || (rateList.scopeType === "CUSTOMER" && ratePriceType === "SALE" && isOpenBrandRateList({ scope_type: rateList.scopeType, name: rateList.name, code: rateList.code }, productBrand)) || (rateList.scopeType === "VENDOR" && effectiveVendorId != null && rateList.vendorId === effectiveVendorId));
            const rateInput = requestedRateListHint(request.text) ?? line.brandHint;
            const rateList = request.rateListId !== undefined
                ? matchValues(String(request.rateListId), applicableLists.map((candidate) => ({ id: candidate.id, label: String(candidate.id), aliases: [candidate.name, candidate.code], details: { name: candidate.name, code: candidate.code, currency: candidate.currencyCode } })))
                : matchValues(rateInput, applicableLists.map((candidate) => ({ id: candidate.id, label: candidate.name, aliases: [candidate.code], details: { code: candidate.code, currency: candidate.currencyCode, scope: candidate.scopeType } })), 1);
            const warnings = [];
            if (product.status !== "matched")
                warnings.push(product.status === "ambiguous" ? "Multiple products match this line; choose one." : "Product could not be matched; enter or choose a Product ID.");
            if (rateInput && rateList.status !== "matched" && resolvedIntent === "estimate.create")
                warnings.push(rateList.status === "ambiguous" ? "Multiple sale Rate Lists match; choose the intended list." : `Sale Rate List '${rateInput}' could not be verified; choose an active sale Rate List.`);
            if (line.quantity == null)
                warnings.push("Quantity is missing or unclear.");
            if (resolvedIntent === "estimate.create" && !line.unit?.trim())
                warnings.push("Unit is missing or unclear.");
            let resolvedPrice;
            let amount;
            if (resolvedIntent === "estimate.create" && this.pricing && product.selectedId && line.quantity != null && line.quantity > 0 && line.unit?.trim() && (!rateInput || rateList.status === "matched")) {
                try {
                    const price = await this.pricing.resolvePrice({
                        organization_id: request.organizationId, price_type: "SALE", product_id: product.selectedId,
                        quantity: line.quantity, as_of: new Date().toISOString(),
                        ...(effectiveCustomerId === undefined ? {} : { customer_id: effectiveCustomerId }),
                        ...(ratePriceType === "SALE" ? { rate_list_brand: productBrand } : {}),
                        ...(rateList.selectedId === undefined ? {} : { rate_list_id: rateList.selectedId }),
                    });
                    if (!price)
                        warnings.push("No current authorized sale rate was found; choose a valid rate context or ask for clarification.");
                    else if (line.unit && normalize(line.unit) !== normalize(price.unit))
                        warnings.push(`Sale rate uses ${price.unit}, while the request uses ${line.unit}; confirm a supported unit conversion before calculating.`);
                    else if (document.currencyCode && normalize(document.currencyCode) !== normalize(price.currency_code))
                        warnings.push(`Sale rate currency is ${price.currency_code}, while the request uses ${document.currencyCode}; clarify the currency.`);
                    else {
                        resolvedPrice = price;
                        amount = line.quantity * price.unit_price;
                        rateList.selectedId = price.rate_list_id;
                        rateList.status = "matched";
                        if (!rateList.candidates.some((candidate) => candidate.id === price.rate_list_id)) {
                            const selectedList = applicableLists.find((candidate) => candidate.id === price.rate_list_id);
                            if (selectedList)
                                rateList.candidates.unshift({ id: selectedList.id, label: selectedList.name, confidence: 1 });
                        }
                    }
                }
                catch (error) {
                    if (!(error instanceof Error) || !error.message.startsWith("Ambiguous pricing:"))
                        throw error;
                    warnings.push("Multiple active sale Rate Lists apply; choose the authorized list.");
                }
            }
            return { lineNumber: index + 1, productName: line.productName, productCode: line.productCode, brandHint: line.brandHint, quantity: line.quantity, unit: line.unit, explicitUnitRate: line.unitRate, confidence: line.confidence, product, rateList, ...(resolvedPrice ? { resolvedPrice, amount: amount } : {}), warnings };
        }));
        const blockingReasons = lines.flatMap((line) => line.warnings.map((warning) => `line-${line.lineNumber}:${warning}`));
        if (lines.length === 0)
            blockingReasons.push("no-lines-extracted");
        if (customer.status === "ambiguous" || customer.status === "unresolved")
            blockingReasons.push("customer-match-requires-review");
        if (vendor.status === "ambiguous" || vendor.status === "unresolved")
            blockingReasons.push("vendor-match-requires-review");
        if (warehouse.status === "ambiguous" || warehouse.status === "unresolved")
            blockingReasons.push("warehouse-match-requires-review");
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
//# sourceMappingURL=copilot-review.js.map