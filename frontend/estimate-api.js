import { normalizeWorkspaceContext } from "./workspace-context.js";

export class EstimateApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = "EstimateApiError";
    this.status = status;
    this.code = code;
  }
}

export async function createEstimateDraft(context, input, idempotencyKey) {
  const normalized = normalizeWorkspaceContext(context);
  if (!normalized) throw new EstimateApiError("Choose your business workspace before saving an estimate.", 400, "WORKSPACE_REQUIRED");
  const response = await fetch("/api/v1/estimates", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Organization-Id": normalized.organizationId,
      "X-Branch-Id": normalized.branchId,
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(input),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new EstimateApiError(
      body?.error?.message ?? `Estimate request failed with HTTP ${response.status}`,
      response.status,
      body?.error?.code ?? "ESTIMATE_REQUEST_FAILED",
    );
  }
  return body;
}

async function savedEstimateRequest(context, suffix = '', options = {}) {
  const workspace = normalizeWorkspaceContext(context);
  if (!workspace) throw new EstimateApiError('Choose your business workspace.',400,'WORKSPACE_REQUIRED');
  const response = await fetch('/api/v1/estimates'+suffix,{credentials:'include',...options,headers:{'X-Organization-Id':workspace.organizationId,'X-Branch-Id':workspace.branchId,...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new EstimateApiError(body.error?.message??'Estimate request failed',response.status,body.error?.code);
  return body;
}
export const listEstimates=(context,filters={})=>savedEstimateRequest(context,'?'+new URLSearchParams(Object.entries(filters).filter(([,v])=>v!==''&&v!=null)));
export const getEstimate=(context,id)=>savedEstimateRequest(context,'/'+encodeURIComponent(id));
export const updateEstimate=(context,id,changes)=>savedEstimateRequest(context,'/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify(changes)});
