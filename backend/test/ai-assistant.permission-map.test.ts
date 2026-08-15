import { describe, expect, it } from "vitest";
import { ASSISTANT_INTENT_PERMISSION } from "../src/ai-assistant/permission-map.js";

describe("assistant permission vocabulary", () => {
  it("contains an explicit permission for every supported intent", () => {
    expect(Object.keys(ASSISTANT_INTENT_PERMISSION)).toHaveLength(15);
    expect(ASSISTANT_INTENT_PERMISSION["invoice.create_draft"]).toBe("sales.create");
    expect(ASSISTANT_INTENT_PERMISSION["supplier_bill.create_draft"]).toBe("purchases.create");
    expect(ASSISTANT_INTENT_PERMISSION["inventory.adjust_draft"]).toBe("inventory.adjust");
  });
});
