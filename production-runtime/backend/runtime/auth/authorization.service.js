export class AuthorizationService {
    gateway;
    constructor(gateway) {
        this.gateway = gateway;
    }
    async assertPermission(userId, organizationId, permission) {
        const allowed = await this.gateway.hasPermission(userId, organizationId, permission);
        if (!allowed) {
            const error = new Error("Forbidden");
            error.status = 403;
            throw error;
        }
    }
}
//# sourceMappingURL=authorization.service.js.map