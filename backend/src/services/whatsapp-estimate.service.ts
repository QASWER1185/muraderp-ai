import type { EstimateDocument } from "../types/estimate-document.types.js";
import type { BusinessHeaderProfile, EstimateLayoutKey } from "../types/estimate-layout.types.js";
import { DefaultEstimatePrintService } from "./estimate-print.service.js";
import { normalizePakistanPhone, type WhatsAppEstimateDelivery } from "../types/whatsapp-share.types.js";

export class WhatsAppEstimateService {
  constructor(private readonly printService = new DefaultEstimatePrintService()) {}

  prepareDelivery(
    estimate: EstimateDocument,
    phone: string,
    layoutKey: EstimateLayoutKey = "CLASSIC_PAKISTAN",
    header?: BusinessHeaderProfile,
  ): WhatsAppEstimateDelivery {
    const normalizedPhone = normalizePakistanPhone(phone);
    const document = this.printService.buildPrintable(estimate, "PDF", layoutKey, header);
    const message = `Please find estimate ${estimate.definition.estimate_number} from ${document.model.header.business_name}. Total Payable: ${document.customer_payable_total} ${estimate.definition.currency_code}`;
    return {
      channel: "WHATSAPP",
      mode: "WEB_LINK",
      phone: normalizedPhone,
      message,
      share_url: `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`,
      document_name: `${estimate.definition.estimate_number}.pdf`,
      document_format: "PDF",
    };
  }
}
