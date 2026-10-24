const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
export function savedEstimateRows(estimate){
  const rows=estimate.lines.map((line,index)=>({line,index}));
  return [...new Set(rows.map(({line})=>line.category||'Items'))].flatMap(category=>rows.filter(({line})=>(line.category||'Items')===category));
}

// Browser canvas shapes Urdu using the same bundled font as Customer Preview.
// A continuous custom-size PDF page keeps every quotation row together.
export async function createSavedEstimatePdfFile(estimate, store, documentObject = globalThis.document) {
  await documentObject.fonts.load('16px "Noto Sans Arabic"');
  await documentObject.fonts.ready;
  const width=1280, columns=[38,88,658,732,810,940,1022,1145];
  const canvas=documentObject.createElement('canvas');canvas.width=width;
  const scratch=canvas.getContext('2d');scratch.font='18px "Noto Sans Arabic", sans-serif';
  const wrap=(value,max)=>{const rows=[];let row='';for(const word of String(value??'').split(/\s+/u)){if(row&&scratch.measureText(row+' '+word).width>max){rows.push(row);row=word;}else row+=(row?' ':'')+word;}if(row)rows.push(row);return rows.length?rows:[''];};
  const prepared=savedEstimateRows(estimate).map(({line,index})=>({line,number:index+1,label:wrap(line.product_name,540)}));
  const notes=wrap(estimate.notes||'Rates subject to confirmation. Thank you for your business.',640);
  const address=wrap(estimate.customer?.city||'',1100);
  let group=null,groups=0;for(const {line} of prepared)if(line.category!==group){group=line.category;groups++;}
  const height=440+address.length*26+prepared.reduce((sum,row)=>sum+Math.max(38,row.label.length*28+12),0)+groups*68+Math.max(220,notes.length*28+80);
  canvas.height=height;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);
  const draw=(value,x,y,size=18,color='#17352b',align='left')=>{ctx.font=`${size>=23?'bold ':''}${size}px "Noto Sans Arabic", sans-serif`;ctx.fillStyle=color;ctx.textAlign=align;ctx.direction=/[\u0600-\u06ff]/u.test(String(value))?'rtl':'ltr';ctx.fillText(String(value??''),x,y);};
  const num=value=>Number(value??0).toLocaleString('en-PK',{minimumFractionDigits:2,maximumFractionDigits:2});
  ctx.fillStyle='#173d32';ctx.fillRect(0,0,width,192);
  draw(store.name,40,48,30,'#fff');draw(store.categories,40,83,19,'#e4eee8');draw(store.phone,40,118,22,'#fff');draw(store.address,40,154,17,'#e4eee8');
  draw('QUOTATION',40,238,26);draw(estimate.estimate_number,1240,238,25,'#17352b','right');
  draw(estimate.customer?.name,40,282,25);draw(estimate.issue_date,1240,282,18,'#17352b','right');
  address.forEach((row,index)=>draw(row,40,316+index*26));let y=342+address.length*26;
  draw(estimate.customer?.phone,40,y);draw(`${estimate.status} · ${estimate.lines.length} items`,1240,y,18,'#17352b','right');y+=34;
  ctx.fillStyle='#173d32';ctx.fillRect(30,y,width-60,38);
  ['Sr.','Item','Qty','Unit','List Rate','Disc%','Net Rate','Amount'].forEach((label,i)=>draw(label,columns[i],y+26,16,'#fff'));y+=54;
  group=null;let total=0;
  const subtotal=()=>{if(group===null)return;ctx.fillStyle='#f0f5f2';ctx.fillRect(30,y-19,width-60,30);draw(`${group} subtotal`,45,y+2,17);draw(num(total),1240,y+2,18,'#17352b','right');y+=34;};
  prepared.forEach(({line,label,number})=>{if(line.category!==group){subtotal();group=line.category||'Items';total=0;draw(group,40,y+5,21);y+=34;}
    draw(number,columns[0],y+4,16);label.forEach((row,j)=>draw(row,columns[1],y+4+j*28,18));
    [line.quantity,line.unit,num(line.list_price),`${Number(line.discount_percent).toFixed(2)}%`,num(line.unit_price),num(line.line_total)].forEach((value,i)=>draw(value,columns[i+2],y+4,15));
    total+=Number(line.line_total);y+=Math.max(38,label.length*28+12);ctx.strokeStyle='#dce5df';ctx.beginPath();ctx.moveTo(30,y-17);ctx.lineTo(width-30,y-17);ctx.stroke();});subtotal();y+=20;
  draw('NOTES',40,y,19);notes.forEach((row,i)=>draw(row,40,y+34+i*28,17));
  [['Subtotal',estimate.subtotal],['Discount',estimate.discount_total],['Grand Total',estimate.grand_total],['Carriage / Delivery',estimate.pass_through_rent],['Customer Payable',estimate.customer_payable_total]].forEach(([label,value],i)=>{if(i===2){ctx.fillStyle='#173d32';ctx.fillRect(800,y+i*36-21,450,34);}draw(label,812,y+i*36,17,i===2?'#fff':'#17352b');draw(num(value),1240,y+i*36,18,i===2?'#fff':'#17352b','right');});
  draw('Authorized signature ____________________',40,height-60,17);draw(store.phone,1240,height-30,16,'#17352b','right');
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
