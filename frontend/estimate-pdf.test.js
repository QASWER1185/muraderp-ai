import { describe, expect, it, vi } from "vitest";
import { createEstimatePdfFile, shareEstimatePdf } from "./estimate-pdf.js";

const draft = {
  estimateNumber: "EST-101",
  issueDate: "2026-09-14",
  customerName: "Ali Traders",
  phone: "03001234567",
  address: "Lahore",
  rateListName: "Pakistan Cables",
  notes: "Thank you",
  lines: [{ productLabel: "Cable 1.5mm", quantity: 10, unit: "roll", rate: 270 }],
};
const totals = { subtotal: 2700, discountPercent: 45, discountAmount: 1215, amountAfterDiscount: 1485, discount: 1215, carriageDelivery: 200, grandTotal: 1685 };

describe("customer-facing Estimate PDF", () => {
  it("generates a real PDF file containing the approved business document fields", async () => {
    const file = createEstimatePdfFile(draft, totals);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const content = new TextDecoder().decode(bytes);
    expect(file.type).toBe("application/pdf");
    expect(file.name).toBe("EST-101.pdf");
    expect(content.startsWith("%PDF-1.4")).toBe(true);
    for (const text of ["MURAD BUILDING MATERIALS STORE", "Pakistan Cables", "Amount After Discount", "Carriage / Delivery", "GRAND TOTAL"]) expect(content).toContain(text);
    expect(content).toContain("(QUANTITY)");
    expect(content).not.toContain("(UNIT)");
    expect(content).not.toContain("(roll)");
    expect(content).not.toMatch(/Organization ID|Branch ID|Source Estimate ID/);
  });

  it("shares the PDF File through Web Share when file sharing is supported", async () => {
    const file = createEstimatePdfFile(draft, totals);
    const share = vi.fn();
    const download = vi.fn();
    await expect(shareEstimatePdf({ file, title: "Estimate", text: "Please find attached", navigatorObject: { canShare: () => true, share }, download })).resolves.toBe("PDF_SHARED");
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ files: [file] }));
    expect(download).not.toHaveBeenCalled();
  });

  it("downloads the actual PDF and opens a user-controlled WhatsApp fallback without selecting a contact", async () => {
    const file = createEstimatePdfFile(draft, totals);
    const download = vi.fn();
    const openUrl = vi.fn();
    await expect(shareEstimatePdf({ file, title: "Estimate", text: "Please find attached", navigatorObject: {}, download, openUrl })).resolves.toBe("PDF_DOWNLOADED_WHATSAPP_OPENED");
    expect(download).toHaveBeenCalledWith(file);
    const url = new URL(openUrl.mock.calls[0][0]);
    expect(url.hostname).toBe("wa.me");
    expect(url.pathname).toBe("/");
    expect(url.searchParams.get("text")).toContain("attach it before sending");
  });
});
