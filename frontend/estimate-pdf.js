const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
export function savedEstimateRows(estimate){
  const rows=estimate.lines.map((line,index)=>({line,index}));
  return [...new Set(rows.map(({line})=>line.category||'Items'))].flatMap(category=>rows.filter(({line})=>(line.category||'Items')===category));
}

// Browser canvas shapes Urdu using the same bundled font as Customer Preview.
// A continuous custom-size PDF page keeps every quotation row together.
export async function createSavedEstimatePdfFile(estimate, store, documentObject = globalThis.document, { documentType = "estimate", template = "sanitary_electric" } = {}) {
  await documentObject.fonts.load('16px "Noto Sans Arabic"');
  await documentObject.fonts.ready;
  const building=template==="building_material";
  const width=1280, left=44, right=1236;
  const canvas=documentObject.createElement('canvas');canvas.width=width;
  const ctx=canvas.getContext('2d');
  const measure=(value,size=24)=>{ctx.font=`700 ${size}px "Noto Sans Arabic", sans-serif`;return ctx.measureText(String(value??'')).width;};
  const wrap=(value,max,size=23)=>{const rows=[];let row='';for(const word of String(value??'').split(/\s+/u)){if(row&&measure(`${row} ${word}`,size)>max){rows.push(row);row=word;}else row+=(row?' ':'')+word;}if(row)rows.push(row);return rows.length?rows:[''];};
  const prepared=savedEstimateRows(estimate).map(({line,index})=>({line,number:index+1,label:wrap(line.product_name,building?480:360,24)}));
  const customer=estimate.customer??{};
  const customerAddress=wrap(customer.address??customer.city??customer.location??'',1120,23);
  const notes=wrap(estimate.notes||'Rates subject to confirmation. Thank you for your business.',1120,23);
  const groupCount=prepared.reduce((count,row,index)=>count+(index===0||row.line.category!==prepared[index-1].line.category?1:0),0);
  const rowsHeight=prepared.reduce((sum,row)=>sum+Math.max(58,row.label.length*34+18),0);
  const totalsCount=3+(Number(estimate.discount_total)>0?1:0);
  const height=760+customerAddress.length*34+rowsHeight+groupCount*102+notes.length*34+totalsCount*52;
  canvas.height=height;ctx.fillStyle='#FFFFFF';ctx.fillRect(0,0,width,height);
  const draw=(value,x,y,size=24,color='#000000',align='left',weight=700)=>{ctx.font=`${weight} ${size}px "Noto Sans Arabic", sans-serif`;ctx.fillStyle=color;ctx.textAlign=align;ctx.direction=/[\u0600-\u06ff]/u.test(String(value))?'rtl':'ltr';ctx.fillText(String(value??''),x,y);};
  const num=value=>Number(value??0).toLocaleString('en-PK',{minimumFractionDigits:2,maximumFractionDigits:2});
  const rule=(y,color='#cbd5e1',thickness=2)=>{ctx.strokeStyle=color;ctx.lineWidth=thickness;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();};

  ctx.fillStyle='#0E2E4F';ctx.fillRect(0,0,width,208);
  draw(store.name,44,48,32,'#FFFFFF','left',800);
  draw(store.categories,44,84,23,'#e7f2fb','left',600);
  draw(store.phone,44,124,28,'#FFFFFF','left',800);
  draw(store.address,44,164,22,'#e7f2fb','left',600);

  let y=256;
  draw(documentType==="invoice"?'INVOICE':'QUOTATION',left,y,36,'#0E2E4F','left',800);
  draw(estimate.estimate_number,right,y,30,'#000000','right',800);
  y+=50;
  if(building){ctx.fillStyle='#e0f2fe';ctx.fillRect(left,y-28,300,38);draw('BUILDING MATERIAL',left+15,y,22,'#04588C','left',800);y+=34;}
  draw(`Date: ${estimate.issue_date??''}`,right,y,23,'#0D0E20','right',700);
  const customerBoxTop=y+24;
  const customerDetails=[customer.phone??'',...customerAddress].filter(Boolean);
  const customerBoxHeight=78+customerDetails.length*32;
  ctx.fillStyle='#e0effe';ctx.fillRect(left,customerBoxTop,width-left*2,customerBoxHeight);
  ctx.strokeStyle='#94a3b8';ctx.lineWidth=2;ctx.strokeRect(left,customerBoxTop,width-left*2,customerBoxHeight);
  draw('BILL TO',left+18,customerBoxTop+30,21,'#04588C','left',800);
  draw(customer.name??estimate.customer_name??'Customer name unavailable',left+18,customerBoxTop+64,29,'#000000','left',800);
  customerDetails.forEach((detail,index)=>draw(detail,left+18,customerBoxTop+96+index*32,22,'#0D0E20','left',650));
  draw(`${String(estimate.status??'').toUpperCase()} · ${estimate.lines.length} items`,right-18,customerBoxTop+30,21,'#04588C','right',800);
  y=customerBoxTop+customerBoxHeight+28;

  const columns=building
    ?[{label:'Sr.',x:60,align:'left'},{label:'Item',x:124,align:'left'},{label:'Qty',x:725,align:'right'},{label:'Unit',x:850,align:'right'},{label:'Rate',x:1030,align:'right'},{label:'Amount (PKR)',x:1220,align:'right'}]
    :[{label:'Sr.',x:60,align:'left'},{label:'Item',x:124,align:'left'},{label:'Qty',x:535,align:'right'},{label:'Unit',x:640,align:'right'},{label:'List Rate',x:765,align:'right'},{label:'Disc%',x:875,align:'right'},{label:'Net Rate',x:1035,align:'right'},{label:'Amount (PKR)',x:1220,align:'right'}];
  const tableHeight=52;ctx.fillStyle='#007AB7';ctx.fillRect(left,y,width-left*2,tableHeight);
  columns.forEach(({label,x,align})=>draw(label,align==='right'?x:x,y+34,21,'#FFFFFF',align,800));
  y+=tableHeight;
  let group=null,groupTotal=0;
  const subtotal=()=>{if(group===null)return;const h=42;ctx.fillStyle='#f1f5f9';ctx.fillRect(left,y,width-left*2,h);draw(`${group} subtotal`,left+18,y+29,22,'#0E2E4F','left',800);draw(num(groupTotal),right-16,y+29,23,'#000000','right',800);y+=h;rule(y);};
  prepared.forEach(({line,label,number})=>{
    const category=line.category||'Items';
    if(category!==group){subtotal();group=category;groupTotal=0;ctx.fillStyle='#e8f3fb';ctx.fillRect(left,y,width-left*2,48);draw(category.toUpperCase(),left+16,y+32,24,'#0E2E4F','left',800);y+=48;rule(y);}
    const rowHeight=Math.max(58,label.length*34+18);
    draw(number,60,y+34,23,'#0f172a','left',650);
    label.forEach((part,index)=>draw(part,124,y+31+index*32,24,'#000000','left',750));
    const values=building
      ?[{value:line.quantity,x:725},{value:line.unit,x:850},{value:num(line.unit_price),x:1030},{value:num(line.line_total),x:1220}]
      :[{value:line.quantity,x:535},{value:line.unit,x:640},{value:num(line.list_price),x:765},{value:`${Number(line.discount_percent).toFixed(2)}%`,x:875},{value:num(line.unit_price),x:1035},{value:num(line.line_total),x:1220}];
    values.forEach(({value,x})=>draw(value,x,y+34,22,'#0f172a','right',700));
    groupTotal+=Number(line.line_total)||0;y+=rowHeight;rule(y);
  });
  subtotal();y+=30;
  draw('NOTES',left,y,21,'#04588C','left',800);notes.forEach((note,index)=>draw(note,left,y+34+index*32,22,'#0D0E20','left',650));
  y+=Math.max(58,32+notes.length*32);
  const totalRows=[['Subtotal',estimate.subtotal]];
  if(Number(estimate.discount_total)>0)totalRows.push(['Discount',estimate.discount_total]);
  totalRows.push(['Carriage / Delivery',estimate.pass_through_rent]);
  const grandY=y+totalRows.length*48+10;
  totalRows.forEach(([label,value],index)=>{const rowY=y+index*48;draw(label,790,rowY+30,24,'#000000','left',750);draw(num(value),right-14,rowY+30,24,'#000000','right',750);});
  ctx.fillStyle='#007AB7';ctx.fillRect(770,grandY-8,466,54);
  draw('Grand Total',790,grandY+28,27,'#FFFFFF','left',800);draw(num(estimate.grand_total),right-14,grandY+28,27,'#FFFFFF','right',800);
  const payableY=grandY+74;draw('Customer Payable',790,payableY,24,'#000000','left',800);draw(num(estimate.customer_payable_total??(Number(estimate.grand_total)+Number(estimate.pass_through_rent))),right-14,payableY,24,'#000000','right',800);
  const signatureY=Math.max(payableY+92,height-78);
  rule(signatureY-30,'#94a3b8',2);draw('Authorized signature ____________________',left,signatureY,20,'#0D0E20','left',650);draw(store.phone,right,signatureY+34,20,'#04588C','right',700);
  const jpeg=Uint8Array.from(atob(canvas.toDataURL('image/jpeg',0.94).split(',')[1]),c=>c.charCodeAt(0));
  const encoder=new TextEncoder(),parts=[],offsets=[0];let offset=0;
  const push=value=>{const bytes=typeof value==='string'?encoder.encode(value):value;parts.push(bytes);offset+=bytes.length;};
  const pageWidth=595,pageHeight=height/width*pageWidth;
  const content=`q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /Quote Do Q`;
  push('%PDF-1.4\n');
  const object=(id,body)=>{offsets[id]=offset;push(`${id} 0 obj\n${body}\nendobj\n`);};
  object(1,'<< /Type /Catalog /Pages 2 0 R >>');object(2,'<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(3,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Quote 4 0 R >> >> /Contents 5 0 R >>`);
  offsets[4]=offset;push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);push(jpeg);push('\nendstream\nendobj\n');
  object(5,`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  const xref=offset;push('xref\n0 6\n0000000000 65535 f \n');for(let i=1;i<=5;i++)push(`${String(offsets[i]).padStart(10,'0')} 00000 n \n`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new File(parts,`${String(estimate.estimate_number).replace(/[^A-Za-z0-9_-]/g,'_')}.pdf`,{type:'application/pdf'});
}

function ascii(value, maxLength = 120) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function pdfText(value) {
  return ascii(value).replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function amount(value) {
  const numeric = Number(value);
  return `PKR ${(Number.isFinite(numeric) ? numeric : 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function text(font, size, x, y, value, color = "0.12 0.20 0.29") {
  return `BT ${color} rg /${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${pdfText(value)}) Tj ET`;
}

function line(x1, y1, x2, y2, color = "0.83 0.87 0.91", width = 0.6) {
  return `${color} RG ${width} w ${x1} ${y1} m ${x2} ${y2} l S`;
}

function fill(x, y, width, height, color) {
  return `${color} rg ${x} ${y} ${width} ${height} re f`;
}

function pageContent(draft, rows, pageIndex, pageCount, totals) {
  const commands = [];
  const discountPercent = Number.isFinite(Number(totals.discountPercent)) ? Number(totals.discountPercent) : Number(draft.overallDiscount ?? 0);
  const discountAmount = Number.isFinite(Number(totals.discountAmount)) ? Number(totals.discountAmount) : Number(totals.discount ?? 0);
  const amountAfterDiscount = Number.isFinite(Number(totals.amountAfterDiscount)) ? Number(totals.amountAfterDiscount) : Number(totals.subtotal) - discountAmount;
  commands.push(fill(0, PAGE_HEIGHT - 82, PAGE_WIDTH, 82, "0.09 0.23 0.36"));
  commands.push(fill(42, PAGE_HEIGHT - 65, 38, 38, "0.96 0.72 0.25"));
  commands.push(text("F2", 19, 54, PAGE_HEIGHT - 52, "M", "0.09 0.16 0.23"));
  commands.push(text("F2", 15, 94, PAGE_HEIGHT - 39, "MURAD BUILDING MATERIALS STORE", "1 1 1"));
  commands.push(text("F1", 7.5, 94, PAGE_HEIGHT - 54, "Cement, Bricks, Sand, Electric, Sanitary, All Other Building Materials", "0.83 0.89 0.94"));
  commands.push(text("F1", 8.5, 94, PAGE_HEIGHT - 68, "0308 6235608  |  Al Kabir Town, Raiwind Road, Lahore.", "0.83 0.89 0.94"));

  let tableTop = PAGE_HEIGHT - 173;
  if (pageIndex === 0) {
    commands.push(text("F2", 24, 42, PAGE_HEIGHT - 119, "ESTIMATE", "0.09 0.23 0.36"));
    commands.push(text("F2", 9, 410, PAGE_HEIGHT - 108, "Estimate No.", "0.40 0.47 0.55"));
    commands.push(text("F1", 10, 410, PAGE_HEIGHT - 123, draft.estimateNumber));
    commands.push(text("F2", 9, 410, PAGE_HEIGHT - 140, "Date", "0.40 0.47 0.55"));
    commands.push(text("F1", 10, 410, PAGE_HEIGHT - 155, draft.issueDate));
    commands.push(text("F2", 8, 42, PAGE_HEIGHT - 143, "ESTIMATE FOR", "0.40 0.47 0.55"));
    commands.push(text("F2", 11, 42, PAGE_HEIGHT - 158, draft.customerName));
    commands.push(text("F1", 8.5, 42, PAGE_HEIGHT - 172, `${draft.phone}  |  ${draft.address}`));
    commands.push(text("F2", 8, 42, PAGE_HEIGHT - 194, "RATE LIST / COMPANY", "0.40 0.47 0.55"));
    commands.push(text("F1", 9.5, 42, PAGE_HEIGHT - 209, draft.rateListName || "Store Standard Rates"));
    tableTop = PAGE_HEIGHT - 235;
  } else {
    commands.push(text("F2", 11, 42, PAGE_HEIGHT - 108, `Estimate ${draft.estimateNumber} - continued`));
    tableTop = PAGE_HEIGHT - 132;
  }

  commands.push(fill(42, tableTop - 21, PAGE_WIDTH - 84, 21, "0.09 0.23 0.36"));
  const headingY = tableTop - 14;
  for (const [x, label] of [[49, "#"], [69, "ITEM"], [365, "QUANTITY"], [435, "RATE"], [505, "TOTAL"]]) commands.push(text("F2", 7.5, x, headingY, label, "1 1 1"));

  let y = tableTop - 39;
  for (const row of rows) {
    commands.push(text("F1", 8.5, 49, y, row.number));
    commands.push(text("F2", 8.5, 69, y, ascii(row.line.productLabel, 45)));
    commands.push(text("F1", 8.5, 365, y, Number(row.line.quantity).toLocaleString("en-US")));
    commands.push(text("F1", 8.5, 435, y, amount(row.line.rate).replace("PKR ", "")));
    commands.push(text("F2", 8.5, 505, y, amount(Number(row.line.quantity) * Number(row.line.rate)).replace("PKR ", "")));
    commands.push(line(42, y - 10, PAGE_WIDTH - 42, y - 10));
    y -= 25;
  }

  if (pageIndex === pageCount - 1) {
    y -= 12;
    commands.push(text("F2", 8, 42, y, "NOTES", "0.40 0.47 0.55"));
    commands.push(text("F1", 8.5, 42, y - 15, ascii(draft.notes || "Thank you for choosing Murad Building Materials Store.", 72)));
    const totalsX = 382;
    commands.push(text("F1", 9, totalsX, y, "Subtotal"));
    commands.push(text("F2", 9, 482, y, amount(totals.subtotal)));
    commands.push(text("F1", 9, totalsX, y - 20, `Discount (${discountPercent.toLocaleString("en-US", { maximumFractionDigits: 2 })}%)`));
    commands.push(text("F2", 9, 482, y - 20, `- ${amount(discountAmount)}`));
    commands.push(text("F1", 9, totalsX, y - 40, "Amount After Discount"));
    commands.push(text("F2", 9, 482, y - 40, amount(amountAfterDiscount)));
    commands.push(text("F1", 9, totalsX, y - 60, "Carriage / Delivery"));
    commands.push(text("F2", 9, 482, y - 60, amount(totals.carriageDelivery)));
    commands.push(fill(totalsX - 8, y - 96, 171, 25, "0.09 0.23 0.36"));
    commands.push(text("F2", 10, totalsX, y - 88, "GRAND TOTAL", "1 1 1"));
    commands.push(text("F2", 10, 482, y - 88, amount(totals.grandTotal), "1 1 1"));
  }

  commands.push(text("F1", 7, 42, 24, "Rates subject to confirmation. Prepared in PKR.", "0.45 0.51 0.58"));
  commands.push(text("F1", 7, 520, 24, `${pageIndex + 1} / ${pageCount}`, "0.45 0.51 0.58"));
  return commands.join("\n");
}

function buildPdf(contents) {
  const objects = [null, null, null, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"];
  const pageIds = [];
  for (const content of contents) {
    const contentId = objects.length;
    objects.push(`<< /Length ${new TextEncoder().encode(content).length} >>\nstream\n${content}\nendstream`);
    const pageId = objects.length;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = new TextEncoder().encode(pdf).length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = new TextEncoder().encode(pdf).length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

export function createEstimatePdfFile(draft, totals) {
  const rows = draft.lines.map((line, index) => ({ line, number: index + 1 }));
  const chunks = [];
  for (let index = 0; index < rows.length; index += 16) chunks.push(rows.slice(index, index + 16));
  if (!chunks.length) chunks.push([]);
  const pages = chunks.map((chunk, index) => pageContent(draft, chunk, index, chunks.length, totals));
  const bytes = buildPdf(pages);
  const filename = `${ascii(draft.estimateNumber, 60).replace(/[^A-Za-z0-9._-]+/g, "-") || "Estimate"}.pdf`;
  if (typeof File === "function") return new File([bytes], filename, { type: "application/pdf" });
  const blob = new Blob([bytes], { type: "application/pdf" });
  Object.defineProperty(blob, "name", { value: filename });
  return blob;
}

export function downloadEstimatePdf(file, documentObject = globalThis.document, urlObject = globalThis.URL) {
  const url = urlObject.createObjectURL(file);
  const link = documentObject.createElement("a");
  link.href = url;
  link.download = file.name;
  link.hidden = true;
  documentObject.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => urlObject.revokeObjectURL(url), 1_000);
}

export async function shareEstimatePdf({ file, title, text: shareText, navigatorObject = globalThis.navigator, download = downloadEstimatePdf, openUrl = (url) => globalThis.location.assign(url) }) {
  const filePayload = { files: [file], title, text: shareText };
  if (typeof navigatorObject?.share === "function" && typeof navigatorObject?.canShare === "function" && navigatorObject.canShare({ files: [file] })) {
    await navigatorObject.share(filePayload);
    return "PDF_SHARED";
  }

  download(file);
  if (typeof navigatorObject?.share === "function") {
    await navigatorObject.share({ title, text: `${shareText}\nThe PDF has been downloaded so you can attach it in WhatsApp.` });
    return "PDF_DOWNLOADED_SHARE_OPENED";
  }

  const url = new URL("https://wa.me/");
  url.searchParams.set("text", `${shareText}\nThe Estimate PDF has been downloaded. Please attach it before sending.`);
  openUrl(url.toString());
  return "PDF_DOWNLOADED_WHATSAPP_OPENED";
}
