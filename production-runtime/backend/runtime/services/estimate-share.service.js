import { DefaultEstimatePrintService } from "./estimate-print.service.js";
export class DefaultEstimateShareService {
    printService;
    constructor(printService = new DefaultEstimatePrintService()) {
        this.printService = printService;
    }
    buildWhatsAppShare(estimate, layoutKey = "CLASSIC_PAKISTAN", header, customerName) {
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
//# sourceMappingURL=estimate-share.service.js.map