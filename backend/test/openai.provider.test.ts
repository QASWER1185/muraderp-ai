import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { OpenAiProvider, ProviderDocumentExtractor } from "../src/ai-input/openai.provider.js";

const responseSchema = z.strictObject({ value: z.string() });
const API_KEY = "sk-test-provider-key-12345678901234567890";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("OpenAI AI input adapter", () => {
  it("returns schema-validated structured output without exposing provider details", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ value: "proposal" }) }] }] }));
    const provider = new OpenAiProvider({ apiKey: API_KEY, model: "gpt-test", speechModel: "gpt-transcribe" }, fetcher);

    await expect(provider.generate(responseSchema, "extract", [{ type: "input_text", text: "input" }])).resolves.toEqual({ value: "proposal" });
    expect(fetcher).toHaveBeenCalledWith("https://api.openai.com/v1/responses", expect.objectContaining({ method: "POST", headers: expect.objectContaining({ Authorization: `Bearer ${API_KEY}` }) }));
  });

  it("uploads validated voice media to the transcription endpoint", async () => {
    const wav = Buffer.from("RIFF0000WAVEfmt ", "ascii").toString("base64");
    const fetcher = vi.fn().mockResolvedValue(response({ text: "create an invoice" }));
    const provider = new OpenAiProvider({ apiKey: API_KEY, model: "gpt-test", speechModel: "gpt-transcribe" }, fetcher);

    await expect(provider.transcribe({ mimeType: "audio/wav", base64: wav })).resolves.toBe("create an invoice");
    expect(fetcher).toHaveBeenCalledWith("https://api.openai.com/v1/audio/transcriptions", expect.objectContaining({ method: "POST", headers: { Authorization: `Bearer ${API_KEY}` }, body: expect.any(FormData) }));
  });

  it.each([
    ["image/png", "input_image", "image_url"],
    ["application/pdf", "input_file", "file_data"],
  ])("sends %s input through the production document extraction transport", async (mimeType, contentType, dataField) => {
    const extracted = {
      customerName: null, vendorName: null, warehouseName: null, documentNumber: null, documentDate: null,
      currencyCode: null, lines: [{ productName: "Cement", productCode: null, brandHint: null, quantity: 1, unit: "bag", unitRate: 1500, confidence: 0.99 }],
      confidence: 0.99, warnings: [],
    };
    const fetcher = vi.fn().mockResolvedValue(response({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(extracted) }] }] }));
    const provider = new OpenAiProvider({ apiKey: API_KEY, model: "gpt-test", speechModel: "gpt-transcribe" }, fetcher);
    const extractor = new ProviderDocumentExtractor(provider);
    const base64 = mimeType === "application/pdf"
      ? Buffer.from("%PDF-1.7\n", "ascii").toString("base64")
      : "iVBORw0KGgo=";

    await expect(extractor.extract({
      organizationId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222",
      source: "image", intent: "rate_list.import", media: { mimeType: mimeType as "image/png" | "application/pdf", base64 },
    })).resolves.toMatchObject({ requiresConfirmation: true, fields: { document: { value: extracted } } });

    const requestBody = JSON.parse(fetcher.mock.calls[0]![1]!.body as string);
    const mediaPart = requestBody.input[0].content.find((part: Record<string, unknown>) => part.type === contentType);
    expect(mediaPart).toBeTruthy();
    expect(mediaPart[dataField]).toMatch(/^data:/);
    expect(requestBody.store).toBe(false);
  });

  it("fails closed when no provider key is configured", async () => {
    const provider = new OpenAiProvider({ apiKey: undefined, model: "gpt-test", speechModel: "gpt-transcribe" }, vi.fn());
    await expect(provider.generate(responseSchema, "extract", [])).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED", status: 503 });
  });
});
