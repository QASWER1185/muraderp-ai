import { listEstimates, getEstimate, updateEstimate } from './estimate-api.js';
import { mountEstimates } from './estimates.js';
import { mountSavedEstimateEditor } from './estimate-editor.js';
import { listCustomers } from './customer-api.js';
import { listProducts } from './product-api.js';
import { downloadEstimatePdf, createSavedEstimatePdfFile, savedEstimateRows } from './estimate-pdf.js';
import { getWorkspaceContext } from './workspace-context.js';
import { documentTemplateOptions, mobileDocumentPreview, normalizeDocumentTemplate } from './document-templates.js';
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
  const template=normalizeDocumentTemplate(estimate.document_template);
  const building=template==='building_material';
  const columnCount=building?6:8;
  let group=null,groupTotal=0;
  const groupFooter=()=>group==null?'':`<tr class="estimate-category-total"><td colspan="${columnCount-1}">${esc(group)} subtotal</td><td>${amount(groupTotal)}</td></tr>`;
  let rows='';
  for(const {index,line} of savedEstimateRows(estimate)){
    const category=line.category||'Items';
    if(category!==group){rows+=groupFooter();group=category;groupTotal=0;rows+=`<tr class="estimate-category"><th colspan="${columnCount}">${esc(category)}</th></tr>`;}
    groupTotal+=Number(line.line_total);
    rows+=building
      ?`<tr><td>${index+1}</td><td dir="auto">${esc(line.product_name)}</td><td>${esc(line.quantity)}</td><td>${esc(line.unit)}</td><td>${line.is_pending?'ریٹ مطلوب':amount(line.unit_price)}</td><td>${line.is_pending?'ریٹ مطلوب':amount(line.line_total)}</td></tr>`
      :`<tr><td>${index+1}</td><td dir="auto">${esc(line.product_name)}</td><td>${esc(line.quantity)}</td><td>${esc(line.unit)}</td><td>${amount(line.list_price)}</td><td>${Number(line.discount_percent).toLocaleString('en-PK',{maximumFractionDigits:2})}%</td><td>${line.is_pending?'ریٹ مطلوب':amount(line.unit_price)}</td><td>${line.is_pending?'ریٹ مطلوب':amount(line.line_total)}</td></tr>`;
  }
  rows+=groupFooter();
  const headers=building?['Sr.','Item','Qty','Unit','Rate','Amount']:['Sr.','Item','Qty','Unit','List Rate','Disc%','Net Rate','Amount'];
  const desktop=`<article class="estimate-document saved-estimate-document estimate-desktop-document ${building?'building-material':'sanitary-electric'}" id="saved-estimate-print"><header class="saved-estimate-header"><div class="estimate-logo">M</div><div><h2>${STORE_HEADER.name}</h2><p>${STORE_HEADER.categories}</p><p>${STORE_HEADER.phone}</p><p>${STORE_HEADER.address}</p></div><aside><strong>QUOTATION</strong>${building?'<em class="desktop-template-badge">BUILDING MATERIAL</em>':''}<b>${esc(estimate.estimate_number)}</b><span>${esc(estimate.issue_date)}</span></aside></header><section class="estimate-document-customer"><div><small>CUSTOMER</small><strong dir="auto">${esc(estimate.customer?.name)}</strong><span dir="auto">${esc(estimate.customer?.city)}</span><span>${esc(estimate.customer?.phone)}</span></div><div><small>STATUS</small>${estimateStatusBadge(estimate.status)}<span>${estimate.lines.length} items · PKR</span></div></section><div class="saved-estimate-lines"><table><thead><tr>${headers.map((label)=>`<th>${label}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div><footer><div><small>NOTES</small><p dir="auto">${esc(estimate.notes||'Rates subject to confirmation. Thank you for your business.')}</p><small>Authorized signature ____________________</small></div><dl><div><dt>Subtotal</dt><dd>${amount(estimate.subtotal)}</dd></div>${Number(estimate.discount_total)>0?`<div><dt>Discount</dt><dd>${amount(estimate.discount_total)}</dd></div>`:''}<div><dt>Carriage / Delivery</dt><dd>${amount(estimate.pass_through_rent)}</dd></div><div class="grand-total"><dt>Grand Total</dt><dd>PKR ${amount(estimate.grand_total)}</dd></div><div><dt>Customer Payable</dt><dd>PKR ${amount(estimate.customer_payable_total)}</dd></div></dl></footer><p class="estimate-print-footer">${STORE_HEADER.name} · ${STORE_HEADER.phone}</p></article>`;
  const mobile=mobileDocumentPreview({documentType:'estimate',template,documentNumber:estimate.estimate_number,issueDate:estimate.issue_date,status:estimate.status,customer:estimate.customer??{name:estimate.customer_name},lines:estimate.lines,totals:estimate,notes:estimate.notes});
  return desktop+mobile;
}
export function estimateListMarkup(records){return records.length?`<div class="estimate-table-scroll"><table class="estimate-register-table"><thead><tr><th>Estimate No.</th><th>Date</th><th>Customer</th><th>Items</th><th>Total (PKR)</th><th>Status</th><th>Actions</th></tr></thead><tbody>${records.map(row=>`<tr><td><button class="text-button" type="button" data-estimate-open="${row.id}">${esc(row.estimate_number)}</button></td><td>${esc(row.issue_date)}</td><td dir="auto">${esc(row.customer_name)}</td><td>${row.item_count}</td><td>${amount(row.grand_total)}</td><td>${estimateStatusBadge(row.status)}</td><td><button class="button secondary compact" type="button" data-estimate-open="${row.id}">Preview</button>${['DRAFT','READY'].includes(row.status)?`<button class="button secondary compact" type="button" data-estimate-open-edit="${row.id}">Edit</button>`:''}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty-state"><h2>No matching estimates</h2><p>Change the filters or create an estimate.</p></div>';}

export function mountEstimateWorkspace(container,options={}){
  const route=options.route??'estimates', context=options.context??getWorkspaceContext();
  const creating=route.startsWith('estimates/create');
  container.innerHTML=`<nav class="estimate-tabs" aria-label="Estimates"><button type="button" class="button ${creating?'secondary':'primary'}" data-navigate="estimates/list">Estimates List</button><button type="button" class="button ${creating?'primary':'secondary'}" data-navigate="estimates/create">Create Estimate</button></nav><div data-estimate-workspace></div>`;
  const root=container.querySelector('[data-estimate-workspace]');
  if(creating){const parts=route.split('/');const customerId=parts[2]==='customer'?Number(parts[3]):null;mountEstimates(root,{initialCustomerId:Number.isSafeInteger(customerId)&&customerId>0?customerId:null});return;}
  root.innerHTML=`<section class="page-heading"><div><p class="eyebrow">Sales</p><h1>Estimates</h1><p>Saved quotations for your active business and branch.</p></div><button class="button primary" data-navigate="estimates/create"><span class="estimate-cta-desktop">+ Create Estimate</span><span class="estimate-cta-mobile">+ New Estimate</span></button></section><section class="surface"><form class="estimate-filters"><label>Search<input name="search" type="search" placeholder="Estimate no. or customer"></label><label>Status<select name="status"><option value="">All statuses</option>${['DRAFT','READY','INVOICED','CANCELLED'].map(s=>`<option>${s}</option>`).join('')}</select></label><label>From<input name="from" type="date"></label><label>To<input name="to" type="date"></label><button class="button secondary" type="submit">Search</button></form><div class="estimate-status-filters" role="group" aria-label="Filter estimates by status">${[['','All'],...['DRAFT','READY','INVOICED','CANCELLED'].map(s=>[s,s])].map(([value,label],index)=>`<button type="button" class="${index===0?'active':''}" data-estimate-status-filter="${value}">${label}</button>`).join('')}</div><div data-estimate-results aria-live="polite"></div><button class="button secondary" data-estimate-more hidden>Load more</button></section><dialog class="side-dialog estimate-detail-dialog" data-estimate-dialog><div data-estimate-detail></div></dialog>`;
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
    detail.classList.remove('is-editing');
    detail.innerHTML=`<div class="side-dialog-head"><div><p class="eyebrow">CUSTOMER PREVIEW</p><h2>${esc(selected.estimate_number)}</h2></div><button type="button" class="icon-button" data-estimate-close aria-label="Close">${icon('close')}</button></div><div class="estimate-toolbar"><button class="button secondary" data-estimate-print>Print</button><button class="button secondary" data-estimate-pdf>↓ Download PDF</button><button class="button secondary" data-estimate-whatsapp>WhatsApp Share</button>${selected.status==='DRAFT'?'<button class="button primary" data-estimate-ready>Mark as READY</button>':''}${selected.status==='READY'?`<button class="button primary" data-estimate-invoice>Convert to Invoice</button>`:''}${['DRAFT','READY'].includes(selected.status)?'<button class="button secondary" data-estimate-edit>Edit</button><button class="button secondary" data-estimate-cancel>Cancel</button>':''}</div><p data-estimate-feedback role="status"></p><div class="estimate-preview-scroll">${savedEstimatePreviewMarkup(selected)}</div>`;
  }
  async function open(reference,editing=false){
    if(!context)return;
    detail.innerHTML='<p>Loading saved estimate…</p>';if(!dialog.open)dialog.showModal();
    try{selected=(await (options.getEstimate??getEstimate)(context,reference)).data;renderDetail();if(editing)await edit();}
    catch(error){detail.innerHTML=`<button class="button secondary" data-estimate-close>Close</button><p role="alert">${esc(error.message)}</p>`;}
  }
  async function change(changes){selected=(await (options.updateEstimate??updateEstimate)(context,selected.id,{expected_updated_at:selected.updated_at,...changes})).data;renderDetail();await load();}
  async function edit(){
    if(!['DRAFT','READY'].includes(selected.status))return;
    const snapshot=selected;
    detail.classList.add('is-editing');
    detail.querySelector('.estimate-preview-scroll').innerHTML='<p>Loading customer and product selectors…</p>';
    try{
      const loadCustomers=async()=>{let all=[],cursor;const seen=new Set();do{const page=await (options.listCustomers??listCustomers)(context,{limit:100,...(cursor?{cursor}:{})});all.push(...page.data);cursor=page.next_cursor;if(cursor&&seen.has(cursor))throw new Error('Customer pagination did not advance');seen.add(cursor);}while(cursor);return all;};
      const [customers,productPage]=await Promise.all([loadCustomers(),(options.listProducts??listProducts)(context,{limit:100})]);
      if(selected!==snapshot||!dialog.open)return;
      const products=[...productPage.data,...snapshot.lines.map(line=>({id:line.product_id,name:line.product_name,unit:line.unit}))];
      mountSavedEstimateEditor(detail.querySelector('.estimate-preview-scroll'),snapshot,{customers,products,searchProducts:async search=>(await (options.listProducts??listProducts)(context,{search,limit:100})).data,onSave:async changes=>{if(selected!==snapshot)throw new Error('The estimate changed; reopen the editor.');await change(changes);},onCancel:renderDetail});
    }catch(error){renderDetail();detail.querySelector('[data-estimate-feedback]').textContent=error.message;}
  }
  form.addEventListener('submit',event=>{event.preventDefault();void load();});more.addEventListener('click',()=>void load(true));
  root.addEventListener('click',async event=>{
    const target=event.target.closest('button');if(!target)return;
    if(target.hasAttribute('data-estimate-status-filter')){form.elements.status.value=target.dataset.estimateStatusFilter;root.querySelectorAll('[data-estimate-status-filter]').forEach(button=>button.classList.toggle('active',button===target));void load();return;}
    if(target.hasAttribute('data-estimate-open-edit')){void open(target.dataset.estimateOpenEdit,true);return;}
    if(target.hasAttribute('data-estimate-open')){void open(target.dataset.estimateOpen);return;}
    if(target.hasAttribute('data-estimate-close')){dialog.close();return;}
    if(!selected)return;
    try{
      target.disabled=true;
      if(target.hasAttribute('data-estimate-ready'))await change({status:'READY'});
      if(target.hasAttribute('data-estimate-cancel')&&globalThis.confirm('Cancel this estimate? Its saved lines will remain available.'))await change({status:'CANCELLED'});
      if(target.hasAttribute('data-estimate-invoice')){dialog.close();globalThis.location.hash=`#/invoices/from-estimate/${selected.id}`;}
      if(target.hasAttribute('data-estimate-edit'))await edit();
      if(target.hasAttribute('data-estimate-edit-discard'))renderDetail();
      if(target.hasAttribute('data-estimate-print'))await printSavedEstimate(selected);
      if(target.hasAttribute('data-estimate-pdf'))downloadEstimatePdf(await createSavedEstimatePdfFile(selected,STORE_HEADER,document,{template:normalizeDocumentTemplate(selected.document_template)}));
      if(target.hasAttribute('data-estimate-whatsapp')){
        const digits=String(selected.customer?.phone??'').replace(/\D/g,'');
        const phone=digits.startsWith('0')?`92${digits.slice(1)}`:digits;
        const text=`${selected.estimate_number} · ${selected.customer?.name??selected.customer_name} · PKR ${amount(selected.grand_total)}`;
        const shareUrl=new URL(`https://wa.me/${phone}`);
        shareUrl.searchParams.set('text',text);
        globalThis.open(shareUrl.toString(),'_blank','noopener,noreferrer');
      }
    }catch(error){detail.querySelector('[data-estimate-feedback]').textContent=error.message;}finally{target.disabled=false;}
  });
  void load();const reference=route.split('/')[1];if(reference&&reference!=='list')void open(decodeURIComponent(reference),route.split('/')[2]==='edit');
}
