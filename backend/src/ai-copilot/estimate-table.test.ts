import {describe,it,expect} from 'vitest';
import {demandMarkdownTable,savedEstimateAnswer} from './estimate-table.js';
describe('full demand chat table',()=>{
 it('keeps a saved zero-price pending row unknown and labels its total as partial',()=>{
  const answer=savedEstimateAnswer({estimate_number:'EST-AI-1',customer_name:'Customer',status:'DRAFT',issue_date:'2026-10-25',grand_total:100,lines:[{product_name:'Thread',quantity:8,unit:'pcs',is_pending:true,list_price:0,discount_percent:0,unit_price:0,line_total:0}]});
  expect(answer).toContain('ریٹ مطلوب');expect(answer).toContain('جزوی رقم');expect(answer).not.toContain('**کل رقم');
 });
 it('includes every pending and priced row without catalog hashes or invented hardware rates',()=>{
  const lines=[{productName:'Pipe 6 inch',quantity:4,unit:'length',unit_price:100,discount_amount:200,discountPercent:50},{productName:'دھاگہ',quantity:8,unit:'pcs',pending:true},{productName:'CAT-raw123',quantity:1,unit:'pcs',pending:true}];
  const table=demandMarkdownTable(lines);expect(table.split('\n')).toHaveLength(5);expect(table).toContain('50.00');expect(table).toContain('دھاگہ');expect(table).toContain('ریٹ مطلوب');expect(table).not.toContain('CAT-');
 });
});
