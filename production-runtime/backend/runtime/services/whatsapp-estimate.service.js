import { DefaultEstimatePrintService } from "./estimate-print.service.js";
import { normalizePakistanPhone } from "../types/whatsapp-share.types.js";
export class WhatsAppEstimateService {
    printService;
    constructor(printService = new DefaultEstimatePrintService()) {
        this.printService = printService;
    }
    prepareDelivery(estimate, phone, layoutKey = "CLASSIC_PAKISTAN", header) {
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
//# sourceMappingURL=whatsapp-estimate.service.js.map