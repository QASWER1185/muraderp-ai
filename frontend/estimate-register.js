import { listEstimates, getEstimate, updateEstimate } from './estimate-api.js';
import { mountEstimates } from './estimates.js';
import { downloadEstimatePdf, createSavedEstimatePdfFile } from './estimate-pdf.js';
import { getWorkspaceContext } from './workspace-context.js';
import { icon } from './icons.js';
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const amount=value=>Number(value??0).toLocaleString('en-PK',{minimumFractionDigits:2,maximumFractionDigits:2});
export const estimateStatusBadge=status=>`<span class="estimate-status status-${esc(status.toLowerCase())}">${esc(status)}</span>`;
export const STORE_HEADER={name:'M. MURAD BUILDING MATERIAL STORE',categories:'Electric | Sanitary | Building Material | Hardware',phone:'0308-6235608',address:'Plaza No 4, Al Kabir Town, E Commercial, Kot Araian, Raiwind Road, Lahore'};
export async function printSavedEstimate(estimate){
  const frame=document.createElement('iframe');frame.title='Quotation print preview';frame.className='estimate-print-frame';
  const loaded=new Promise(resolve=>{frame.onload=resolve;});
  frame.srcdoc=`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${globalThis.location.origin}/styles.css"><style>html,body{margin:0;padding:0;background:white}body{width:194mm}.saved-estimate-document{margin:0!important;padding:5mm!important;box-shadow:none!important;border:0!important} @media print{body{width:194mm}.saved-estimate-document{display:block!important;position:static!important;width:194mm!important}thead{display:table-header-group}tr{break-inside:avoid}table{break-inside:auto}}</style></head><body>${savedEstimatePreviewMarkup(estimate)}</body></html>`;
  document.body.append(frame);await loaded;await frame.contentDocument.fonts.ready;
  const height=Math.max(297,Math.ceil(frame.contentDocument.body.scrollHeight*25.4/96)+20);
  const style=frame.contentDocument.createElement('style');style.textContent=`@page{size:210mm ${height}mm;margin:8mm} @media print{html,body{height:auto!important;overflow:visible!important}}`;frame.contentDocument.head.append(style);
  frame.contentWindow.addEventListener('afterprint',()=>frame.remove(),{once:true});frame.contentWindow.focus();frame.contentWindow.print();
}
export function savedEstimatePreviewMarkup(estimate){
  let group=null,groupTotal=0;
  const groupFooter=()=>group==null?'':`<tr class="estimate-category-total"><td colspan="7">${esc(group)} subtotal</td><td>${amount(groupTotal)}</td></tr>`;
  let rows='';
  for(const [index,line] of estimate.lines.entries()){
    const category=line.category||'Items';
    if(category!==group){rows+=groupFooter();group=category;groupTotal=0;rows+=`<tr class="estimate-category"><th colspan="8">${esc(category)}</th></tr>`;}
    groupTotal+=Number(line.line_total);
    rows+=`<tr><td>${index+1}</td><td dir="auto">${esc(line.product_name)}</td><td>${esc(line.quantity)}</td><td>${esc(line.unit)}</td><td>${amount(line.list_price)}</td><td>${Number(line.discount_percent).toLocaleString('en-PK',{maximumFractionDigits:2})}%</td><td>${amount(line.unit_price)}</td><td>${amount(line.line_total)}</td></tr>`;
  }
  rows+=groupFooter();
  return `<article class="estimate-document saved-estimate-document" id="saved-estimate-print"><header class="saved-estimate-header"><div class="estimate-logo">M</div><div><h2>${STORE_HEADER.name}</h2><p>${STORE_HEADER.categories}</p><p>${STORE_HEADER.phone}</p><p>${STORE_HEADER.address}</p></div><aside><strong>QUOTATION</strong><b>${esc(estimate.estimate_number)}</b><span>${esc(estimate.issue_date)}</span></aside></header><section class="estimate-document-customer"><div><small>CUSTOMER</small><strong dir="auto">${esc(estimate.customer?.name)}</strong><span dir="auto">${esc(estimate.customer?.city)}</span><span>${esc(estimate.customer?.phone)}</span></div><div><small>STATUS</small>${estimateStatusBadge(estimate.status)}<span>${estimate.lines.length} items · PKR</span></div></section><table><thead><tr><th>Sr.</th><th>Item</th><th>Qty</th><th>Unit</th><th>List Rate</th><th>Disc%</th><th>Net Rate</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table><footer><div><small>NOTES</small><p dir="auto">${esc(estimate.notes||'Rates subject to confirmation. Thank you for your business.')}</p><small>Authorized signature ____________________</small></div><dl><div><dt>Subtotal</dt><dd>${amount(estimate.subtotal)}</dd></div><div><dt>Discount</dt><dd>${amount(estimate.discount_total)}</dd></div><div class="grand-total"><dt>Grand Total</dt><dd>PKR ${amount(estimate.grand_total)}</dd></div><div><dt>Carriage / Delivery</dt><dd>${amount(estimate.pass_through_rent)}</dd></div><div><dt>Customer Payable</dt><dd>PKR ${amount(estimate.customer_payable_total)}</dd></div></dl></footer><p class="estimate-print-footer">${STORE_HEADER.name} · ${STORE_HEADER.phone}</p></article>`;
}
export function estimateListMarkup(records){return records.length?`<div class="estimate-table-scroll"><table class="estimate-register-table"><thead><tr><th>Estimate No.</th><th>Date</th><th>Customer</th><th>Items</th><th>Total (PKR)</th><th>Status</th><th>Actions</th></tr></thead><tbody>${records.map(row=>`<tr><td><button class="text-button" type="button" data-estimate-open="${row.id}">${esc(row.estimate_number)}</button></td><td>${esc(row.issue_date)}</td><td dir="auto">${esc(row.customer_name)}</td><td>${row.item_count}</td><td>${amount(row.grand_total)}</td><td>${estimateStatusBadge(row.status)}</td><td><button class="button secondary compact" type="button" data-estimate-open="${row.id}">Preview</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty-state"><h2>No matching estimates</h2><p>Change the filters or create an estimate.</p></div>';}

export function mountEstimateWorkspace(container,options={}){
  const route=options.route??'estimates', context=options.context??getWorkspaceContext();
  const creating=route==='estimates/create';
  container.innerHTML=`<nav class="estimate-tabs" aria-label="Estimates"><button type="button" class="button ${creating?'secondary':'primary'}" data-navigate="estimates/list">Estimates List</button><button type="button" class="button ${creating?'primary':'secondary'}" data-navigate="estimates/create">Create Estimate</button></nav><div data-estimate-workspace></div>`;
  const root=container.querySelector('[data-estimate-workspace]');
  if(creating){mountEstimates(root);return;}
  root.innerHTML=`<section class="page-heading"><div><p class="eyebrow">Sales</p><h1>Estimates</h1><p>Saved quotations for your active business and branch.</p></div><button class="button primary" data-navigate="estimates/create">+ Create Estimate</button></section><section class="surface"><form class="estimate-filters"><label>Search<input name="search" type="search" placeholder="Estimate no. or customer"></label><label>Status<select name="status"><option value="">All statuses</option>${['DRAFT','READY','INVOICED','CANCELLED'].map(s=>`<option>${s}</option>`).join('')}</select></label><label>From<input name="from" type="date"></label><label>To<input name="to" type="date"></label><button class="button secondary" type="submit">Search</button></form><div data-estimate-results aria-live="polite"></div><button class="button secondary" data-estimate-more hidden>Load more</button></section><dialog class="side-dialog estimate-detail-dialog" data-estimate-dialog><div data-estimate-detail></div></dialog>`;
  const form=root.querySelector('form'), results=root.querySelector('[data-estimate-results]'), more=root.querySelector('[data-estimate-more]'), dialog=root.querySelector('dialog'),detail=root.querySelector('[data-estimate-detail]');
  let records=[],cursor=null,selected=null,loadVersion=0;
  const filters=()=>Object.fromEntries(new FormData(form));
  async function load(append=false){
    if(!context){results.innerHTML='<div class="empty-state">Sign in and select your workspace to load estimates.</div>';return;}
    const version=++loadVersion;results.setAttribute('aria-busy','true');
    try{const page=await (options.listEstimates??listEstimates)(context,{...filters(),...(append?{cursor}:{}),limit:50});if(version!==loadVersion)return;records=append?[...records,...page.data]:page.data;cursor=page.next_cursor;results.innerHTML=estimateListMarkup(records);more.hidden=!cursor;}
    catch(error){results.textContent=error.message;}finally{if(version===loadVersion)results.removeAttribute('aria-busy');}
  }
  function renderDetail(){
    detail.innerHTML=`<div class="side-dialog-head"><div><p class="eyebrow">CUSTOMER PREVIEW</p><h2>${esc(selected.estimate_number)}</h2></div><button type="button" class="icon-button" data-estimate-close aria-label="Close">${icon('close')}</button></div><div class="estimate-toolbar"><button class="button secondary" data-estimate-print>Print</button><button class="button secondary" data-estimate-pdf>Download PDF</button><button class="button secondary" data-estimate-whatsapp>WhatsApp Share</button>${selected.status==='DRAFT'?'<button class="button primary" data-estimate-ready>Mark as READY</button><button class="button secondary" data-estimate-edit>Edit</button>':''}${selected.status==='READY'?`<button class="button primary" data-estimate-invoice>Convert to Invoice</button>`:''}${['DRAFT','READY'].includes(selected.status)?'<button class="button secondary" data-estimate-cancel>Cancel estimate</button>':''}</div><p data-estimate-feedback role="status"></p><div class="estimate-preview-scroll">${savedEstimatePreviewMarkup(selected)}</div>`;
  }
  async function open(reference){
    if(!context)return;
    detail.innerHTML='<p>Loading saved estimate…</p>';if(!dialog.open)dialog.showModal();
    try{selected=(await (options.getEstimate??getEstimate)(context,reference)).data;renderDetail();}
    catch(error){detail.innerHTML=`<button class="button secondary" data-estimate-close>Close</button><p role="alert">${esc(error.message)}</p>`;}
  }
  async function change(changes){selected=(await (options.updateEstimate??updateEstimate)(context,selected.id,{expected_updated_at:selected.updated_at,...changes})).data;renderDetail();await load();}
  function edit(){
    detail.querySelector('.estimate-preview-scroll').innerHTML=`<form data-estimate-edit-form><label>Customer<input name="customer_id" type="number" min="1" value="${selected.customer_id}" required></label><label>Date<input name="issue_date" type="date" value="${selected.issue_date}" required></label><label>Notes<textarea name="notes" maxlength="2000">${esc(selected.notes)}</textarea></label><div class="estimate-table-scroll"><table><thead><tr><th>Item</th><th>Quantity</th><th>Saved rate</th><th>Discount amount</th></tr></thead><tbody>${selected.lines.map((line,index)=>`<tr data-edit-line="${index}"><td dir="auto">${esc(line.product_name)}</td><td><input name="quantity" type="number" step="any" min="0.000001" value="${line.quantity}" required></td><td><input name="unit_price" type="number" step="any" min="0" value="${line.stored_unit_price}" required></td><td><input name="discount_amount" type="number" step="any" min="0" value="${line.discount_amount}" required></td></tr>`).join('')}</tbody></table></div><button type="submit" class="button primary">Save changes</button><button type="button" class="button secondary" data-estimate-edit-discard>Discard</button></form>`;
  }
  form.addEventListener('submit',event=>{event.preventDefault();void load();});more.addEventListener('click',()=>void load(true));
  root.addEventListener('click',async event=>{
    const target=event.target.closest('button');if(!target)return;
    if(target.hasAttribute('data-estimate-open')){void open(target.dataset.estimateOpen);return;}
    if(target.hasAttribute('data-estimate-close')){dialog.close();return;}
    if(!selected)return;
    try{
      target.disabled=true;
      if(target.hasAttribute('data-estimate-ready'))await change({status:'READY'});
      if(target.hasAttribute('data-estimate-cancel')&&globalThis.confirm('Cancel this estimate? Its saved lines will remain available.'))await change({status:'CANCELLED'});
      if(target.hasAttribute('data-estimate-invoice')){dialog.close();globalThis.location.hash=`#/invoices/from-estimate/${selected.id}`;}
      if(target.hasAttribute('data-estimate-edit'))edit();
      if(target.hasAttribute('data-estimate-edit-discard'))renderDetail();
      if(target.hasAttribute('data-estimate-print'))await printSavedEstimate(selected);
      if(target.hasAttribute('data-estimate-pdf'))downloadEstimatePdf(await createSavedEstimatePdfFile(selected,STORE_HEADER));
      if(target.hasAttribute('data-estimate-whatsapp')){
        const file=await createSavedEstimatePdfFile(selected,STORE_HEADER),text=`${selected.estimate_number} · ${selected.customer_name} · PKR ${amount(selected.grand_total)}`;
        if(globalThis.navigator.canShare?.({files:[file]}))await globalThis.navigator.share({files:[file],title:selected.estimate_number,text});
        else{downloadEstimatePdf(file);const phone=String(selected.customer?.phone??'').replace(/\D/g,'').replace(/^0/,'92');globalThis.open(`https://wa.me/${phone}?text=${encodeURIComponent(text+' — quotation PDF attached separately')}`,'_blank','noopener,noreferrer');}
      }
    }catch(error){detail.querySelector('[data-estimate-feedback]').textContent=error.message;}finally{target.disabled=false;}
  });
  detail.addEventListener('submit',async event=>{
    if(!event.target.matches('[data-estimate-edit-form]'))return;event.preventDefault();
    const editor=event.target,values=new FormData(editor),button=editor.querySelector('[type=submit]');button.disabled=true;
    try{const lines=[...editor.querySelectorAll('[data-edit-line]')].map(row=>{const old=selected.lines[Number(row.dataset.editLine)];return {product_id:old.product_id,unit:old.unit,description:old.description,...Object.fromEntries(['quantity','unit_price','discount_amount'].map(name=>[name,Number(row.querySelector(`[name="${name}"]`).value)]))};});await change({customer_id:Number(values.get('customer_id')),issue_date:values.get('issue_date'),notes:values.get('notes')||null,lines});}
    catch(error){detail.querySelector('[data-estimate-feedback]').textContent=error.message;}finally{button.disabled=false;}
  });
  void load();const reference=route.split('/')[1];if(reference&&reference!=='list')void open(decodeURIComponent(reference));
}
