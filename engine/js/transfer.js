import { assertValidTransferPayload } from "./data-validation.js";
const SCHEMA_VERSION=1;
const PREFIX="CNE1";
const MAX_CODE_LENGTH=750000;
const MAX_EXPANDED_BYTES=3000000;

export async function exportTransfer(config,state,readIds=[]){
 const payload=JSON.stringify({schemaVersion:SCHEMA_VERSION,workId:config.workId,engineVersion:config.engineVersion,state:{currentResumePoint:state.currentResumePoint,scenarioRevision:state.scenarioRevision,currentChoiceId:state.currentChoiceId,currentChapterId:state.currentChapterId,currentSceneId:state.currentSceneId,currentCommandIndex:state.currentCommandIndex,currentTextId:state.currentTextId,flags:state.flags,unlockedMemoIds:state.unlockedMemoIds,trail:state.trail,reachedEndingIds:state.reachedEndingIds,visibleCharacters:state.visibleCharacters,currentBackground:state.currentBackground,currentBackgroundImage:state.currentBackgroundImage,currentBackgroundFilter:state.currentBackgroundFilter,currentBackgroundEffect:state.currentBackgroundEffect,currentBackgroundEffectLayer:state.currentBackgroundEffectLayer,currentBackgroundView:state.currentBackgroundView,currentComparison:state.currentComparison,currentBgm:state.currentBgm,currentBgmVolume:state.currentBgmVolume,currentAmbient:state.currentAmbient,currentAmbientVolume:state.currentAmbientVolume,currentLocationText:state.currentLocationText,currentOverlay:state.currentOverlay,rubySeenByChapter:state.rubySeenByChapter},readIds});
 let bytes=new TextEncoder().encode(payload),type="U";
 if(typeof CompressionStream!=="undefined"){bytes=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());type="Z";}
 const data=toBase64(bytes);
 return `${PREFIX}${type}.${data}.${hash(data)}`;
}
export async function importTransfer(config,text){
 const raw=String(text??"").trim().replace(/\s+/g,"");
 if(raw.length>MAX_CODE_LENGTH)throw invalid();
 const match=new RegExp(`^${PREFIX}([UZ])\\.([A-Za-z0-9_-]+)\\.([a-z0-9]+)$`).exec(raw);
 if(!match||hash(match[2])!==match[3])throw invalid();
 let bytes;
 try{bytes=fromBase64(match[2]);}catch{throw invalid();}
 if(match[1]==="Z"){
  if(typeof DecompressionStream==="undefined")throw new Error("このブラウザでは復元できません。最新版をお試しください");
  const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate")).getReader(),parts=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_EXPANDED_BYTES){await reader.cancel();throw invalid();}parts.push(value);}
  bytes=new Uint8Array(size);let pos=0;for(const part of parts){bytes.set(part,pos);pos+=part.length;}
 }
 let data;try{data=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}catch{throw invalid();}
 if(data.schemaVersion!==SCHEMA_VERSION||data.workId!==config.workId||data.engineVersion!==config.engineVersion)throw invalid();
 try{assertValidTransferPayload(data);}catch{throw invalid();}
 return data;
}
export function transferFileName(workId,now=new Date()){
 const pad=n=>String(n).padStart(2,"0"),stamp=`${String(now.getFullYear()).slice(-2)}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
 const safe=String(workId??"").trim().replace(/[^A-Za-z0-9._-]+/g,"-").replace(/^-+|-+$/g,"");
 return `${stamp}${safe?"_"+safe:""}.txt`;
}
function invalid(){return new Error("コードが欠けているか、この作品のコードではありません");}
function hash(text){let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(36);}
function toBase64(bytes){let s="";for(const byte of bytes)s+=String.fromCharCode(byte);return btoa(s).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");}
function fromBase64(s){return Uint8Array.from(atob(s.replaceAll("-","+").replaceAll("_","/")),c=>c.charCodeAt(0));}
