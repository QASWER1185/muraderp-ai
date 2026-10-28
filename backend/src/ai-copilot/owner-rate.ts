import { normalizeVoiceChoices } from './voice-choices.js';

/** Gemini supplies the structured numeric amount and verbatim supporting words.
 * Word amounts (ساڑھے پانچ ہزار روپے) are valid evidence too; digit-only
 * filters must not silently discard the owner's spoken prices. */
export function ownerRatePresent(rate:number,evidence:string|undefined,message:string){
  const text=normalizeVoiceChoices(message);
  if(evidence){
    const quote=normalizeVoiceChoices(evidence).trim();
    if(quote&&text.includes(quote)&&/روپ|قیمت|نرخ|ریٹ|کرایہ|\b(?:pkr|rs|price|rate|rent|delivery)\b/iu.test(quote))return true;
  }
  return (text.match(/\d[\d,]*(?:\.\d+)?/g)??[]).some(value=>Number(value.replaceAll(',',''))===rate);
}
