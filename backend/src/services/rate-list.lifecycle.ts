import type { RateListVersionStatus } from "../types/pricing.types.js";
import type { RateListVersionRecord } from "../repositories/rate-list.repository.js";

export interface RateListLifecycleRepository {
  getVersion(versionId: number): Promise<RateListVersionRecord>;
  activateVersion(versionId: number): Promise<RateListVersionRecord>;
  archiveVersion(versionId: number): Promise<RateListVersionRecord>;
}

export interface RateListLifecycleService {
  activate(versionId: number): Promise<RateListVersionRecord>;
  archive(versionId: number): Promise<RateListVersionRecord>;
}

const allowedTransitions: Record<RateListVersionStatus, RateListVersionStatus[]> = {
  DRAFT: ["DRAFT", "ACTIVE"],
  ACTIVE: ["ACTIVE", "ARCHIVED"],
  ARCHIVED: ["ARCHIVED"],
};

function assertVersionId(versionId: number): void {
  if (!Number.isInteger(versionId) || versionId <= 0) {
    throw new Error("versionId must be a positive integer");
  }
}

function assertTransition(current: RateListVersionStatus, next: RateListVersionStatus): void {
  if (!allowedTransitions[current].includes(next)) {
    throw new Error(`invalid rate-list version transition: ${current} -> ${next}`);
  }
}

export class DefaultRateListLifecycleService implements RateListLifecycleService {
  constructor(private readonly repository: RateListLifecycleRepository) {}

  async activate(versionId: number): Promise<RateListVersionRecord> {
    assertVersionId(versionId);
    const current = await this.repository.getVersion(versionId);
    assertTransition(current.status, "ACTIVE");
    return this.repository.activateVersion(versionId);
  }

  async archive(versionId: number): Promise<RateListVersionRecord> {
    assertVersionId(versionId);
    const current = await this.repository.getVersion(versionId);
    assertTransition(current.status, "ARCHIVED");
    return this.repository.archiveVersion(versionId);
  }
}
