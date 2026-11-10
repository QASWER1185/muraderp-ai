const allowedTransitions = {
    DRAFT: ["DRAFT", "ACTIVE"],
    ACTIVE: ["ACTIVE", "ARCHIVED"],
    ARCHIVED: ["ARCHIVED"],
};
function assertVersionId(versionId) {
    if (!Number.isInteger(versionId) || versionId <= 0) {
        throw new Error("versionId must be a positive integer");
    }
}
function assertTransition(current, next) {
    if (!allowedTransitions[current].includes(next)) {
        throw new Error(`invalid rate-list version transition: ${current} -> ${next}`);
    }
}
export class DefaultRateListLifecycleService {
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    async activate(versionId) {
        assertVersionId(versionId);
        const current = await this.repository.getVersion(versionId);
        assertTransition(current.status, "ACTIVE");
        return this.repository.activateVersion(versionId);
    }
    async archive(versionId) {
        assertVersionId(versionId);
        const current = await this.repository.getVersion(versionId);
        assertTransition(current.status, "ARCHIVED");
        return this.repository.archiveVersion(versionId);
    }
}
/** Tenant-scoped atomic publication of a complete draft version. */
export class DefaultRateListPublicationService {
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    publish(versionId, organizationId) {
        assertVersionId(versionId);
        if (!organizationId.trim())
            throw new Error("organizationId is required");
        return this.repository.publishVersion(versionId, organizationId);
    }
}
//# sourceMappingURL=rate-list.lifecycle.js.map