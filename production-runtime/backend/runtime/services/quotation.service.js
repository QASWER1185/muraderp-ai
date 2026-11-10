export class DefaultQuotationService {
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    async convertEstimate(estimate, _definition) {
        if (estimate.status !== "READY") {
            throw new Error("only READY estimates can be issued as quotation");
        }
        if (estimate.id <= 0)
            throw new Error("estimate must have a persisted id");
        return this.repository.saveEstimate(estimate);
    }
}
//# sourceMappingURL=quotation.service.js.map