export interface InstallationLine { name:string;quantity:number }
export interface CompanionSuggestion { key:string;name:string;query:string;quantity:number;reason:string;source:"installation"|"learned";optional?:boolean }
type Companion={key:string;name:string;aliases:RegExp;perUnit?:number;optional?:boolean};
type Bundle={key:string;trigger:RegExp;companions:Companion[]};
const c=(key:string,name:string,aliases:RegExp,perUnit?:number,optional=false):Companion=>({key,name,aliases,...(perUnit?{perUnit}:{}),...(optional?{optional}: {})});
const queries:Record<string,string>={"t-cock":"T Cock","cistern-connection":"Braided Connection Pipe",thimble:"Waste Thimble",seat:"Seat Cover","muslim-shower":"Muslim Shower","wax-ring":"Wax Ring","wc-bolts":"Floor Fixing Bolts","waste-coupling":"Waste Coupling","basin-trap":"Bottle Trap","basin-connections":"Basin Connection Pipe","concealed-cocks":"Concealed Stop Cock","basin-bolts":"Basin Fixing Bolts","geyser-pipes":"Geyser Connection Pipe 24 inch","safety-valve":"Safety Non Return Valve","geyser-brackets":"Geyser Hanging Bracket","gas-connection":"Gas Cock",solvent:"Solvent Solution 500g",muslin:"Muslin Cloth",blade:"Hacksaw Blade",clamp:"Pipe Clamp",teflon:"Teflon Tape",thread:"Thread Seal", "test-plug":"Test Plug","foot-valve":"Foot Valve",union:"Union",nrv:"Non Return Valve","fan-rod":"Fan Down Rod",canopy:"Canopy",shackle:"Shackle Bolt",regulator:"Fan Regulator",capacitor:"Capacitor",dp:"DP Breaker",sp:"SP Breaker",busbar:"Comb Busbar",earth:"Earthing Rod",shuttering:"Shuttering Tape",waterproof:"Waterproof Chemical",polythene:"Polythene Sheet",grout:"Tile Grout",spacers:"Tile Spacers","diamond-blade":"Diamond Cutting Blade"};
const bundles:Bundle[]=[
  {key:"wc",trigger:/\b(?:commode|wc|water closet)\b|کموڈ|کموڑ/iu,companions:[
    c("t-cock","ٹی کاک",/t[ -]?cock|ٹی\s*(?:کاک|ہاف)/iu,2),c("cistern-connection","ٹینکی کا کنکشن پائپ",/braided|cistern.*connection|ٹینکی.*کنکشن/iu,1),
    c("thimble","ویسٹ تھمبل",/thimble|تھمبل/iu,1),c("seat","سیٹ کور",/seat.*cover|سیٹ\s*کور/iu,1),c("muslim-shower","مسلم شاور سیٹ",/muslim.*shower|مسلم\s*شاور/iu,1),
    c("wax-ring","ویکس رنگ",/wax.*ring|ویکس\s*رنگ/iu,1),c("wc-bolts","فرش کے فکسنگ بولٹ",/floor.*(?:bolt|fix)|فرش.*(?:بولٹ|پیچ)/iu,1)]},
  {key:"basin",trigger:/\b(?:basin|vanity)\b|واش\s*بیسن|وینٹی/iu,companions:[
    c("waste-coupling","ویسٹ کپلنگ",/waste.*coupling|ویسٹ\s*کپلنگ/iu,1),c("basin-trap","بوٹل ٹریپ یا ویسٹ پائپ",/bottle.*trap|waste.*pipe|بوٹل\s*ٹریپ|ویسٹ\s*پائپ/iu,1),
    c("basin-connections","بیسن کنکشن پائپ",/basin.*connection|بیسن.*کنکشن/iu,2),c("concealed-cocks","کنسیلڈ سٹاپ کاک",/concealed.*(?:stop|cock)|کنسیلڈ.*کاک/iu,2),c("basin-bolts","بیسن فکسنگ بولٹ",/basin.*(?:bolt|fix)|بیسن.*بولٹ/iu,1)]},
  {key:"geyser",trigger:/\bgeyser\b|گیزر/iu,companions:[
    c("geyser-pipes","گیزر ہیوی ڈیوٹی کنکشن پائپ 24 inch",/geyser.*connection|گیزر.*کنکشن/iu,2),c("safety-valve","سیفٹی نان ریٹرن والو",/safety.*valve|سیفٹی.*والو/iu,1),
    c("geyser-brackets","گیزر ہینگنگ بریکٹ اور بولٹ",/hanging.*bracket|گیزر.*بریکٹ/iu,1),c("gas-connection","گیس کاک اور پائپ (صرف گیس گیزر)",/gas.*(?:cock|pipe)|گیس.*(?:کاک|پائپ)/iu,1,true)]},
  {key:"upvc",trigger:/u[ -]?pvc|یو\s*پی\s*وی\s*سی/iu,companions:[
    c("solvent","سولونٹ سلوشن 500g",/solvent|solution|سلوشن/iu),c("muslin","ململ پیکنگ کپڑا",/muslin|ململ/iu),c("blade","آری یا جھری بلیڈ",/hacksaw|jari|آری|جھری/iu)]},
  {key:"pprc",trigger:/ppr[ -]?c|پی\s*پی\s*آر/iu,companions:[
    c("clamp","نیل کلیمپ یا سٹیل پائپ ہک",/clamp|hook|کلیمپ|پائپ\s*ہک/iu),c("teflon","ٹیفلون ٹیپ",/teflon|ٹیفلون|سفیدہ\s*ٹیپ/iu),
    c("thread","تھریڈ سیل گولا",/thread.*seal|دھاگہ|گولا/iu),c("test-plug","ٹیسٹ پلگ",/test.*plug|ٹیسٹ\s*پلگ/iu)]},
  {key:"pump",trigger:/\b(?:water pump|motor|pump)\b|موٹر|واٹر\s*پمپ/iu,companions:[
    c("foot-valve","فٹ والو",/foot.*valve|فٹ\s*والو/iu,1),c("union","G.I. یا PPR-C یونین",/union|یونین/iu,1),c("nrv","نان ریٹرن والو",/non[ -]?return|نان\s*ریٹرن/iu,1)]},
  {key:"fan",trigger:/ceiling.*fan|چھت.*پنکھا|سیلنگ\s*فین/iu,companions:[
    c("fan-rod","فین راڈ (2ft یا 3ft، لمبائی واضح کریں)",/fan.*(?:rod|down)|فین\s*راڈ/iu,1),c("canopy","کٹوری سیٹ",/canopy|کٹوری/iu,1),
    c("shackle","شیکل نٹ بولٹ",/shackle|شیکل/iu,1),c("regulator","فین ڈمر یا ریگولیٹر",/dimmer|regulator|ڈمر|ریگولیٹر/iu,1),c("capacitor","کیپیسٹر",/capacitor|کیپیسٹر/iu,1)]},
  {key:"db",trigger:/distribution.*board|\bdb\s*(?:panel|board)\b|ڈی\s*بی\s*پینل/iu,companions:[
    c("dp","مین DP بریکر (40A یا 63A، ریٹنگ واضح کریں)",/\bdp\b|ڈی\s*پی/iu,1),c("sp","SP بریکر (سرکٹ کے مطابق ریٹنگ اور تعداد)",/\bsp\b|ایس\s*پی/iu),
    c("busbar","کومب بس بار",/busbar|بس\s*بار/iu,1),c("earth","ارتھنگ راڈ اور تار",/earth|ارتھ/iu,1)]},
  {key:"slab",trigger:/roof.*slab|slab.*(?:pour|concrete)|چھت.*(?:کنکریٹ|لینٹر)|لینٹر/iu,companions:[
    c("shuttering","شٹرنگ ٹیپ",/shuttering.*tape|شٹرنگ\s*ٹیپ/iu),c("waterproof","کنکریٹ واٹر پروف کیمیکل",/waterproof|واٹر\s*پروف/iu),c("polythene","پولیتھین شیٹ",/polythene|پولیتھین/iu)]},
  {key:"tile",trigger:/tile.*bond|ٹائل\s*بانڈ/iu,companions:[
    c("grout","مماثل ٹائل گراؤٹ فلنگ پاؤڈر",/grout|گراؤٹ/iu),c("spacers","ٹائل سپیسر",/spacer|سپیسر/iu),c("diamond-blade","ڈائمنڈ ٹائل کٹنگ بلیڈ",/diamond.*blade|ڈائمنڈ.*بلیڈ/iu)]},
];
export class InstallationCompletenessService {
  audit(lines:InstallationLine[]):CompanionSuggestion[] {
    const missing=new Map<string,CompanionSuggestion>();
    for(const bundle of bundles){
      const triggers=lines.filter(line=>bundle.trigger.test(line.name));
      if(!triggers.length)continue;
      for(const companion of bundle.companions){
        if(companion.key==="gas-connection" && !triggers.some(line=>/gas|گیس/iu.test(line.name)))continue;
        const required=companion.perUnit?triggers.reduce((sum,line)=>sum+line.quantity,0)*companion.perUnit:1;
        const present=lines.filter(line=>companion.aliases.test(line.name)).reduce((sum,line)=>sum+line.quantity,0);
        if(present>=required)continue;
        const key=bundle.key+":"+companion.key;
        missing.set(key,{key,name:companion.name,query:queries[companion.key]!,quantity:required-present,reason:triggers.map(line=>line.name).join("، "),source:"installation",...(companion.optional?{optional:true}:{})});
      }
    }
    return [...missing.values()];
  }
  prompt(items:CompanionSuggestion[]):string {
    return items.length?"حاجی صاحب! پرچی کا سامان درج کر لیا ہے۔ عام طور پر ساتھ لگنے والا سامان ("+items.map(item=>item.name+" × "+item.quantity).join("، ")+") پرچی پر نہیں ہے۔ کیا مناسب مقدار اور سائز کی تصدیق کے بعد یہ بھی شامل کر دوں تاکہ سائٹ پر کام نہ رکے؟":"";
  }
}
