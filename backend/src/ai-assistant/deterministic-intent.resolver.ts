import type { AssistantIntent, AssistantIntentResolver, AssistantIntentResult } from "./assistant.types.js";

const READ_RULES: Array<[AssistantIntent, RegExp]> = [
  ["receivable.lookup", /\b(receivable|receivables|outstanding customer|customer balance)\b/i],
  ["payable.lookup", /\b(payable|payables|supplier balance|vendor balance)\b/i],
  ["inventory.lookup", /\b(stock|inventory|warehouse stock)\b/i],
  ["invoice.lookup", /\binvoice\b/i],
  ["estimate.lookup", /\bestimate\b/i],
  ["purchase.lookup", /\b(purchase|purchases)\b/i],
  ["customer.lookup", /\bcustomer\b/i],
  ["vendor.lookup", /\b(vendor|supplier)\b/i],
  ["product.lookup", /\b(product|item)\b/i],
  ["reporting.query", /\b(report|sales|profit|loss|revenue|expense|dashboard)\b/i],
];

const DRAFT_RULES: Array<[AssistantIntent, RegExp]> = [
  ["estimate.create_draft", /\b(create|make|prepare|draft)\b.*\bestimate\b/i],
  ["invoice.create_draft", /\b(create|make|prepare|draft)\b.*\binvoice\b/i],
  ["customer_return.create_draft", /\b(create|make|prepare|draft)\b.*\b(return)\b.*\bcustomer\b/i],
  ["supplier_bill.create_draft", /\b(create|make|prepare|draft)\b.*\b(supplier bill|vendor bill|purchase bill)\b/i],
  ["inventory.adjust_draft", /\b(adjust|correct|set|update)\b.*\b(stock|inventory)\b/i],
];

export class DeterministicIntentResolver implements AssistantIntentResolver {
  resolve(message: string): AssistantIntentResult {
    const normalized = message.trim();
    if (!normalized) {
      return { intent: null, decision: "clarify", confidence: 0, entities: {}, clarification: "Please tell me what you want to check or prepare." };
    }

    for (const [intent, rule] of DRAFT_RULES) {
      if (rule.test(normalized)) {
        return { intent, decision: "draft", confidence: 0.9, entities: {}, };
      }
    }

    for (const [intent, rule] of READ_RULES) {
      if (rule.test(normalized)) {
        return { intent, decision: "answer", confidence: 0.85, entities: {}, };
      }
    }

    return {
      intent: null,
      decision: "clarify",
      confidence: 0,
      entities: {},
      clarification: "I could not identify the ERP request. Please specify the customer, vendor, product, document, report, or draft you need.",
    };
  }
}
