import { PermissionCode } from "./authorization.types.js";

export interface AuthorizationGateway {
  hasPermission(userId: string, organizationId: string, permission: PermissionCode): Promise<boolean>;
}

export class AuthorizationService {
  constructor(private readonly gateway: AuthorizationGateway) {}

  async assertPermission(
    userId: string,
    organizationId: string,
    permission: PermissionCode,
  ): Promise<void> {
    const allowed = await this.gateway.hasPermission(userId, organizationId, permission);
    if (!allowed) {
      const error = new Error("Forbidden");
      (error as Error & { status?: number }).status = 403;
      throw error;
    }
  }
}
