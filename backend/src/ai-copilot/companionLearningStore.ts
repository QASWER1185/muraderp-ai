import { ApiError } from "../errors/api-error.js";
import type { AgentScope } from "./agent/erp-tools.js";
import type { CompanionSuggestion } from "./installationCompletenessService.js";
/** Co-purchase events are written by the estimate trigger, never by the model. */
export class CompanionLearningStore {
  constructor(private readonly database:()=>any) {}
  async suggestions(scope:AgentScope,productIds:number[],brand?:string):Promise<CompanionSuggestion[]> {
    const {data,error}=await this.database().rpc("depot_companion_suggestions",{
      p_organization_id:scope.organizationId,p_branch_id:scope.branchId,p_actor_user_id:scope.userId,p_product_ids:productIds,p_brand:brand??null,
    });
    if(error)throw new ApiError(502,"COMPANION_MEMORY_UNAVAILABLE","ساتھ لگنے والے سامان کی یادداشت نہیں پڑھی جا سکی۔");
    if(!Array.isArray(data))throw new ApiError(502,"COMPANION_MEMORY_UNAVAILABLE","ساتھ لگنے والے سامان کا نتیجہ درست نہیں۔");
    return data.map((row:any)=>({key:"learned:"+row.product_id,name:row.name,query:row.name,quantity:1,
      source:"learned" as const,reason:row.usage_count+" سابقہ ایسٹیمیٹس میں یہ سامان ساتھ شامل تھا۔",optional:true}));
  }
}
