import { documentTemplateOptions, normalizeDocumentTemplate } from './document-templates.js';
import { icon } from './icons.js';
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const money=value=>Number(value||0).toLocaleString('en-PK',{minimumFractionDigits:2,maximumFractionDigits:2});
const round=value=>Math.round((value+Number.EPSILON)*100)/100;
export function editableLineTotals(quantity,rate,discount){
  const net=Number(rate)*(1-Number(discount)/100);
  return {net,amount:round(Number(quantity)*net),subtotal:Number(quantity)*Number(rate)};
}
export function mountSavedEstimateEditor(container,estimate,{customers=[],products=[],searchProducts=async()=>[],onSave,onCancel}){
  const catalog=new Map(products.map(product=>[Number(product.id),product]));
  let nextKey=0,searchVersion=0,searchTimer;
  const lines=new Map();
  const customerOptions=new Map(customers.map(customer=>[Number(customer.id),customer]));
  if(!customerOptions.has(Number(estimate.customer_id)))customerOptions.set(Number(estimate.customer_id),{id:estimate.customer_id,name:estimate.customer?.name??estimate.customer_name});
  container.innerHTML=`<form class="saved-estimate-editor" data-estimate-edit-form><div class="saved-editor-meta"><label>Estimate Number<input value="${esc(estimate.estimate_number)}" readonly aria-label="Estimate Number"></label><label>Customer<select name="customer_id" required>${[...customerOptions.values()].map(customer=>`<option value="${customer.id}"${Number(customer.id)===Number(estimate.customer_id)?' selected':''}>${esc(customer.name)}</option>`).join('')}</select></label><label>Issue Date<input name="issue_date" type="date" value="${esc(estimate.issue_date)}" required></label>${documentTemplateOptions(estimate.document_template,'document_template','saved-editor-template')}<label>Carriage (PKR)<input name="pass_through_rent" type="number" min="0" step="any" inputmode="decimal" value="${Number(estimate.pass_through_rent??0)}" required></label></div><p class="saved-editor-hint">Choose a catalog item to switch products, or edit the existing item's quotation label. Rates stay under your control.</p><datalist id="saved-editor-products"></datalist><div class="saved-editor-lines" data-editor-lines></div><button type="button" class="button secondary" data-editor-add>+ Add Line</button><label class="saved-editor-notes">Notes<textarea name="notes" maxlength="2000">${esc(estimate.notes)}</textarea></label><dl class="saved-editor-totals"><div><dt>Subtotal</dt><dd data-editor-subtotal></dd></div><div><dt>Discount</dt><dd data-editor-discount></dd></div><div><dt>Carriage</dt><dd data-editor-carriage></dd></div><div><dt>Grand Total</dt><dd data-editor-grand></dd></div><div><dt>Customer Payable</dt><dd data-editor-payable></dd></div></dl><p data-editor-feedback role="alert"></p><div class="saved-editor-actions"><button type="submit" class="button primary">Save changes</button><button type="button" class="button secondary" data-editor-discard>Discard</button></div></form>`;
  const form=container.querySelector('form'),lineRoot=form.querySelector('[data-editor-lines]');
  function updateOptions(){form.querySelector('datalist').innerHTML=[...catalog.values()].map(product=>`<option value="${esc(product.name)}">${esc(product.sku??'')}</option>`).join('');}
  function append(line={}){
    const key=String(++nextKey);lines.set(key,{...line});
    const row=document.createElement('article');row.className='saved-editor-line';row.dataset.editorLine=key;
    row.innerHTML=`<div class="saved-editor-line-head"><strong data-editor-line-number>Line ${lines.size}</strong><button type="button" class="icon-button" data-editor-delete aria-label="Delete line">${icon('close',16)}</button></div><label class="saved-editor-product">Item Name<input name="product_name" list="saved-editor-products" value="${esc(line.product_name??'')}" maxlength="500" autocomplete="off" required></label><label>Qty<input name="quantity" type="number" min="0.000001" step="any" inputmode="decimal" value="${Number(line.quantity??1)}" required></label><label>Unit<input name="unit" value="${esc(line.unit??'pcs')}" maxlength="50" required></label><label>List / Saved Rate<input name="list_price" type="number" min="0" step="any" inputmode="decimal" value="${Number(line.list_price??line.stored_unit_price??line.unit_price??0)}" required></label><label>Discount %<input name="discount_percent" type="number" min="0" max="100" step="any" inputmode="decimal" value="${Number(line.discount_percent??0)}" required></label><div class="saved-editor-line-result"><span>Net Rate <strong data-editor-net></strong></span><span>Line Amount <strong data-editor-amount></strong></span></div>`;
    lineRoot.append(row);updateTotals();row.querySelector('[name="product_name"]').focus();
  }
  function updateTotals(){
    let subtotal=0,total=0;
    [...lineRoot.children].forEach((row,index)=>{
      row.querySelector('[data-editor-line-number]').textContent=`Line ${index+1}`;
      const value=name=>Number(row.querySelector(`[name="${name}"]`).value);
      const original=lines.get(row.dataset.editorLine);
      const calculation=editableLineTotals(value('quantity'),value('list_price'),value('discount_percent'));
      const unchanged=Number(original.quantity)===value('quantity')&&Number(original.list_price)===value('list_price')&&Number(original.discount_percent)===value('discount_percent');
      const amount=unchanged&&original.line_total!=null?Number(original.line_total):calculation.amount;
      subtotal+=calculation.subtotal;total+=amount;
      row.querySelector('[data-editor-net]').textContent=`PKR ${money(unchanged&&original.unit_price!=null?original.unit_price:calculation.net)}`;
      row.querySelector('[data-editor-amount]').textContent=`PKR ${money(amount)}`;
    });
    subtotal=round(subtotal);total=round(total);const carriage=Number(form.elements.pass_through_rent.value)||0;
    for(const [name,value] of Object.entries({subtotal,discount:round(subtotal-total),carriage,grand:total,payable:round(total+carriage)}))form.querySelector(`[data-editor-${name}]`).textContent=`PKR ${money(value)}`;
  }
  form.addEventListener('input',event=>{
    const row=event.target.closest('[data-editor-line]');
    if(row&&event.target.name==='product_name'){
      const term=event.target.value.trim();
      const match=[...catalog.values()].find(product=>product.name.toLocaleLowerCase()===term.toLocaleLowerCase()||product.sku?.toLocaleLowerCase()===term.toLocaleLowerCase());
      const line=lines.get(row.dataset.editorLine);
      if(match){line.product_id=match.id;row.querySelector('[name="unit"]').value=match.unit??row.querySelector('[name="unit"]').value;}
      clearTimeout(searchTimer);const version=++searchVersion;
      if(term.length>=2)searchTimer=setTimeout(async()=>{try{const found=await searchProducts(term);if(version!==searchVersion)return;found.forEach(product=>catalog.set(Number(product.id),product));updateOptions();const exact=found.find(product=>product.name.toLocaleLowerCase()===term.toLocaleLowerCase());if(exact&&event.target.value.trim()===term)line.product_id=exact.id;}catch{form.querySelector('[data-editor-feedback]').textContent='Catalog search is unavailable. Existing loaded products and edits remain available.';}},220);
    }
    updateTotals();
  });
  form.addEventListener('change',event=>{if(event.target.name==='product_name'){const row=event.target.closest('[data-editor-line]'),term=event.target.value.trim();const match=[...catalog.values()].find(product=>product.name.toLocaleLowerCase()===term.toLocaleLowerCase()||product.sku?.toLocaleLowerCase()===term.toLocaleLowerCase());if(match){lines.get(row.dataset.editorLine).product_id=match.id;event.target.value=match.name;row.querySelector('[name="unit"]').value=match.unit??row.querySelector('[name="unit"]').value;}updateTotals();}});
  form.addEventListener('click',event=>{if(event.target.closest('[data-editor-add]'))append();if(event.target.closest('[data-editor-discard]')){clearTimeout(searchTimer);onCancel();}const button=event.target.closest('[data-editor-delete]');if(button){const row=button.closest('[data-editor-line]');lines.delete(row.dataset.editorLine);row.remove();updateTotals();}});
  form.addEventListener('submit',async event=>{
    event.preventDefault();const feedback=form.querySelector('[data-editor-feedback]'),submit=form.querySelector('[type="submit"]');feedback.textContent='';submit.disabled=true;clearTimeout(searchTimer);
    try{
      await Promise.all([...lineRoot.children].map(async row=>{const name=row.querySelector('[name="product_name"]').value.trim();if(![...catalog.values()].some(product=>product.name.toLocaleLowerCase()===name.toLocaleLowerCase()||product.sku?.toLocaleLowerCase()===name.toLocaleLowerCase())){const found=await searchProducts(name);found.forEach(product=>catalog.set(Number(product.id),product));}}));
      const updated=[...lineRoot.children].map(row=>{
        const original=lines.get(row.dataset.editorLine),get=name=>row.querySelector(`[name="${name}"]`).value;
        const name=get('product_name').trim();const product=[...catalog.values()].find(product=>product.name.toLocaleLowerCase()===name.toLocaleLowerCase()||product.sku?.toLocaleLowerCase()===name.toLocaleLowerCase());
        const productId=product?.id??original.product_id; if(!name)throw new Error('Each line needs an item name.');
        return {...(original.id?{id:Number(original.id)}:{}),product_id:productId?Number(productId):null,...(!productId?{is_unlisted:true}:{}),is_pending:Number(get('list_price'))===0&&(original.is_pending||!productId),description:product?null:name,quantity:Number(get('quantity')),unit:get('unit').trim(),list_price:Number(get('list_price')),discount_percent:Number(get('discount_percent'))};
      });
      if(!updated.length)throw new Error('Keep at least one line in the estimate.');
      submit.disabled=true;
      await onSave({customer_id:Number(form.elements.customer_id.value),issue_date:form.elements.issue_date.value,document_template:normalizeDocumentTemplate(form.elements.document_template.value),pass_through_rent:Number(form.elements.pass_through_rent.value),notes:form.elements.notes.value||null,lines:updated});
    }catch(error){feedback.textContent=error.message;}finally{submit.disabled=false;}
  });
  updateOptions();estimate.lines.forEach(append);updateTotals();
  form.querySelector('[name="customer_id"]').focus();
}
