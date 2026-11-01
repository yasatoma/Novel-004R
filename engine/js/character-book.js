const displayEntry=entry=>({name:entry?.name??"",ruby:entry?.ruby??"",image:entry?.image??"",text:entry?.text??""});

export function characterBookSnapshot(characters,chapterId,unlockedIds=[]){
  const initial=characters?.initial??{};
  const chapter=chapterId?characters?.[chapterId]??{}:{};
  const unlocked=new Set(Array.isArray(unlockedIds)?unlockedIds:[]);
  const entries={};
  for(const [id,base] of Object.entries(initial)){
    if(!unlocked.has(id))continue;
    entries[id]=displayEntry({...base,...(chapter?.[id]??{})});
  }
  return entries;
}

export function characterBookSnapshotChanged(characters,unlockedIds,fromId,toId){
  if(!fromId||!toId||fromId===toId)return false;
  return JSON.stringify(characterBookSnapshot(characters,fromId,unlockedIds))!==JSON.stringify(characterBookSnapshot(characters,toId,unlockedIds));
}

export function characterBookUnlocksAtResume(characters,commands,state,resumeIndex){
  const ids=new Set(Object.keys(characters?.initial??{}));
  if(Array.isArray(state?.unlockedCharacterIds))return state.unlockedCharacterIds.filter(id=>ids.has(id));
  const unlocked=[];
  const seen=new Set();
  const limit=Math.max(0,Math.min(Number(resumeIndex)||0,commands?.length??0));
  for(let index=0;index<limit;index++){
    const command=commands[index];
    if(command?.type!=="text"||command?.action!=="show")continue;
    const id=command.args?.speaker;
    if(!ids.has(id)||seen.has(id))continue;
    seen.add(id);
    unlocked.push(id);
  }
  return unlocked;
}
