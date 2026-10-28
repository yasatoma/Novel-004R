import { assertValidSaveState, isPlainRecord } from "./data-validation.js";
const SCHEMA_VERSION=1;
export class SaveManager{
 constructor(storage,config){this.storage=storage;this.config=config;}
 key(slot){return `${this.config.saveKey}.save.${slot}`;}
 save(slot,state,label="",resumeCommandIndex=state.currentCommandIndex??0){
  assertValidSaveState(state);
  const safeLabel=typeof label==="string"?label.slice(0,200):"";
  const safeIndex=Number.isInteger(resumeCommandIndex)&&resumeCommandIndex>=0?resumeCommandIndex:0;
  const data={schemaVersion:SCHEMA_VERSION,workId:this.config.workId,engineVersion:this.config.engineVersion,savedAt:new Date().toISOString(),label:safeLabel,resumeCommandIndex:safeIndex,state:structuredClone(state)};
  this.storage.setItem(this.key(slot),JSON.stringify(data));return data;
 }
 load(slot){
  const raw=this.storage.getItem(this.key(slot));if(!raw)return null;
  let data;try{data=JSON.parse(raw);}catch{throw new Error("Save data invalid");}
  if(!isPlainRecord(data))throw new Error("Save data invalid");
  if(data.schemaVersion!==SCHEMA_VERSION)throw new Error("Save schema mismatch");
  if(data.workId!==this.config.workId)throw new Error("Save work mismatch");
  if(data.engineVersion!==this.config.engineVersion)throw new Error("Save engine mismatch");
  if(typeof data.label!=="string")data.label=""; else data.label=data.label.slice(0,200);
  if(!Number.isInteger(data.resumeCommandIndex)||data.resumeCommandIndex<0)data.resumeCommandIndex=0;
  if(typeof data.savedAt!=="string"||!Number.isFinite(Date.parse(data.savedAt)))data.savedAt="";
  assertValidSaveState(data.state);
  return data;
 }
 autosave(state,label="",resumeCommandIndex=state.currentCommandIndex??0){return this.save("auto",state,label,resumeCommandIndex);}
 preserveBeforeLoad(state,label="読み込み前"){return this.save("preload",state,label,state.currentCommandIndex??0);}
}
