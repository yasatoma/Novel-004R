import { normalizeSettings, parseJsonOr } from "./data-validation.js";
export const DEFAULT_SETTINGS={textSize:1,textSpeed:30,autoDelay:900,master:1,bgm:.35,ambient:.28,se:.4,reducedMotion:false,toast:true};
export class SettingsManager{
 constructor(storage,key){this.storage=storage;this.key=key;this.value=normalizeSettings(parseJsonOr(storage.getItem(key),{}),DEFAULT_SETTINGS);}
 set(key,value){this.value=normalizeSettings({...this.value,[key]:value},DEFAULT_SETTINGS);this.persist();}
 reset(){this.value={...DEFAULT_SETTINGS};this.persist();}
 persist(){this.storage.setItem(this.key,JSON.stringify(this.value));}
}
