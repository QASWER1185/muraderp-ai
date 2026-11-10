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
    dialog.innerHTML='<form class="modal-card"><h2>Delete unused record</h2><p>Posted records and records linked to payments, stock, or accounting cannot be deleted.</p><label>Record<select name="record" required></select></label><label data-version-label hidden>Draft version<select name="version"><option value="">Delete the list</option></select></label><p role="alert" data-message>Loading records...</p><div class="dialog-actions"><button type="button" class="button secondary" data-cancel>Cancel</button><button type="submit" class="button primary" disabled>Delete selected record</button></div></form>';
    container.append(dialog);dialog.showModal();
    const form=dialog.querySelector('form'),select=form.elements.record,version=form.elements.version,message=dialog.querySelector('[data-message]'),submit=form.querySelector('[type=submit]');
    const close=()=>{dialog.close();dialog.remove();};dialog.querySelector('[data-cancel]').onclick=close;
    let rows=[];
    const loadVersions=async()=>{
      if(section!=='rates') return;
      submit.disabled=true; version.replaceChildren(new Option('Delete the list',''));
      try {const result=await recordRequest(`rate-lists/${select.value}`);for(const v of result.data.versions.filter(v=>v.status==='DRAFT')) version.append(new Option(`Draft version ${v.version_number}`,v.id));dialog.querySelector('[data-version-label]').hidden=false;message.textContent='';submit.disabled=false;}catch(error){message.textContent=error.message;}
    };
    try { rows=await allRecords(modules[section]);select.append(new Option('Choose a record',''));for(const row of rows)select.append(new Option(`${row.name??row.estimate_number??row.invoice_number??row.credit_note_number??`Record #${row.id}`} · ${row.status??'Record'}`,row.id));message.textContent=rows.length?'':'No records available.';submit.disabled=!rows.length;}catch(error){message.textContent=error.message;}
    select.addEventListener('change',()=>{if(select.value)void loadVersions();});
    form.addEventListener('submit',async(event)=>{
      event.preventDefault();if(!select.value)return;
      if(!globalThis.confirm(`Permanently delete ${select.selectedOptions[0].textContent}${version.value?' / '+version.selectedOptions[0].textContent:''}?`))return;
      submit.disabled=true;
      try {const target=section==='rates'&&version.value?`rate-lists/versions/${version.value}`:`${section==='rates'?'rate-lists':section}/${select.value}`;await recordRequest(target,{method:'DELETE'});close();refresh();}catch(error){message.textContent=error.message;submit.disabled=false;}
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
