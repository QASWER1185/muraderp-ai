// Visually checked against the two-page Dura Max U-PVC list dated 29 Sep 2026.
// Includes the three printed dash cells so they cannot become zero-priced items.
export function duraUpvcPages() {
  const variants = ["Conduit", "Medium", "Max", "Class B", "Class C", "Class D", "Class E"];
  const pipeRows: Array<[string, Array<number | string>]> = [
    ['2 inch', [2275,2624,3252,"-",3252,3862,4927]],
    ['3 inch', [3159,4127,5528,5528,6667,8505,10561]],
    ['4 inch', [4224,5418,7040,8343,10887,14298,17448]],
    ['5 inch', [6933,8234,"-",11594,16469,21452,26540]],
    ['6 inch', [9752,12205,14895,16181,23386,30746,37762]],
    ['8 inch', ["-",20036,24369,24398,36160,47459,58296]],
  ];
  const item = (name: string, size: string, list_price: number | string, category = "Fittings", unit = "pcs") => ({brand:"Dura Max", category, name, size, unit, list_price});
  const groups = (name: string, sizes: string[], prices: number[]) => sizes.map((size,i)=>item(name,size,prices[i]!));
  const first = [
    ...pipeRows.flatMap(([size, prices]) => prices.map((price,i)=>item("U-PVC Pipe " + variants[i],size,price,"Pipes","length"))),
    ...groups("Elbow 90°",['2 inch','3 inch','4 inch','6 inch'],[243,515,750,2160]),
    ...groups("Plug Elbow",['3 inch','4 inch','6 inch'],[912,1115,3085]),
    ...groups("Elbow 45°",['2 inch','3 inch','4 inch'],[249,484,647]),
  ];
  const second = [
    ...groups("Reduce Elbow 90°",['3 x 4 inch'],[880]),
    ...groups("Male/Female Elbow 90°",['4 inch'],[807]),
    ...groups("Tee",['2 inch','3 inch','4 inch','6 inch'],[364,752,1056,3508]),
    ...groups("Plug Tee",['3 inch','4 inch','6 inch'],[1140,1405,4982]),
    ...groups("Reduce Tee",['3 x 4 inch'],[1223]),
    ...groups("Male/Female Tee",['4 inch'],[1071]),
    ...groups("Socket",['2 inch','3 inch','4 inch','6 inch'],[176,361,486,1896]),
    ...groups("Reduce Socket",['2 x 3 inch','2 x 4 inch','3 x 4 inch'],[310,444,464]),
    ...groups("Yee",['3 inch','4 inch'],[960,1276]),
    ...groups("Yee",['3 x 4 inch'],[1414]),
    ...groups("End Cap",['2 inch','3 inch','4 inch'],[246,404,461]),
    ...groups("Vent Cowl",['2 inch','3 inch','4 inch'],[212,350,421]),
    ...groups("P Trap",['3 inch','4 inch'],[1125,1605]),
    ...groups("P Trap (Single)",['3 inch','4 inch'],[1035,1259]),
    ...groups("Multi Flow Trap",['5 x 3 inch'],[1310]),
    ...groups("Solvent",['75 g','125 g','250 g','500 g'],[245,384,731,1399]),
  ];
  const page = (items: typeof first) => ({documentType:"rate_list" as const,name:"Dura Max U-PVC Pipes & Fittings",effectiveDate:"2026-09-29",standardDiscountPercent:null,complete:true,confidence:.99,warnings:[] as string[],items});
  return [page(first), page(second)];
}
