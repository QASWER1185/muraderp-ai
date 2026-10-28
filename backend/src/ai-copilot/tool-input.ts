/** Repair transport-only Gemini differences; required/unknown fields still fail local validation. */
export function normalizeToolInput(value:any,schema:any):any {
  if(value===null)return value;
  if(schema?.type==='object'&&value&&typeof value==='object'&&!Array.isArray(value)){
    const required=new Set(schema.required??[]);
    return Object.fromEntries(Object.entries(value).flatMap(([key,item])=>{
      const alternate=key.replace(/_([a-z])/g,(_,letter:string)=>letter.toUpperCase());
      const snake=key.replace(/[A-Z]/g,letter=>'_'+letter.toLowerCase());
      const name=schema.properties?.[key]?key:schema.properties?.[alternate]?alternate:schema.properties?.[snake]?snake:key;
      const child=schema.properties?.[name];
      if(item===null&&child&&!required.has(name))return [];
      return [[name,child?normalizeToolInput(item,child):item]];
    }));
  }
  if(schema?.type==='array'&&Array.isArray(value))return value.map(item=>normalizeToolInput(item,schema.items));
  if(['number','integer'].includes(schema?.type)&&typeof value==='string'&&/^-?\d+(?:\.\d+)?$/.test(value)&&Number.isFinite(Number(value)))return Number(value);
  return value;
}

export function geminiToolSchema(value:any):any {
  if(Array.isArray(value))return value.map(geminiToolSchema);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!['$schema','default'].includes(key)).map(([key,item])=>[key,geminiToolSchema(item)]));
  return value;
}
