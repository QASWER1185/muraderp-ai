export class EstimateRateListPickerService {
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    async getSaleRateListOptions(organizationId) {
        const lists = await this.repository.listActiveSaleRateLists(organizationId);
        return lists.map((list) => ({
            id: list.id,
            name: list.name,
            code: list.code,
            price_type: list.price_type,
            currency_code: list.currency_code,
            is_active: list.is_active,
        }));
    }
}
//# sourceMappingURL=estimate-rate-list-picker.service.js.map