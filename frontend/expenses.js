import {recordRequest} from "./record-deletion.js";
import {reportPeriod} from "./report-period.js";
const categories={
  expense:[["5100","Shop Rent"],["5110","Electricity"],["5120","Shop Miscellaneous"]],
  drawings:[["3100","House Rent"],["3110","School Fees"],["3120","Kitchen & Groceries"],["3130","Car Petrol"],["3140","Other Personal"]],
};
const escape=value=>String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const money=value=>Number(value).toLocaleString("en-PK",{minimumFractionDigits:2,maximumFractionDigits:2});
export function mountExpenses(root){
  const today=reportPeriod("daily").to;
  root.innerHTML=`<section class="surface"><h1>Expenses</h1><form class="customer-context-form">
    <label>Date<input name="date" type="date" value="${today}" required></label>
    <label>Type<select name="kind"><option value="expense">Business expense</option><option value="drawings">Household</option></select></label>
    <label>Category<select name="category"></select></label>
    <label>Amount (PKR)<input name="amount" type="number" min="0.01" step="0.01" required></label>
    <label>Paid From<select name="funding"><option value="1000">Cash</option><option value="1010">Bank</option></select></label>
    <label>Notes<input name="notes" maxlength="500"></label>
    <button class="button primary" type="submit">Post Entry</button>
  </form><p role="alert" data-entry-status></p></section><section class="surface"><h2>Monthly history</h2>
  <label>Month<input type="month" value="${today.slice(0,7)}"></label><div data-history aria-live="polite"></div></section>`;
  const form=root.querySelector("form"), month=root.querySelector('[type="month"]'), history=root.querySelector("[data-history]");
  const endpoint="browser/accounting/expenses";
  const setCategories=()=>{form.elements.category.innerHTML=categories[form.elements.kind.value].map(([code,name])=>`<option value="${code}">${escape(name)}</option>`).join("");};
  let generation=0, pendingKey, pendingBody;
  async function load(){
    if(!month.value)return;
    const run=++generation, from=month.value+"-01";
    const end=new Date(from+"T00:00:00Z");end.setUTCMonth(end.getUTCMonth()+1,0);
    try{
      const {data}=await recordRequest(endpoint+"?"+new URLSearchParams({from,to:end.toISOString().slice(0,10)}));
      if(run!==generation)return;
      const totals=new Map();
      for(const row of data)if(row.status==="POSTED")totals.set(row.category_name,(totals.get(row.category_name)??0)+Math.round(Number(row.amount)*100));
      history.innerHTML=`<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Category</th><th>Paid From</th><th>Amount (PKR)</th><th>Notes</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>${data.map(r=>`<tr><td>${escape(r.entry_date)}</td><td>${escape(r.category_name)}</td><td>${r.funding==="1000"?"Cash":"Bank"}</td><td>${money(r.amount)}</td><td>${escape(r.description)}</td><td>${escape(r.status)}</td><td>${r.status==="POSTED"?`<button type="button" class="button secondary" data-void="${escape(r.id)}">Void</button>`:""}</td></tr>`).join("")}</tbody></table></div>
      <h3>Category totals (PKR)</h3><ul>${[...totals].map(([name,cents])=>`<li>${escape(name)}: ${money(cents/100)}</li>`).join("")}</ul>`;
    }catch(error){if(run===generation)history.textContent=error.message;}
  }
  form.elements.kind.onchange=setCategories; month.onchange=load; setCategories();void load();
  const status=root.querySelector("[data-entry-status]");
  form.onsubmit=async event=>{
    event.preventDefault();
    const button=form.querySelector("button");button.disabled=true;
    const input=Object.fromEntries(new FormData(form));input.amount=Number(input.amount);
    const body=JSON.stringify(input);
    if(body!==pendingBody){pendingBody=body;pendingKey=crypto.randomUUID();}
    try{
      await recordRequest(endpoint,{method:"POST",body,headers:{"Idempotency-Key":pendingKey}});
      pendingBody=undefined;month.value=input.date.slice(0,7);form.elements.amount.value="";form.elements.notes.value="";
      status.textContent="Entry posted.";await load();
    }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
  };
  history.onclick=async event=>{
    const button=event.target.closest("[data-void]");
    if(!button||!globalThis.confirm("Void this entry and reverse its journal?"))return;
    button.disabled=true;
    try{await recordRequest(endpoint+"/"+button.dataset.void+"/void",{method:"POST"});status.textContent="Entry voided.";await load();}
    catch(error){status.textContent=error.message;button.disabled=false;}
  };
}
