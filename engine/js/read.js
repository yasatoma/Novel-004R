import { normalizeStringArray, parseJsonOr } from "./data-validation.js";
export class ReadTracker{
 constructor(storage,key){this.storage=storage;this.key=key;this.ids=new Set(normalizeStringArray(parseJsonOr(storage.getItem(key),[])));}
 has(id){return this.ids.has(id);}
 all(){return [...this.ids];}
 mark(id){if(!id||this.ids.has(id))return;this.ids.add(id);this.persist();}
 replace(ids=[]){this.ids=new Set(normalizeStringArray(ids));this.persist();}
 persist(){this.storage.setItem(this.key,JSON.stringify([...this.ids]));}
}
