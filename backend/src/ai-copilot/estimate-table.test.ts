import {describe,it,expect} from 'vitest';
import {demandMarkdownTable} from './estimate-table.js';
describe('full demand chat table',()=>{
 it('includes every pending and priced row without catalog hashes or invented hardware rates',()=>{
  const lines=[{productName:'Pipe 6 inch',quantity:4,unit:'length',unit_price:100,discount_amount:200,discountPercent:50},{productName:'دھاگہ',quantity:8,unit:'pcs',pending:true},{productName:'CAT-raw123',quantity:1,unit:'pcs',pending:true}];
  const table=demandMarkdownTable(lines);expect(table.split('\n')).toHaveLength(5);expect(table).toContain('50.00');expect(table).toContain('دھاگہ');expect(table).toContain('ریٹ مطلوب');expect(table).not.toContain('CAT-');
 });
});
