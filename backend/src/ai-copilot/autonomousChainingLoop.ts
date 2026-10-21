import type { AgentScope,ErpToolRegistry } from "./agent/erp-tools.js";
import type { BusinessState } from "./agent/business-state.js";
/** One preparation cycle. All writes remain behind the combined approval. */
export class AutonomousChainingLoop {
  constructor(private readonly tools:Pick<ErpToolRegistry,"execute">){}
  async prepareEstimate(choices:Record<string,unknown>,scope:AgentScope,state:BusinessState,userMessage?:string){
    if(typeof choices.brand==="string")state.brandHint=choices.brand;
    else delete state.brandHint;
    const result=await this.tools.execute("erp_create_estimate",choices,scope,state,userMessage) as any;
    const review=result.review;
    const answer=review.preview.summary;
    state.pendingAction={draftId:review.draftId,idempotencyKey:review.idempotencyKey,summary:answer.slice(0,1000),expires:Math.min(state.expires,Date.now()+10*60_000)};
    state.workingActionId=review.draftId;
    return {answer,review,stages:["پرچی کی تمام لائنیں","گاہک کی شناخت یا مشترکہ نیا گاہک پری ویو","فعال برانڈ ریٹ لسٹ","ساتھ لگنے والے سامان کی جانچ","خرید لاگت اور رعایت کی پڑتال","اردو تخمینہ اور واٹس ایپ کارڈ"]};
  }
}
