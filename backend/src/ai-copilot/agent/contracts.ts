import type { DraftView } from './draft-tools.js';
import type { BusinessFact } from './business-tools.js';
import type { BusinessState } from './business-state.js';

export interface AgentResult {
  answer:string; conversationToken:string; conversationId:string; traceId:string; status:string; toolNames:string[]; requiresConfirmation:boolean;
  execution?:any; draft?:DraftView; review?:unknown; businessFacts?:BusinessFact[];
  paymentPreparation?:BusinessState["paymentPreparation"]; clarification?:BusinessState["clarification"];
  preparation?:{intent:string;requiredFields:string[]};
  reports?:unknown[];
}
