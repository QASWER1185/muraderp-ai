const clean=(value:unknown)=>String(value??'').replace(/\|/g,' / ').replace(/[\r\n]+/g,' ').replace(/\bCAT-[A-Za-z0-9_-]+\b/g,'کیٹلاگ آئٹم');
const money=(value:number)=>value.toLocaleString('en-PK',{minimumFractionDigits:2,maximumFractionDigits:2});
export function demandMarkdownTable(lines:any[]):string{
  return ['| # | آئٹم و سائز | تعداد | لسٹ ریٹ | رعایت % | نیٹ ریٹ | کل رقم |','| --- | --- | --- | --- | --- | --- | --- |',...lines.map((line,index)=>{
    const qty=Number(line.quantity??line.qty),rate=Number(line.unit_price),discount=Number(line.discount_amount??0),pending=!!line.pending;
    return `| ${line.line_number??index+1} | ${clean([line.productName??line.name,line.size].filter(Boolean).join(' · '))} | ${qty} ${clean(line.unit)} | ${pending?'ریٹ مطلوب':money(rate)} | ${line.discountPercent??0}% | ${pending?'ریٹ مطلوب':money(rate-discount/qty)} | ${pending?'ریٹ مطلوب':money(qty*rate-discount)} |`;
  })].join('\n');
}
export function savedEstimateAnswer(record:any):string{
  return `جناب، **${clean(record.estimate_number)}** — ${clean(record.customer_name)}\nحالت: **${record.status}** · تاریخ ${record.issue_date} · ${record.lines.length} آئٹمز\n\n`+
  ['| # | آئٹم و سائز | تعداد | لسٹ ریٹ | رعایت % | نیٹ ریٹ | کل رقم |','| --- | --- | --- | --- | --- | --- | --- |',...record.lines.map((l:any,i:number)=>`| ${i+1} | ${clean(l.product_name)} | ${l.quantity} ${clean(l.unit)} | ${money(l.list_price)} | ${Number(l.discount_percent).toFixed(2)}% | ${money(l.unit_price)} | ${money(l.line_total)} |`)].join('\n')+`\n\n**کل رقم: PKR ${money(record.grand_total)}**\nمحفوظ نرخ دکھائے گئے ہیں۔`;
}
