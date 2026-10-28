const displayEntry=entry=>({visible:!!entry?.visible,name:entry?.name??"",image:entry?.image??"",text:entry?.text??""});
const displaySnapshot=snapshot=>Object.fromEntries(Object.entries(snapshot??{}).map(([id,entry])=>[id,displayEntry(entry)]));

export function characterBookSnapshotChanged(characters,fromId,toId){
  if(!fromId||!toId||fromId===toId)return false;
  return JSON.stringify(displaySnapshot(characters?.[fromId]))!==JSON.stringify(displaySnapshot(characters?.[toId]));
}
