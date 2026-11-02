import { assertValidSaveState, isPlainRecord } from "./data-validation.js";
const SCHEMA_VERSION=1;
export class SaveManager{
 constructor(storage,config){this.storage=storage;this.config=config;}
 key(slot){return `${this.config.saveKey}.save.${slot}`;}
 save(slot,state,label="",resumeCommandIndex=state.currentCommandIndex??0,summary=null){
  assertValidSaveState(state);
  const safeLabel=typeof label==="string"?label.slice(0,200):"";
  const safeIndex=Number.isInteger(resumeCommandIndex)&&resumeCommandIndex>=0?resumeCommandIndex:0;
  const safeSummary=summary&&typeof summary==="object"?{
   chapterTitle:typeof summary.chapterTitle==="string"?summary.chapterTitle.slice(0,200):"",
   chapterProgress:Number.isFinite(Number(summary.chapterProgress))?Math.min(100,Math.max(0,Math.round(Number(summary.chapterProgress)))):null,
   text:typeof summary.text==="string"?summary.text.slice(0,500):""
  }:null;
  const data={schemaVersion:SCHEMA_VERSION,workId:this.config.workId,engineVersion:this.config.engineVersion,savedAt:new Date().toISOString(),label:safeLabel,resumeCommandIndex:safeIndex,summary:safeSummary,state:structuredClone(state)};
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
  if(data.summary!==null&&data.summary!==undefined){
   if(!isPlainRecord(data.summary))data.summary=null;
   else data.summary={
    chapterTitle:typeof data.summary.chapterTitle==="string"?data.summary.chapterTitle.slice(0,200):"",
    chapterProgress:Number.isFinite(Number(data.summary.chapterProgress))?Math.min(100,Math.max(0,Math.round(Number(data.summary.chapterProgress)))):null,
    text:typeof data.summary.text==="string"?data.summary.text.slice(0,500):""
   };
  } else data.summary=null;
  assertValidSaveState(data.state);
  return data;
 }
 autosave(state,label="",resumeCommandIndex=state.currentCommandIndex??0,summary=null){return this.save("auto",state,label,resumeCommandIndex,summary);}
 preserveBeforeLoad(state,label="読み込み前",summary=null){return this.save("preload",state,label,state.currentCommandIndex??0,summary);}
 delete(slot){this.storage.removeItem(this.key(slot));}
 deleteAll(){for(const slot of ["auto","preload",1,2,3,4,5,6])this.delete(slot);}
}
