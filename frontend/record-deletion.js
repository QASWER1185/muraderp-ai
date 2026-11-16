import { getWorkspaceContext } from './workspace-context.js';

export async function recordRequest(path, options={}) {
  const context=getWorkspaceContext();
  if(!context) throw new Error('Choose an authorized workspace first.');
  const response=await fetch(`/api/v1/${path}`,{credentials:'include',...options,headers:{'X-Organization-Id':context.organizationId,'X-Branch-Id':context.branchId,...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});
  const result=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(result.error?.message??`Request failed (HTTP ${response.status}).`);
  return result;
}
export async function allRecords(path) {
  const rows=[]; let cursor=null; const seen=new Set();
  do {
    const page=await recordRequest(`${path}${path.includes('?')?'&':'?'}limit=100${cursor==null?'':`&cursor=${cursor}`}`);
    rows.push(...(page.data??[])); cursor=page.next_cursor??null;
    if(cursor!=null && seen.has(cursor)) throw new Error('Register pagination did not advance.');
    seen.add(cursor);
  } while(cursor!=null);
  return rows;
}
const modules={customers:'customers',vendors:'vendors',products:'products',warehouses:'warehouses',estimates:'estimates',invoices:'invoices',purchases:'browser/purchases',rates:'rate-lists',returns:'returns',payments:'browser/customer-payments','vendor-payments':'browser/vendor-payments'};
export function mountRecordDeletion(container, section, refresh) {
  if(section==='inventory') mountStockAdjustment(container,refresh);
  if(!modules[section]) return;
  const launch=document.createElement('button'); launch.type='button';launch.className='button secondary';launch.textContent='Delete record';
  const heading=container.querySelector('.page-heading');if(heading)heading.append(launch);else container.prepend(launch);
  launch.addEventListener('click',async()=>{
    const dialog=document.createElement('dialog');dialog.className='side-dialog';
    dialog.innerHTML='<form class="modal-card"><h2>Review record deletion</h2><p>Posted records reverse stock, ledger and balances atomically. Linked records and negative stock block deletion.</p><label>Record<select name="record" required></select></label><label data-version-label hidden>Draft version<select name="version"><option value="">Delete the list</option></select></label><section data-reversal-summary aria-live="polite"></section><p role="alert" data-message>Loading records...</p><div class="dialog-actions"><button type="button" class="button secondary" data-cancel>Cancel</button><button type="submit" class="button primary" disabled>Delete selected record</button></div></form>';
    container.append(dialog);dialog.showModal();
    const form=dialog.querySelector('form'),select=form.elements.record,version=form.elements.version,message=dialog.querySelector('[data-message]'),submit=form.querySelector('[type=submit]');
    const close=()=>{dialog.close();dialog.remove();};dialog.querySelector('[data-cancel]').onclick=close;
    let rows=[],preview=null,previewGeneration=0;
    const targetPath=()=>section==='rates'&&version.value?'rate-lists/versions/'+version.value:(section==='rates'?'rate-lists':section)+'/'+select.value;
    const loadPreview=async()=>{
      const generation=++previewGeneration;preview=null;submit.disabled=true;
      const content=dialog.querySelector('[data-reversal-summary]');content.textContent='';
      if(!select.value)return;
      message.textContent='Loading reversal impact...';
      try{const result=await recordRequest(targetPath()+'/delete-preview');if(generation!==previewGeneration)return;preview=result.data;content.innerHTML=deletionSummaryMarkup(preview);message.textContent=preview.allowed?'Review the impact, then confirm deletion.':'Deletion is blocked.';submit.textContent=preview.posted?'Confirm reversal and delete':'Confirm delete';submit.disabled=!preview.allowed;}catch(error){if(generation===previewGeneration)message.textContent=error.message;}
    };
    const loadVersions=async()=>{
      if(section!=='rates') return;
      submit.disabled=true; version.replaceChildren(new Option('Delete the list',''));
      try {const result=await recordRequest(`rate-lists/${select.value}`);for(const v of result.data.versions.filter(v=>v.status==='DRAFT')) version.append(new Option(`Draft version ${v.version_number}`,v.id));dialog.querySelector('[data-version-label]').hidden=false;message.textContent='';submit.disabled=false;}catch(error){message.textContent=error.message;}
    };
    try { rows=await allRecords(modules[section]);select.append(new Option('Choose a record',''));for(const row of rows)select.append(new Option(`${row.name??row.estimate_number??row.invoice_number??row.credit_note_number??`Record #${row.id}`} · ${row.status??'Record'}`,row.id));message.textContent=rows.length?'':'No records available.';submit.disabled=true;}catch(error){message.textContent=error.message;}
    select.addEventListener('change',async()=>{preview=null;submit.disabled=true;if(select.value){await loadVersions();await loadPreview();}});
    version.addEventListener('change',()=>void loadPreview());
    form.addEventListener('submit',async(event)=>{
      event.preventDefault();if(!select.value)return;
      if(!preview?.allowed || !preview.fingerprint)return;
      submit.disabled=true;
      try {const target=targetPath();await recordRequest(target,{method:'DELETE',body:JSON.stringify({fingerprint:preview.fingerprint})});close();refresh();}catch(error){await loadPreview();message.textContent=error.message;}
    });
  });
}

function mountStockAdjustment(container,refresh) {
  const launch=document.createElement('button');launch.type='button';launch.className='button primary';launch.textContent='Adjust Stock';const heading=container.querySelector('.page-heading');if(heading)heading.append(launch);else container.prepend(launch);
  launch.onclick=async()=>{
    const dialog=document.createElement('dialog');dialog.className='side-dialog';dialog.innerHTML='<form class="modal-card"><h2>Adjust Stock</h2><label>Product<select name="product_id" required></select></label><label>Warehouse<select name="warehouse_id" required></select></label><label>Quantity change<input name="quantity_delta" type="number" step="any" required></label><label>Reason<textarea name="reason" maxlength="2000" required></textarea></label><label>Adjusted by<input name="adjusted_by" maxlength="200" required></label><p role="alert"></p><div class="dialog-actions"><button type="button" data-cancel class="button secondary">Cancel</button><button type="submit" class="button primary" disabled>Apply adjustment</button></div></form>';container.append(dialog);dialog.showModal();
    const form=dialog.querySelector('form'),message=form.querySelector('[role=alert]'),submit=form.querySelector('[type=submit]');const close=()=>{dialog.close();dialog.remove();};form.querySelector('[data-cancel]').onclick=close;
    try {const [products,warehouses]=await Promise.all([allRecords('products'),allRecords('warehouses')]);for(const [name,rows] of [['product_id',products],['warehouse_id',warehouses]]) {form.elements[name].append(new Option('Choose '+name.replace('_id',''),''));for(const r of rows)form.elements[name].append(new Option(r.name,r.id));}submit.disabled=false;}catch(error){message.textContent=error.message;}
    form.onsubmit=async(event)=>{event.preventDefault();const values=Object.fromEntries(new FormData(form));for(const k of ['product_id','warehouse_id','quantity_delta'])values[k]=Number(values[k]);if(!values.quantity_delta){message.textContent='Enter a nonzero quantity change.';return;}submit.disabled=true;try{await recordRequest('stock/adjust',{method:'POST',body:JSON.stringify(values)});close();refresh();}catch(error){message.textContent=error.message;submit.disabled=false;}};
  };
}

const reversalEscape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function deletionSummaryMarkup(summary){
 const list=(rows,render)=>rows?.length?'<ul>'+rows.map(r=>'<li>'+render(r)+'</li>').join('')+'</ul>':'<p>No change.</p>';
 return '<h3>'+ (summary.posted?'Posted record reversal':'Record deletion') +'</h3><p>This action removes the record. Original journals and an immutable reversal audit are retained.</p>'+
 (summary.derived_learning_events?'<p>Derived estimate suggestions to archive in the audit: '+reversalEscape(summary.derived_learning_events)+'</p>':'')+
 '<h4>Stock impact</h4>'+list(summary.stock,r=>'Product '+reversalEscape(r.product_id)+' / Warehouse '+reversalEscape(r.warehouse_id)+': '+reversalEscape(r.before)+' → '+reversalEscape(r.after)+' (change '+reversalEscape(r.quantity_change)+')')+
 '<h4>Ledger reversal</h4>'+list(summary.ledger_delta,r=>'Account '+reversalEscape(r.code)+': Debit '+reversalEscape(r.reversal_debit)+', Credit '+reversalEscape(r.reversal_credit))+
 '<h4>Customer balance</h4>'+list(summary.customer_balances,r=>'Customer '+reversalEscape(r.customer_id)+': change '+reversalEscape(r.balance_change)+', after '+reversalEscape(r.balance_after)+' '+reversalEscape(r.currency))+
 '<h4>Vendor balance (debits minus credits)</h4>'+list(summary.vendor_balances,r=>'Vendor '+reversalEscape(r.vendor_id)+': change '+reversalEscape(r.balance_change)+', after '+reversalEscape(r.balance_after))+
 (summary.blockers?.length?'<h4>Blockers</h4>'+list(summary.blockers,r=>reversalEscape(r)):'');
}
