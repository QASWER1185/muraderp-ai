// @vitest-environment happy-dom
import {describe,it,expect,vi} from 'vitest';
vi.mock('./customer-api.js',()=>({listCustomers:async()=>({data:[{id:26,name:'Audit customer'}]})}));
vi.mock('./product-api.js',()=>({listProducts:async()=>({data:[]})}));
vi.mock('./warehouse-api.js',()=>({listWarehouses:async()=>({data:[{id:15,name:'Main Warehouse'}]})}));
vi.mock('./invoice-api.js',()=>({listInvoices:async()=>({data:[],next_cursor:null}),listReadyEstimates:async()=>({data:[{id:5,estimate_number:'EST-AUDIT',customer_id:26}]}),getReadyEstimate:async()=>({data:{customer_id:26,currency_code:'PKR',pass_through_rent:0,lines:[{line_number:1,product_id:578,quantity:4,unit:'pcs',unit_price:125.5,discount_amount:0}]}}),createInvoice:vi.fn(),createInvoiceFromEstimate:vi.fn(),getInvoice:vi.fn()}));
import {mountInvoices} from './invoices.js';
describe('ready estimate invoice editor',()=>{
 it('preserves selected products and actual quantity/unit/rate when mounting source DOM rows',async()=>{
  HTMLDialogElement.prototype.showModal=function(){this.open=true;};const root=document.createElement('div');document.body.append(root);
  mountInvoices(root,{context:{organizationId:'11111111-1111-4111-8111-111111111111',branchId:'22222222-2222-4222-8222-222222222222'},sourceEstimateId:5});
  await vi.waitFor(()=>expect(root.querySelector('[name="unit_price"]')?.value).toBe('125.5'));
  expect(root.querySelector('[name="product_id"]').value).toBe('578');expect(root.querySelector('[name="quantity"]').value).toBe('4');expect(root.querySelector('[name="unit"]').value).toBe('pcs');expect(root.querySelector('[name="source_estimate_id"]').value).toBe('5');root.remove();
 });
});
