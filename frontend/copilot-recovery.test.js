import {describe,it,expect} from "vitest";
import {copilotRecoveryMessage} from "./copilot-recovery.js";
import {erpActionReviewMarkup} from "./copilot-ui.js";
describe("conversational recovery",()=>{
  it.each([401,403,502])("offers a next step for HTTP %s without raw technical text",status=>{
    const answer=copilotRecoveryMessage({status,message:"private SQL and credentials"});
    expect(answer).toContain("جناب");expect(answer).not.toContain("private SQL");
  });
  it("shows every pending line without a financial approval button",()=>{
    const markup=erpActionReviewMarkup({requiresConfirmation:false,preview:{incomplete:true,summary:"جزوی رقم PKR 100",lines:[{productName:"Socket",quantity:2,pending:true}]}});
    expect(markup).toContain("Socket");expect(markup).toContain("پینڈنگ تصدیق");expect(markup).not.toContain("data-confirm-draft");
  });
});
