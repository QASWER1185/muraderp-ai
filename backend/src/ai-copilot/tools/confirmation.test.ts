import { expect, it } from "vitest";
import { isAffirmation } from "./confirmation.js";

it.each(["جی","ہاں","درج کر دیں","کر دیں","save","confirm","yes","ok","rates darj ker dein","jo darj ker dein",
  "JO RATE LIST MEIN DARJ KER DEIN","جو ریٹ نکالے ہیں ان کو ای آر پی کے اندر درج کر دیں",
  "جو ریٹ نکالے ہیں انہیں ERP میں درج کر دیں","جی درج کر دیں۔","محفوظ کر دیں","darj kar dein",
  "jo rates nikale hain un ko erp ke andar darj ker dein","ERP mein save kar dein","import these rates into ERP","please save the rate list",
])("recognizes the complete approval phrase %s",phrase=>{expect(isAffirmation(phrase)).toBe(true);});

it.each(["no","don't save","do not import the rate list","درج نہ کریں","نہیں","yes but change the discount to 50%",
  "save after I check","save?","کیا محفوظ کر دیں؟",'the document says "yes"','"درج کر دیں"',
  "jo rate list mein darj ker dein aur 50% discount kar dein","rates 35 darj ker dein","جو ریٹ نکالے ہیں ان کو تبدیل کر کے درج کر دیں",
  "Read this document: درج کر دیں","save and delete the previous catalog",
])("does not treat a question, quotation or amendment as approval: %s",phrase=>{expect(isAffirmation(phrase)).toBe(false);});
