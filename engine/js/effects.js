const ALLOWED=new Set(["shake","flash","fade","mist","blackfade"]);
export class EffectManager{
 constructor(root,settings){this.root=root;this.settings=settings;this.timer=null;this.generation=0;}
 clearTimer(){if(this.timer!==null){clearTimeout(this.timer);this.timer=null;}this.generation++;}
 reset(){this.clearTimer();for(const id of ALLOWED)this.root.classList.remove(`effect-${id}`);delete this.root.dataset.effectStrength;this.root.style.removeProperty("--effect-duration");}
 handle(command,done){
  const id=command.args.id;
  if(!ALLOWED.has(id))throw new Error(`unknown effect: ${id}`);
  this.clearTimer();
  if(this.settings().reducedMotion){done?.();return;}
  const cls=`effect-${id}`;
  if(command.action==="stop"){this.root.classList.remove(cls);delete this.root.dataset.effectStrength;done?.();return;}
  for(const effectId of ALLOWED)this.root.classList.remove(`effect-${effectId}`);
  void this.root.offsetWidth;this.root.classList.add(cls);
  const duration=Number(command.args.duration_ms ?? 700),generation=this.generation;
  this.root.style.setProperty("--effect-duration",`${duration}ms`);
  this.root.dataset.effectStrength=command.args.strength ?? "";
  this.timer=setTimeout(()=>{
   if(generation!==this.generation)return;
   this.timer=null;
   this.root.classList.remove(cls);
   delete this.root.dataset.effectStrength;
   done?.();
  },duration);
 }
}
