export interface AuthoritativeTransactionIdentity {
  organizationId: string;
  branchId: string;
  actorUserId: string;
  servicePrincipalId: string;
}

export type AuthoritativeTransactionContext<Operation extends string> =
  AuthoritativeTransactionIdentity & {
    operation: Operation;
    idempotencyKey: string;
    requestFingerprint: string;
  };
