import { listMarkup as rateListMarkup } from './rate-lists.js';
import { allRecords } from './record-deletion.js';
import { invoiceListMarkup } from './invoices.js';
import { purchaseListMarkup } from './purchases.js';
import { paymentListMarkup } from './payments.js';
import { vendorPaymentListMarkup } from './vendor-payments.js';
import { vendorRowsMarkup } from './vendors.js';
import { stockBalancesMarkup, stockMovementsMarkup } from './stock.js';
function option(label,value){const node=document.createElement('option');node.textContent=label;node.value=value;return node;}

export function csvText(columns,rows) {
  const quote=value=>`"${String(value??'').replaceAll('"','""')}"`;
  return [columns.map(c=>quote(c[1])).join(','),...rows.map(r=>columns.map(c=>quote(r[c[0]])).join(','))].join('\r\n')+'\r\n';
}
export function selectRows(rows,{search='',status='',from='',to='',sort='id',descending=false}={}) {
  const query=search.toLocaleLowerCase();
  return rows.filter(r=>(!query||Object.values(r).some(v=>String(v??'').toLocaleLowerCase().includes(query)))&&(!status||r.register_status===status)&&(!from||r.register_date>=from)&&(!to||r.register_date<=to)).sort((a,b)=>{const x=a[sort]??'',y=b[sort]??'';return (typeof x==='number'&&typeof y==='number'?x-y:String(x).localeCompare(String(y),undefined,{numeric:true}))*(descending?-1:1);});
}
const specs={
  'inventory-movements':['browser/stock/movements','#stock-movements',null,[['movement_type','Movement'],['product_name','Product'],['warehouse_name','Warehouse'],['quantity_delta','Quantity change'],['register_date','Date']]],
  invoices:['invoices','#invoice-results','data-invoice-id',[['invoice_number','Invoice'],['customer_name','Customer'],['issue_date','Date'],['status','Status'],['grand_total','Total']]],
  purchases:['browser/purchases','#purchase-results','data-purchase-id',[['invoice_number','Invoice'],['vendor_name','Vendor'],['purchase_date','Date'],['register_status','Status'],['total','Total']]],
  payments:['browser/customer-payments','#payment-results','data-payment-id',[['id','Payment'],['customer_name','Customer'],['payment_date','Date'],['register_status','Status'],['amount','Amount']]],
  'vendor-payments':['browser/vendor-payments','#vendor-payment-results','data-vendor-payment-id',[['id','Payment'],['vendor_name','Vendor'],['payment_date','Date'],['register_status','Status'],['amount','Amount']]],
  vendors:['vendors','#vendor-panel','data-vendor-edit',[['name','Vendor'],['phone','Phone'],['city','City'],['address','Address'],['register_date','Updated']]],
  rates:['rate-lists','#rate-list-results','data-rate-list-id',[['name','Rate List'],['code','Code'],['price_type','Type'],['register_status','Status'],['register_date','Created']]],
  inventory:['browser/stock/balances','#stock-balances',null,[['product_name','Product'],['warehouse_name','Warehouse'],['quantity','Quantity'],['register_status','Status'],['register_date','Updated']]],
};
export function mountRegisterTools(container,section) {
  if(section==='inventory') mountRegisterTools(container,'inventory-movements');
  const spec=specs[section];if(!spec)return;
  const [path,selector,action,columns]=spec,target=container.querySelector(selector);if(!target)return;
  const controls=document.createElement('div');controls.className='invoice-entry-meta';
  controls.innerHTML='<label>Search<input type="search" data-search placeholder="Search register"></label><label>Status<select data-status><option value="">All statuses</option></select></label><label>From<input type="date" data-from></label><label>To<input type="date" data-to></label><button type="button" class="button secondary" data-export>Export CSV</button><p role="status" data-count></p>';
  target.before(controls);let rows=[],sort=columns[0][0],descending=false,loading=false;
  const filters=()=>({search:controls.querySelector('[data-search]').value,status:controls.querySelector('[data-status]').value,from:controls.querySelector('[data-from]').value,to:controls.querySelector('[data-to]').value,sort,descending});
  const visible=()=>selectRows(rows,filters());
  const render=()=>{
    const filtered=visible(),wrapper=document.createElement('div');wrapper.dataset.universalRegister='';
    const head=document.createElement('div');head.className='register-sort-controls';head.setAttribute('aria-label','Sort register');
    for(const [key,label] of columns){const button=document.createElement('button');button.type='button';button.className='button secondary compact';button.dataset.registerSort=key;button.textContent=label+(sort===key?(descending?' ↓':' ↑'):'');button.setAttribute('aria-pressed',String(sort===key));button.onclick=()=>{descending=sort===key?!descending:false;sort=key;render();};head.append(button);}
    const content=document.createElement('div');wrapper.append(head,content);
    const original={rates:rateListMarkup,invoices:invoiceListMarkup,purchases:purchaseListMarkup,payments:paymentListMarkup,'vendor-payments':vendorPaymentListMarkup};
    if(original[section])content.innerHTML=original[section](filtered);
    else if(section==='vendors')content.innerHTML=`<div class="table-wrap"><table class="table vendor-table"><thead><tr><th>ID</th><th>Name</th><th>Phone</th><th>City / Address</th><th>Updated</th><th>Actions</th></tr></thead><tbody>${vendorRowsMarkup(filtered)}</tbody></table></div>`;
    else if(section.startsWith('inventory'))content.innerHTML=(section==='inventory'?stockBalancesMarkup:stockMovementsMarkup)(filtered,filtered.map(r=>({id:r.product_id,name:r.product_name})),filtered.map(r=>({id:r.warehouse_id,name:r.warehouse_name})));
    const toolbar=section==='vendors'?target.querySelector('.section-head'):null;target.replaceChildren(...(toolbar?[toolbar]:[]),wrapper);
    if(section==='vendors'&&!target.querySelector('[data-vendor-new]')){const button=document.createElement('button');button.type='button';button.className='button primary';button.dataset.vendorNew='';button.textContent='New vendor';target.prepend(button);}
    controls.querySelector('[data-count]').textContent=`${filtered.length} of ${rows.length} records`;
  };
  async function load(){if(loading)return;loading=true;try{
    const data=await allRecords(path);
    let customers=[],vendors=[],products=[],warehouses=[];
    if(section==='invoices'||section==='payments')customers=await allRecords('customers');
    if(section==='purchases')vendors=await allRecords('vendors');
    if(section.startsWith('inventory'))[products,warehouses]=await Promise.all([allRecords('products'),allRecords('warehouses')]);
    rows=data.map(r=>({...r,quantity_delta:r.quantity_delta??r.quantity,customer_name:r.customer_name??customers.find(c=>c.id===r.customer_id)?.name??'',vendor_name:r.vendor_name??vendors.find(v=>v.id===r.vendor_id)?.name??'',product_name:products.find(p=>p.id===r.product_id)?.name??r.product_id,warehouse_name:warehouses.find(w=>w.id===r.warehouse_id)?.name??r.warehouse_id,register_date:String(r.issue_date??r.purchase_date??r.payment_date??r.updated_at??r.created_at??'').slice(0,10),register_status:r.status??r.movement_type??(section==='rates'?(r.is_active?'ACTIVE':'INACTIVE'):section==='inventory'?(Number(r.quantity)>0?'IN_STOCK':'OUT_OF_STOCK'):section==='vendors'?'ACTIVE':'POSTED')}));
    const statuses=controls.querySelector('[data-status]'),selected=statuses.value;statuses.replaceChildren(option('All statuses',''));for(const status of [...new Set(rows.map(r=>r.register_status))].sort())statuses.append(option(status,status));statuses.value=selected;render();
    for(const button of container.querySelectorAll('[data-invoice-next],[data-purchase-next],[data-payment-next],[data-vendor-payment-next],[data-stock-more-balances],[data-stock-more-movements],[data-vendor-more]'))button.hidden=true;
  }catch(error){controls.querySelector('[data-count]').textContent=error.message;}finally{loading=false;}}
  controls.addEventListener('input',render);controls.addEventListener('change',render);
  controls.querySelector('[data-export]').onclick=()=>{const url=URL.createObjectURL(new Blob([csvText(columns,visible())],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=`${section}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const observer=new MutationObserver(()=>{if(!container.isConnected){observer.disconnect();return;}if(!target.querySelector('[data-universal-register]'))void load();});observer.observe(target,{childList:true});void load();
}
