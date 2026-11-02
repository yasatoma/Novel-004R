import { normalizeStringArray, parseJsonOr } from "./data-validation.js";
const SEP="\u001f";

export function textFingerprint(text=""){
 let hash=2166136261;
 for(const ch of String(text)){hash^=ch.charCodeAt(0);hash=Math.imul(hash,16777619);}
 return (hash>>>0).toString(36);
}
function token(id,text){return `${id}${SEP}${textFingerprint(text)}`;}
function isCurrentToken(value){return typeof value==="string"&&value.includes(SEP);}

export class ReadTracker{
 constructor(storage,key){
  this.storage=storage;this.key=key;
  const raw=normalizeStringArray(parseJsonOr(storage.getItem(key),[]));
  this.ids=new Set(raw.filter(isCurrentToken));
  if(raw.length!==this.ids.size)this.persist();
 }
 has(id,text=""){return !!id&&this.ids.has(token(id,text));}
 all(){return [...this.ids];}
 mark(id,text=""){if(!id)return;const value=token(id,text);if(this.ids.has(value))return;this.ids.add(value);this.persist();}
 replace(ids=[]){this.ids=new Set(normalizeStringArray(ids).filter(isCurrentToken));this.persist();}
 clear(){this.ids.clear();this.persist();}
 persist(){this.storage.setItem(this.key,JSON.stringify([...this.ids]));}
}
