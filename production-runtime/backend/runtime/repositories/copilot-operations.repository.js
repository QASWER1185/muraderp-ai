import { getSupabaseAdminClient } from '../config/supabase.js';
import { ApiError } from '../errors/api-error.js';
import { normalizeEstimateSearch } from '../ai-copilot/estimate-search.js';
import { SupabaseErpService } from '../services/erp.service.js';
/** Finite, paginated reads. Never use model-authored SQL or a global unscoped lookup. */
export class CopilotOperationsRepository {
    database;
    constructor(database = getSupabaseAdminClient) {
        this.database = database;
    }
    async getPurchase(scope, id) {
        return new SupabaseErpService(this.database).getPurchase(id, scope.organizationId, scope.branchId);
    }
    async read(query) { const { data, error } = await query; if (error)
        throw new ApiError(502, 'ERP_READ_FAILED', 'Authoritative ERP records could not be read.'); return data ?? []; }
    async search(scope, input) {
        const sources = [
            { kind: 'invoices', table: 'invoices', child: 'invoice_items', fk: 'invoice_id', party: 'customers', partyKey: 'customer_id' },
            { kind: 'bills', table: 'purchases', child: 'purchase_items', fk: 'purchase_id', party: 'vendors', partyKey: 'vendor_id' },
            { kind: 'estimates', table: 'estimates', child: 'estimate_items', fk: 'estimate_id', party: 'customers', partyKey: 'customer_id' },
            { kind: 'credit_memos', table: 'credit_notes', child: 'credit_note_items', fk: 'credit_note_id', party: 'customers', partyKey: 'customer_id' },
            { kind: 'payments', table: 'customer_payments', child: 'customer_payment_allocations', fk: 'payment_id', party: 'customers', partyKey: 'customer_id' },
            { kind: 'payments', table: 'vendor_payments', child: 'vendor_payment_allocations', fk: 'payment_id', party: 'vendors', partyKey: 'vendor_id' },
            { kind: 'stock_movements', table: 'stock_movements' }, { kind: 'items', table: 'products' },
        ];
        const results = [];
        const normalized = normalizeEstimateSearch(input.query ?? '');
        const tokens = normalized.split(' ').filter(t => t && !(t === 'electric' && normalized.includes('conduit')));
        const matches = (text) => tokens.every(t => normalizeEstimateSearch(text).includes(t));
        for (const source of sources.filter(row => input.kind === 'all' || row.kind === input.kind)) {
            if (input.customer_id && source.partyKey !== 'customer_id')
                continue;
            if (input.vendor_id && source.partyKey !== 'vendor_id')
                continue;
            const { kind, table } = source, found = [];
            for (let offset = 0;; offset += 100) {
                let q = this.database().from(table).select('*').eq('organization_id', scope.organizationId);
                if (kind !== 'items')
                    q = q.eq('branch_id', scope.branchId);
                if (input.customer_id)
                    q = q.eq('customer_id', input.customer_id);
                if (input.vendor_id)
                    q = q.eq('vendor_id', input.vendor_id);
                if (input.product_id && ['items', 'stock_movements'].includes(kind))
                    q = q.eq(kind === 'items' ? 'id' : 'product_id', input.product_id);
                const headers = await this.read(q.order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 99));
                let lines = [];
                if (source.child && headers.length) {
                    for (let lineOffset = 0;; lineOffset += 1000) {
                        const select = kind === 'payments' ? '*' : '*,products!' + source.child + '_product_id_fkey(name,category)';
                        let detail = this.database().from(source.child).select(select).in(source.fk, headers.map((row) => row.id));
                        if (input.product_id && kind !== 'payments')
                            detail = detail.eq('product_id', input.product_id);
                        const page = await this.read(detail.order('id').range(lineOffset, lineOffset + 999));
                        lines.push(...page);
                        if (page.length < 1000)
                            break;
                    }
                    if (kind === 'payments' && lines.length) {
                        const allocations = lines, customer = source.partyKey === 'customer_id';
                        const parent = customer ? 'invoices' : 'purchases', child = customer ? 'invoice_items' : 'purchase_items', key = customer ? 'invoice_id' : 'purchase_id';
                        const ids = [...new Set(allocations.map(row => row[key]))], products = [];
                        for (let batch = 0; batch < ids.length; batch += 100) {
                            const documents = await this.read(this.database().from(parent).select('id,invoice_number').eq('organization_id', scope.organizationId).eq('branch_id', scope.branchId).in('id', ids.slice(batch, batch + 100)));
                            const allowed = documents.map((row) => row.id);
                            if (!allowed.length)
                                continue;
                            for (let offset = 0;; offset += 1000) {
                                const page = await this.read(this.database().from(child).select('*,products!' + child + '_product_id_fkey(name,category)').in(key, allowed).order('id').range(offset, offset + 999));
                                for (const row of page) {
                                    for (const allocation of allocations.filter(a => a[key] === row[key]))
                                        products.push({ ...row, payment_id: allocation.payment_id, allocated_amount: allocation.amount, source_document: documents.find((d) => d.id === row[key])?.invoice_number });
                                }
                                if (page.length < 1000)
                                    break;
                            }
                        }
                        lines = products;
                    }
                }
                const parties = source.party && headers.length ? await this.read(this.database().from(source.party).select('id,name').eq('organization_id', scope.organizationId).in('id', [...new Set(headers.map((row) => row[source.partyKey]))])) : [];
                const movementProducts = kind === 'stock_movements' && headers.length ? await this.read(this.database().from('products').select('id,name,category').eq('organization_id', scope.organizationId).in('id', [...new Set(headers.map((row) => row.product_id))])) : [];
                for (const row of headers) {
                    let detail = source.fk ? lines.filter(line => line[source.fk] === row.id) : [];
                    if (input.product_id && source.child) {
                        detail = detail.filter(line => line.product_id === input.product_id);
                        if (!detail.length)
                            continue;
                    }
                    const party = parties.find((p) => p.id === row[source.partyKey]);
                    const product = movementProducts.find((p) => p.id === row.product_id);
                    const text = [row.invoice_number, row.estimate_number, row.credit_note_number, row.reference_number, row.reference, row.name, row.sku, row.category, row.notes, row.reason, row.movement_type, row.reference_type, row.reference_id, party?.name, product?.name, product?.category].filter(value => value != null).join(' ');
                    if (!matches(text) && !detail.some(line => matches([text, line.description, line.products?.name, line.products?.category, line.source_document].filter(Boolean).join(' '))))
                        continue;
                    found.push({ kind, source: table, id: row.id, number: row.invoice_number ?? row.estimate_number ?? row.credit_note_number ?? row.reference_number ?? row.reference ?? row.sku,
                        name: row.name ?? product?.name, party_name: party?.name, created_at: row.created_at, status: row.status ?? (kind === 'bills' ? 'RECORDED' : undefined),
                        total_amount: row.total ?? row.grand_total ?? row.amount, currency: row.currency_code,
                        ...(kind === 'stock_movements' ? { product_id: row.product_id, warehouse_id: row.warehouse_id, movement_type: row.movement_type, quantity: row.quantity, reference_type: row.reference_type, reference_id: row.reference_id } : {}),
                        line_item_summary: detail.map(line => ({ id: line.id, product_id: line.product_id, name: line.description || line.products?.name, quantity: line.quantity, unit: line.unit, unit_price: line.unit_price ?? line.unit_cost, line_total: line.line_total ?? line.line_amount ?? line.total_cost, source_document: line.source_document, allocated_amount: line.allocated_amount })) });
                }
                if (headers.length < 100 || found.length > input.limit)
                    break;
            }
            results.push(...found);
        }
        results.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id);
        return { authoritative: true, ordering: 'created_at_DESC', data: results.slice(0, input.limit), hasMore: results.length > input.limit };
    }
    async vendorLedger(scope, vendorId, limit) {
        const rows = [];
        for (let offset = 0;; offset += 500) {
            const page = await this.read(this.database().from('vendor_payable_ledger_entries').select('*').eq('organization_id', scope.organizationId).eq('branch_id', scope.branchId).eq('vendor_id', vendorId).order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 499));
            rows.push(...page);
            if (page.length < 500)
                break;
        }
        // Native purchase/payable schema has no currency column; do not fabricate one.
        const fixed = (v) => { const text = String(v); if (!/^\d+(?:\.\d{1,4})?$/.test(text))
            throw new ApiError(502, 'ERP_READ_FAILED', 'Ledger amount is invalid.'); const [whole, fraction = ''] = text.split('.'); return BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0')); };
        const balance = rows.reduce((sum, r) => sum + fixed(r.credit) - fixed(r.debit), 0n);
        return { authoritative: true, kind: 'vendor_ledger', vendor_id: vendorId, outstanding_balance: Number(balance) / 10000, transactions: rows.slice(0, limit), hasMore: rows.length > limit, balanceIncludesAllEntries: true };
    }
}
//# sourceMappingURL=copilot-operations.repository.js.map