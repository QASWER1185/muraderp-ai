import {mountSavedEstimateEditor} from './estimate-editor.js';
// @vitest-environment happy-dom
import {describe,it,expect,vi,afterEach} from 'vitest';
import {estimateListMarkup,savedEstimatePreviewMarkup,mountEstimateWorkspace} from './estimate-register.js';
import {getSession} from './auth.js';
import {receivableListMarkup} from './payments.js';
const context={organizationId:'11111111-1111-4111-8111-111111111111',branchId:'22222222-2222-4222-8222-222222222222'};
const record={id:3,estimate_number:'EST-1062',issue_date:'2026-10-24',customer:{name:'خالد مجید صاحب',phone:'0300',city:'لاہور'},customer_name:'خالد مجید صاحب',status:'DRAFT',grand_total:178917.77,subtotal:178917.77,discount_total:0,customer_payable_total:178917.77,item_count:39,lines:Array.from({length:39},(_,i)=>({product_id:i+1,product_name:'Pipe '+(i+1),category:i<20?'Pipes':'Fittings',quantity:1,unit:'pcs',list_price:100,discount_percent:50,unit_price:50,line_total:50}))};
afterEach(()=>vi.unstubAllGlobals());
describe('saved estimate workspace',()=>{
 it('edits an unlisted pending row without requiring a fake catalog product',async()=>{
  const root=document.createElement('div');document.body.append(root);const onSave=vi.fn();
  const estimate={...record,customer_id:7,lines:[{id:10,product_id:null,product_name:'Solution',quantity:6,unit:'can',list_price:0,discount_percent:0,is_pending:true,is_unlisted:true}]};
  mountSavedEstimateEditor(root,estimate,{customers:[{id:7,name:'Test customer'}],products:[],searchProducts:async()=>[],onSave,onCancel:()=>{}});
  root.querySelector('[name="quantity"]').value='7';root.querySelector('[name="list_price"]').value='30';
  root.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  await vi.waitFor(()=>expect(onSave).toHaveBeenCalledWith(expect.objectContaining({lines:[expect.objectContaining({id:10,product_id:null,is_unlisted:true,is_pending:false,quantity:7,list_price:30})]})));root.remove();
 });

 it('renders original full itemized customer document with Urdu and category totals',()=>{const root=document.createElement('div');root.innerHTML=savedEstimatePreviewMarkup(record);expect(root.querySelectorAll('tbody tr:not(.estimate-category):not(.estimate-category-total)')).toHaveLength(39);expect(root.textContent).toContain('خالد مجید صاحب');expect(root.textContent).toContain('178,917.77');expect(root.textContent).toContain('List Rate');expect(root.textContent).toContain('Plaza No 4');expect(root.querySelectorAll('.estimate-category-total')).toHaveLength(2);expect(estimateListMarkup([record])).toContain('data-estimate-open="3"');});
 it('opens detail and sends READY with the original concurrency version',async()=>{const root=document.createElement('div');document.body.append(root);HTMLDialogElement.prototype.showModal=function(){this.open=true;};const listEstimates=vi.fn().mockResolvedValue({data:[record],next_cursor:null}),getEstimate=vi.fn().mockResolvedValue({data:{...record,updated_at:'2026-10-24T07:00:00Z'}}),updateEstimate=vi.fn().mockResolvedValue({data:{...record,status:'READY'}});mountEstimateWorkspace(root,{context,route:'estimates/3',listEstimates,getEstimate,updateEstimate});await vi.waitFor(()=>expect(root.querySelector('[data-estimate-ready]')).not.toBeNull());root.querySelector('[data-estimate-ready]').click();await vi.waitFor(()=>expect(updateEstimate).toHaveBeenCalledWith(context,3,{status:'READY',expected_updated_at:'2026-10-24T07:00:00Z'}));expect(root.querySelector('[data-estimate-invoice]')).not.toBeNull();root.remove();});
 it('preserves authentication on transient failures and only treats 401 as signed out',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce({ok:false,status:503}).mockResolvedValueOnce({ok:true,status:200,json:async()=>({data:{userId:'owner'}})}));expect((await getSession()).data.userId).toBe('owner');vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:401}));expect(await getSession()).toBeNull();});
 it('labels customer credit without presenting a negative amount as debt',()=>{const html=receivableListMarkup([{invoice_number:'INV-1',customer_name:'خالد',outstanding:-360,currency_code:'PKR'}]);expect(html).toContain('Customer credit:');expect(html).toContain('Rs 360');expect(html).not.toContain('-360');});
});
