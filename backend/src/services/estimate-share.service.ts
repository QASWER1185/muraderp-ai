import type { EstimateOutputFormat, PrintableEstimateDocument } from "../types/estimate-print.types.js";
import { DefaultEstimatePrintService } from "./estimate-print.service.js";
import type { EstimateDocument } from "../types/estimate-document.types.js";
import type { BusinessHeaderProfile, EstimateLayoutKey } from "../types/estimate-layout.types.js";

export interface EstimateSharePayload {
  channel: "WHATSAPP";
  format: EstimateOutputFormat;
  document: PrintableEstimateDocument;
  message: string;
}

export class DefaultEstimateShareService {
  constructor(private readonly printService = new DefaultEstimatePrintService()) {}

  buildWhatsAppShare(
    estimate: EstimateDocument,
    layoutKey: EstimateLayoutKey = "CLASSIC_PAKISTAN",
    header?: BusinessHeaderProfile,
    customerName?: string,
  ): EstimateSharePayload {
    const document = this.printService.buildPrintable(estimate, "SHARE", layoutKey, header);
    const greeting = customerName ? `Dear ${customerName},` : "Dear Customer,";
    const message = `${greeting}\nPlease find your estimate ${estimate.definition.estimate_number} from ${document.model.header.business_name}.\nTotal Payable: ${document.customer_payable_total} ${estimate.definition.currency_code}`;

    return {
      channel: "WHATSAPP",
      format: "SHARE",
      document,
      message,
    };
  }
}
