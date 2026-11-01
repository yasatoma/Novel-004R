import { resolveContentUrl } from "./content-url.js";
import { calculateCharacterPositionOffset, calculateFaceCropPresentation, measureAlphaBounds } from "./character-crop.js";
export function rubySegments(text,map={},seen=new Set()){
  let segments=[{text:String(text),reading:null}];
  for(const [word,reading] of Object.entries(map).sort((a,b)=>b[0].length-a[0].length)){
    if(!word||seen.has(word))continue;
    for(let i=0;i<segments.length;i++){
      const segment=segments[i];
      if(segment.reading!==null)continue;
      const at=segment.text.indexOf(word);
      if(at<0)continue;
      const next=[];
      if(at>0)next.push({text:segment.text.slice(0,at),reading:null});
      next.push({text:word,reading:String(reading)});
      if(at+word.length<segment.text.length)next.push({text:segment.text.slice(at+word.length),reading:null});
      segments.splice(i,1,...next);
      seen.add(word);
      break;
    }
  }
  return segments;
}
function escapeHtml(value){return String(value).replace(/[&<>]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[char]));}
export function applyRuby(text,map={},seen=new Set()){
  return rubySegments(text,map,seen).map(segment=>segment.reading===null
    ? escapeHtml(segment.text)
    : `<ruby>${escapeHtml(segment.text)}<rt>${escapeHtml(segment.reading)}</rt></ruby>`).join("");
}
function renderRuby(target,text,map={},seen=new Set()){
  if(typeof document==="undefined"||typeof target?.replaceChildren!=="function"){target.textContent=String(text);return;}
  target.replaceChildren();
  for(const segment of rubySegments(text,map,seen)){
    if(segment.reading===null){target.append(document.createTextNode(segment.text));continue;}
    const ruby=document.createElement("ruby"),rt=document.createElement("rt");
    ruby.append(document.createTextNode(segment.text));
    rt.textContent=segment.reading;
    ruby.append(rt);
    target.append(ruby);
  }
}
export function resolveBackgroundAsset(assets, id, variant = "base") {
  const registered = assets.backgrounds?.[id];
  if (!registered) throw new Error(`background asset not registered: ${id}`);
  if (typeof registered === "string") {
    if (variant !== "base") throw new Error(`background variant not registered: ${id}/${variant}`);
    return registered;
  }
  const variants = registered.variants ?? registered;
  const file = variants?.[variant];
  if (!file) throw new Error(`background variant not registered: ${id}/${variant}`);
  return file;
}

export function resolveBackgroundPosition(assets, id) {
  const registered = assets.backgrounds?.[id];
  if (!registered || typeof registered === "string") return "50% center";
  return `${registered.position ?? 50}% center`;
}

export class Renderer {
  constructor(workRoot = "../content/", options = {}) {
    this.workRoot = workRoot;
    this.defaultCharacterPosition = options.defaultCharacterPosition ?? "right";
    this.rubySeen = new Map();
    this.currentChapterId = null;
    this.transitionTimers = [];
    this.transitionGeneration = 0;
    this.characterAlphaBounds = new Map();
    this.textAdvanceTimer = null;
    this.title = document.querySelector("#title");
    this.game = document.querySelector("#game");
    this.background = document.querySelector("#background");
    this.transition = document.querySelector("#transition-layer");
    this.comparison = document.querySelector("#comparison");
    this.speakerBox = document.querySelector("#speaker-box");
    this.speaker = document.querySelector("#speaker");
    this.textbox = document.querySelector("#textbox");
    this.chapterTitle = document.querySelector("#chapter-title");
    this.text = document.querySelector("#text");
    this.readStatus = document.querySelector("#read-status");
    this.advanceMark = document.querySelector("#advance-mark");
    this.choices = document.querySelector("#choices");
    this.notice = document.querySelector("#notice");
    this.readingArea = document.querySelector("#reading-area");
    this.locationDisplay = document.querySelector("#location-display");
    this.imageOverlay = document.querySelector("#image-overlay");
    this.imageOverlayImg = document.querySelector("#image-overlay-img");
    this.overlayScrim = document.querySelector("#overlay-scrim");
    this.chapterPresentation = document.querySelector("#chapter-presentation");
    this.chapterPresentationNumber = document.querySelector("#chapter-presentation-number");
    this.chapterPresentationTitle = document.querySelector("#chapter-presentation-title");
    this.toastLayer = document.querySelector("#toast-layer");
    this.presentationTimers = [];
    this.presentationGeneration = 0;
    this.overlayTimer = null;
    this.ending = document.querySelector("#ending");
    this.characterSlots = new Map(
      [...document.querySelectorAll("#characters img")].map(element => [element.dataset.position, element])
    );
  }

  showTitle(config, titleData = null) {
    this.clearAdvance();
    const workTitle=document.querySelector("#work-title");
    const renderTitleHtml=(target,value)=>{
      const parsed=new DOMParser().parseFromString(value,"text/html");
      const allowed=new Set(["H1","BR","SPAN"]);
      const clean=node=>{
        for(const child of [...node.childNodes]){
          if(child.nodeType===1){
            if(!allowed.has(child.tagName)){child.replaceWith(document.createTextNode(child.textContent??""));continue;}
            for(const attr of [...child.attributes])child.removeAttribute(attr.name);
            clean(child);
          }else if(child.nodeType!==3)child.remove();
        }
      };
      clean(parsed.body);target.replaceChildren(...parsed.body.childNodes);
    };
    if(titleData?.title)renderTitleHtml(workTitle,titleData.title);
    else workTitle.textContent = config.title;
    for(const [id,key] of [["title-en","title_en"],["title-catch","catch"],["title-lead","lead"],["title-quote","quote"]]){
      const el=document.querySelector("#"+id);if(!el)continue;const value=titleData?.[key]??"";
      if(key==="title_en"&&value)renderTitleHtml(el,value);else el.textContent=value.replaceAll("\\n","\n");
      el.hidden=!value;
    }
    this.title.dataset.layout = config.titleLayout ?? "left";
    const image = config.titleImage ? resolveContentUrl(this.workRoot, `images/title/${config.titleImage}`) : "";
    this.title.dataset.hasImage = image ? "true" : "false";
    this.title.style.setProperty("--title-image", image ? `url("${image}")` : "none");
    this.title.hidden = false;
    this.game.hidden = true;
  }

  startGame() {
    this.title.hidden = true;
    this.game.hidden = false;
  }

  clearTransition() {
    for (const timer of this.transitionTimers) clearTimeout(timer);
    this.transitionTimers = [];
    this.transitionGeneration++;
    if (this.transition) {
      this.transition.hidden = true;
      this.transition.className = "";
      this.transition.style.backgroundImage = "";
      this.transition.style.backgroundColor = "";
      this.transition.style.backgroundPosition = "";
      this.transition.style.backgroundSize = "";
      this.transition.style.filter = "";
      delete this.transition.dataset.effect;
      delete this.transition.dataset.active;
    }
  }

  resetPresentation() {
    this.clearAdvance();
    this.clearTransition();
    this.comparison.hidden = true;
    this.choices.hidden = true;
    this.choices.replaceChildren();
    this.ending.hidden = true;
    this.currentChapterId = null;
    this.rubySeen.clear();
    if (this.chapterTitle) this.chapterTitle.textContent = "";
    this.speaker.textContent = "";
    this.speakerBox.hidden = true;
    this.text.textContent = "";
    this.readStatus.textContent = "";
    this.background.style.backgroundImage = "";
    this.background.style.backgroundPosition = "center";
    this.background.dataset.filter = "normal";
    this.background.dataset.effect = "none";
    this.updateEffectLayer("none", "background");
    this.background.dataset.view = "full";
    if (typeof document !== "undefined") for (const outgoing of document.querySelectorAll("#characters .char-crossfade-outgoing")) outgoing.remove();
    for (const slot of this.characterSlots.values()) {
      slot.hidden = true; slot.removeAttribute("src"); delete slot.dataset.character; delete slot.dataset.hiding; slot.style.opacity = "";
      slot.style.zIndex = "";
      for (const name of ["--char-face-height","--char-face-top","--char-face-height-mobile","--char-face-top-mobile","--char-position-offset-x"]) slot.style.removeProperty(name);
    }
    this.updateVisibleCharacterCount();
    this.showTextbox(true);
    this.showLocation({action:"hide",args:{}});
    this.showOverlay({action:"hide",args:{}}, true);
    this.clearPresentationTimers();
    if (this.toastLayer) this.toastLayer.replaceChildren();
  }

  clearPresentationTimers() {
    for (const timer of this.presentationTimers ?? []) clearTimeout(timer);
    this.presentationTimers = [];
    this.presentationGeneration = (this.presentationGeneration ?? 0) + 1;
    if (this.chapterPresentation) {
      this.chapterPresentation.hidden = true;
      delete this.chapterPresentation.dataset.visible;
    }
  }

  showTextbox(visible) {
    if (this.readingArea) this.readingArea.hidden = !visible;
  }

  showLocation(command) {
    if (!this.locationDisplay) return;
    if (command.action === "hide") {
      this.locationDisplay.hidden = true;
      this.locationDisplay.textContent = "";
      return;
    }
    this.locationDisplay.textContent = command.args.text ?? "";
    this.locationDisplay.hidden = false;
  }

  showOverlay(command, immediate = false) {
    if (!this.imageOverlay || !this.overlayScrim || !this.imageOverlayImg) return;
    if (this.overlayTimer) { clearTimeout(this.overlayTimer); this.overlayTimer = null; }
    if (command.action === "hide") {
      const duration = immediate ? 0 : Number(command.args.duration_ms ?? 250);
      this.imageOverlay.style.setProperty("--overlay-ms", `${Math.max(0,duration)}ms`);
      this.overlayScrim.style.setProperty("--overlay-ms", `${Math.max(0,duration)}ms`);
      if (duration <= 0 || this.imageOverlay.hidden) {
        this.imageOverlay.hidden = true;
        this.overlayScrim.hidden = true;
        this.imageOverlayImg.removeAttribute("src");
      } else {
        this.imageOverlay.dataset.visible = "false";
        this.overlayScrim.dataset.visible = "false";
        this.overlayTimer = setTimeout(() => {
          this.imageOverlay.hidden = true;
          this.overlayScrim.hidden = true;
          this.imageOverlayImg.removeAttribute("src");
          delete this.imageOverlay.dataset.visible;
          delete this.overlayScrim.dataset.visible;
          this.overlayTimer = null;
        }, Math.max(0,duration));
      }
      return;
    }
    const duration = immediate ? 0 : Number(command.args.duration_ms ?? 250);
    this.imageOverlay.style.setProperty("--overlay-ms", `${Math.max(0,duration)}ms`);
      this.overlayScrim.style.setProperty("--overlay-ms", `${Math.max(0,duration)}ms`);
    this.imageOverlay.dataset.position = command.args.position ?? "center";
    this.imageOverlay.dataset.size = command.args.size ?? "medium";
    this.imageOverlayImg.src = resolveContentUrl(this.workRoot, `images/item/${command.args.id}.webp`);
    this.overlayScrim.hidden = false;
    this.imageOverlay.hidden = false;
    if (duration <= 0) {
      this.imageOverlay.dataset.visible = "true";
      this.overlayScrim.dataset.visible = "true";
    } else {
      this.imageOverlay.dataset.visible = "false";
      this.overlayScrim.dataset.visible = "false";
      requestAnimationFrame(() => {
        if (!this.imageOverlay.hidden) this.imageOverlay.dataset.visible = "true";
        if (!this.overlayScrim.hidden) this.overlayScrim.dataset.visible = "true";
      });
    }
  }

  showChapterPresentation(command, reducedMotion = false) {
    if (!this.chapterPresentation) return;
    this.clearPresentationTimers();
    const generation = this.presentationGeneration;
    const fade = reducedMotion ? 0 : Number(command.args.duration_ms ?? 450);
    const hold = Number(command.args.hold_ms ?? 1400);
    this.chapterPresentationNumber.textContent = command.args.chapter ?? "";
    this.chapterPresentationTitle.textContent = command.args.title ?? "";
    this.chapterPresentation.style.setProperty("--chapter-fade-ms", `${Math.max(0,fade)}ms`);
    this.chapterPresentation.hidden = false;
    // Commit the initial opacity before toggling visibility so the browser
    // cannot collapse both states into one frame and skip the fade-in.
    void this.chapterPresentation.offsetWidth;
    requestAnimationFrame(()=>{ if(generation===this.presentationGeneration) this.chapterPresentation.dataset.visible="true"; });
    this.presentationTimers.push(setTimeout(()=>{
      if(generation!==this.presentationGeneration)return;
      delete this.chapterPresentation.dataset.visible;
      this.presentationTimers.push(setTimeout(()=>{
        if(generation!==this.presentationGeneration)return;
        this.chapterPresentation.hidden=true;
      },fade));
    },fade+Math.max(0,hold)));
  }

  showToast(text, duration = 1800) {
    if (!this.toastLayer) return;
    const item=document.createElement("div");
    item.className="engine-toast";
    item.textContent=String(text);
    this.toastLayer.append(item);
    setTimeout(()=>item.remove(),duration);
  }

  showCharacterBook(snapshot = {}) {
    const root=document.querySelector("#character-book");
    const nav=document.querySelector("#character-book-nav");
    const portrait=document.querySelector("#character-book-portrait");
    const ruby=document.querySelector("#character-book-ruby");
    const name=document.querySelector("#character-book-name");
    const text=document.querySelector("#character-book-text");
    const count=document.querySelector("#character-book-count");
    const prev=document.querySelector("#character-book-prev");
    const next=document.querySelector("#character-book-next");
    if(!root||!nav||!portrait||!ruby||!name||!text||!count||!prev||!next)return;
    const entries=Object.entries(snapshot);
    nav.replaceChildren();
    if(!entries.length){portrait.removeAttribute("src");portrait.alt="";ruby.textContent="";name.textContent="";text.textContent="人物情報はまだありません。";count.textContent="";prev.hidden=true;next.hidden=true;return;}
    let index=0,touchX=null;
    const select=nextIndex=>{
      index=(nextIndex+entries.length)%entries.length;
      const [,entry]=entries[index];
      const source=resolveContentUrl(this.workRoot,`images/char/${entry.image}`);
      portrait.src=source;
      portrait.alt=entry.name??"";
      portrait.style.removeProperty("height");
      portrait.style.removeProperty("width");
      portrait.style.removeProperty("max-width");
      portrait.style.removeProperty("transform");
      const applyPortraitBounds=bounds=>{
        if(!bounds||portrait.src!==source)return;
        const height=Math.max(.01,Math.min(1,Number(bounds.height)||1));
        const bottom=Math.max(0,1-(Number(bounds.top)||0)-height);
        portrait.style.height=`${100/height}%`;
        portrait.style.width="auto";
        portrait.style.maxWidth="none";
        portrait.style.transform=`translateY(${bottom*100}%)`;
      };
      const cached=this.characterAlphaBounds.get(source);
      if(cached)applyPortraitBounds(cached);
      else {
        const measure=()=>{
          if(portrait.src!==source)return;
          try{
            const bounds=measureAlphaBounds(portrait);
            if(!bounds)return;
            this.characterAlphaBounds.set(source,bounds);
            applyPortraitBounds(bounds);
          }catch{}
        };
        if(portrait.complete&&portrait.naturalWidth)queueMicrotask(measure);
        else portrait.addEventListener("load",measure,{once:true});
      }
      ruby.textContent=entry.ruby??"";
      name.textContent=entry.name??"";
      text.textContent=entry.text??"";
      count.textContent=`${index+1} / ${entries.length}`;
      [...nav.children].forEach((button,i)=>{button.classList.toggle("active",i===index);button.setAttribute("aria-current",i===index?"true":"false");});
    };
    for(const [,entry] of entries){const button=document.createElement("button");button.type="button";button.textContent=entry.name??"";button.onclick=()=>select([...nav.children].indexOf(button));nav.append(button);}
    prev.hidden=next.hidden=entries.length<2;prev.onclick=()=>select(index-1);next.onclick=()=>select(index+1);
    root.onkeydown=e=>{if(e.key==="ArrowLeft"){e.preventDefault();select(index-1);}else if(e.key==="ArrowRight"){e.preventDefault();select(index+1);}};
    root.ontouchstart=e=>{touchX=e.changedTouches?.[0]?.clientX??null;};
    root.ontouchend=e=>{if(touchX===null)return;const x=e.changedTouches?.[0]?.clientX??touchX,delta=x-touchX;touchX=null;if(Math.abs(delta)>=48)select(index+(delta<0?1:-1));};
    select(0);
  }

  showChapter(command) {
    if (this.chapterTitle) this.chapterTitle.textContent = command.args.title || "章";
    this.currentChapterId=command.args.id;if(!this.rubySeen.has(command.args.id))this.rubySeen.set(command.args.id,new Set());
  }

  restoreChapterContext(chapterId, title, seenWords = []) {
    this.currentChapterId = chapterId ?? null;
    if (this.chapterTitle) this.chapterTitle.textContent = chapterId ? (title || "章") : "";
    this.rubySeen.clear();
    if (chapterId) this.rubySeen.set(chapterId, new Set(seenWords));
  }

  exportRubySeenState() {
    return Object.fromEntries([...this.rubySeen].map(([chapterId,words])=>[chapterId,[...words]]));
  }

  bringSpeakingCharacterToFront(characterId) {
    if (!characterId) return;
    const speakingSlot = [...this.characterSlots.values()].find(slot => !slot.hidden && slot.dataset.character === characterId);
    if (!speakingSlot) return;
    for (const slot of this.characterSlots.values()) slot.style.zIndex = slot === speakingSlot ? "2" : "";
  }

  showText(command, next, options = {}) {
    this.showTextbox(true);
    if (this.textAdvanceTimer !== null) { clearTimeout(this.textAdvanceTimer); this.textAdvanceTimer = null; }
    if (command.args.speaker !== "MOB") this.bringSpeakingCharacterToFront(command.args.speaker);
    const narration = command.args.speaker === "narration";
    const speaker = options.speaker ?? {};
    this.speaker.textContent = narration ? "" : (speaker.name ?? "話者不明");
    this.speakerBox.hidden = narration;
    this.speakerBox.style.setProperty("--speaker-color", narration ? "#9aa5a5" : (speaker.color ?? "#d1b884"));
    this.textbox.style.setProperty("--speaker-color", narration ? "#9aa5a5" : (speaker.color ?? "#d1b884"));
    renderRuby(this.text, command.text, options.rubyMap ?? {}, this.rubySeen.get(this.currentChapterId) ?? new Set());
    this.readStatus.textContent = options.wasRead ? "既読" : "未読";
    this.advanceMark.hidden = false;
    let advanced = false;
    const advanceOnce = () => {
      if (advanced) return;
      advanced = true;
      if (this.textAdvanceTimer !== null) { clearTimeout(this.textAdvanceTimer); this.textAdvanceTimer = null; }
      next();
    };
    this.textbox.onclick = event => {
      if (event.target.closest("button")) return;
      advanceOnce();
    };
    if (options.auto) this.textAdvanceTimer = setTimeout(advanceOnce, options.autoDelay ?? 900);
  }

  clearAdvance() {
    if (this.textAdvanceTimer !== null) { clearTimeout(this.textAdvanceTimer); this.textAdvanceTimer = null; }
    this.textbox.onclick = null;
    this.advanceMark.hidden = true;
  }

  restore(state, assets) {
    this.resetPresentation();
    this.startGame();
    if (state.currentBackground) this.showBackground({ action:"show", args:{
      id:state.currentBackground,
      image:state.currentBackgroundImage ?? "base",
      filter:state.currentBackgroundFilter ?? "normal",
      effect:state.currentBackgroundEffect ?? "none",
      effect_layer:state.currentBackgroundEffectLayer ?? "background",
      view:state.currentBackgroundView ?? "full"
    } }, assets);
    for (const [position, character] of Object.entries(state.visibleCharacters ?? {})) {
      this.showCharacter({ action:"show", args:{ id:character.id, expression:character.expression, position, crop:character.crop ?? "bust" } }, assets);
    }
    if (state.currentComparison) this.showComparison({ action:"show", args:state.currentComparison }, assets);
    else this.comparison.hidden = true;
    if (state.currentLocationText) this.showLocation({action:"show",args:{text:state.currentLocationText}}); else this.showLocation({action:"hide",args:{}});
    if (state.currentOverlay) this.showOverlay({action:"show",args:state.currentOverlay}, true); else this.showOverlay({action:"hide",args:{}}, true);
  }

  showBacklog(entries, rubyMap = {}, characters = {}) {
    const list=document.querySelector("#backlog-list"); list.replaceChildren();
    for(const entry of entries){
      const article=document.createElement("article"); article.className="log-item";
      const speakerName = entry.speaker === "narration" ? "" : (entry.speakerName ?? characters?.[entry.speaker]?.name ?? "話者不明");
      if(speakerName) article.append(document.createTextNode(speakerName+"："));
      const body=document.createElement("span"); renderRuby(body,entry.text,rubyMap,new Set()); article.append(body);
      list.append(article);
    }
    const backlog=document.querySelector("#backlog");
    backlog.hidden=false;
    const scrollTarget=document.querySelector("#backlog-list");
    requestAnimationFrame(()=>{ scrollTarget.scrollTop=scrollTarget.scrollHeight; });
  }

  showRecords(ids, memos) {
    const list=document.querySelector("#records-list"); list.replaceChildren();
    if (!ids.length) {
      const p=document.createElement("p"); p.className="panel-note"; p.textContent="まだ記録はありません。"; list.append(p);
    }
    for (const id of ids) {
      const memo=memos[id]; if(!memo) continue;
      const article=document.createElement("article"); article.className="record-card";
      const h=document.createElement("h3"); h.textContent=memo.title || "記録";
      const p=document.createElement("p"); p.textContent=memo.text ?? "";
      article.append(h,p); list.append(article);
    }
    document.querySelector("#records-count").textContent=String(ids.length);
    document.querySelector("#records").hidden=false;
  }

  updateEffectLayer(effect, layer) {
    this.background.dataset.effectLayer = layer;
    if (layer === "foreground" && effect !== "none" && !this.foregroundEffect) {
      this.foregroundEffect = document.createElement("div");
      this.foregroundEffect.className = "presentation-effect-layer";
      this.foregroundEffect.setAttribute("aria-hidden", "true");
      this.game.append(this.foregroundEffect);
    }
    if (this.foregroundEffect) {
      this.foregroundEffect.dataset.effect = effect;
      this.foregroundEffect.hidden = layer !== "foreground" || effect === "none";
    }
  }

  showBackground(command, assets, done) {
    this.clearTransition();
    const clearBackground = () => {
      this.background.style.backgroundImage = "";
      this.background.style.backgroundPosition = "center";
      this.background.dataset.filter = "normal";
      this.background.dataset.effect = "none";
      this.updateEffectLayer("none", "background");
      this.background.dataset.view = "full";
    };
    if (command.action === "hide") {
      const transition = command.args?.transition ?? "cut";
      const duration = Number(command.args?.duration_ms ?? 0);
      if (transition === "cut" || duration <= 0 || !this.transition || !this.background.style.backgroundImage) {
        clearBackground();
        done?.();
        return;
      }
      const layer = this.transition;
      const generation = this.transitionGeneration;
      layer.hidden = false;
      layer.dataset.transition = transition;
      layer.style.setProperty("--transition-ms", `${duration}ms`);
      layer.style.backgroundColor = "";
      layer.style.backgroundImage = this.background.style.backgroundImage;
      layer.style.backgroundPosition = getComputedStyle(this.background).backgroundPosition;
      layer.style.backgroundSize = getComputedStyle(this.background).backgroundSize;
      layer.style.filter = getComputedStyle(this.background).filter;
      layer.dataset.effect = this.background.dataset.effect ?? "none";
      layer.className = "transition-crossfade";
      clearBackground();
      // Force the initial opacity:1 state to be committed before starting
      // the transition. A single requestAnimationFrame can be coalesced by
      // the browser and skip the visible fade entirely.
      void layer.offsetWidth;
      requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (generation === this.transitionGeneration) layer.dataset.active = "true";
      });
    });
      this.transitionTimers.push(setTimeout(() => {
        if (generation !== this.transitionGeneration) return;
        this.transitionTimers = [];
        layer.hidden = true;
        layer.className = "";
        layer.style.backgroundImage = "";
        layer.style.backgroundPosition = "";
        layer.style.backgroundSize = "";
        layer.style.filter = "";
        delete layer.dataset.effect;
        delete layer.dataset.active;
        done?.();
      }, duration));
      return;
    }
    const file = resolveBackgroundAsset(assets, command.args.id, command.args.image ?? "base");
    const apply = () => {
      const backgroundUrl = resolveContentUrl(this.workRoot, `images/bg/${file}`);
      this.background.style.backgroundImage = `url("${backgroundUrl}")`;
      this.background.style.backgroundPosition = resolveBackgroundPosition(assets, command.args.id);
      this.background.dataset.filter = command.args.filter ?? "normal";
      this.background.dataset.effect = command.args.effect ?? "none";
      this.updateEffectLayer(command.args.effect ?? "none", command.args.effect_layer ?? "background");
      this.background.dataset.view = command.args.view ?? "full";
    };
    const transition = command.args.transition ?? "cut";
    const duration = Number(command.args.duration_ms ?? 0);
    if (transition === "cut" || duration <= 0 || !this.transition) { apply(); done?.(); return; }
    const layer = this.transition;
    const generation = this.transitionGeneration;
    layer.hidden = false;
    layer.dataset.transition = transition;
    layer.style.setProperty("--transition-ms", `${duration}ms`);
    if (transition === "blackfade") {
      layer.style.backgroundImage = "";
      layer.style.backgroundColor = "#000";
      layer.className = "transition-blackfade";
      this.transitionTimers.push(setTimeout(() => { if (generation === this.transitionGeneration) apply(); }, duration / 2));
    } else if (transition === "fade") {
      // Fade means the incoming background itself fades in. This also works
      // when there is no outgoing background (for example after @bg hide).
      apply();
      layer.style.backgroundColor = "";
      layer.style.backgroundImage = this.background.style.backgroundImage;
      layer.style.backgroundPosition = getComputedStyle(this.background).backgroundPosition;
      layer.style.backgroundSize = getComputedStyle(this.background).backgroundSize;
      layer.style.filter = getComputedStyle(this.background).filter;
      layer.dataset.effect = this.background.dataset.effect ?? "none";
      layer.className = "transition-fade-in";
      this.background.style.backgroundImage = "";
    } else {
      layer.style.backgroundColor = "";
      layer.style.backgroundImage = this.background.style.backgroundImage;
      layer.style.backgroundPosition = getComputedStyle(this.background).backgroundPosition;
      layer.style.backgroundSize = getComputedStyle(this.background).backgroundSize;
      layer.style.filter = getComputedStyle(this.background).filter;
      layer.dataset.effect = this.background.dataset.effect ?? "none";
      layer.className = "transition-crossfade";
      apply();
    }
    // Commit the initial opacity before toggling the active state so the
    // browser cannot collapse both states into one frame and skip the fade.
    void layer.offsetWidth;
    if (transition === "fade") layer.classList.add("transition-ready");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (generation === this.transitionGeneration) layer.dataset.active = "true";
      });
    });
    this.transitionTimers.push(setTimeout(() => {
      if (generation !== this.transitionGeneration) return;
      this.transitionTimers = [];
      if (transition === "fade" && command.action === "show") apply();
      layer.hidden = true;
      layer.className = "";
      layer.style.backgroundImage = "";
      layer.style.backgroundColor = "";
      layer.style.backgroundPosition = "";
      layer.style.backgroundSize = "";
      layer.style.filter = "";
      delete layer.dataset.effect;
      delete layer.dataset.active;
      done?.();
    }, duration));
  }

  showComparison(command, assets) {
    if (command.action === "hide") { this.comparison.hidden = true; return; }
    const resolve = (id, image) => resolveContentUrl(this.workRoot, `images/bg/${resolveBackgroundAsset(assets, id, image ?? "base")}`);
    document.querySelector("#compare-left").style.backgroundImage = `url("${resolve(command.args.left_id, command.args.left_image)}")`;
    document.querySelector("#compare-right").style.backgroundImage = `url("${resolve(command.args.right_id, command.args.right_image)}")`;
    this.comparison.hidden = false;
  }

  updateVisibleCharacterCount() {
    const count = [...this.characterSlots.values()].filter(slot => !slot.hidden).length;
    const characters = this.characterSlots.values().next().value?.parentElement;
    if (characters) characters.dataset.visibleCount = String(count);
  }

  showCharacter(command, assets) {
    if (command.action === "hide") {
      for (const slot of this.characterSlots.values()) {
        if (command.args.id === "ALL" ? !slot.hidden : slot.dataset.character === command.args.id) {
          const duration = Number(command.args.duration_ms ?? 0);
          slot.style.setProperty("--char-fade-ms", `${duration}ms`);
          if (duration > 0) {
            slot.dataset.hiding = "true";
            slot.style.opacity = "0";
            setTimeout(() => {
              if (slot.dataset.hiding !== "true") return;
              slot.hidden = true; slot.removeAttribute("src"); delete slot.dataset.character; delete slot.dataset.hiding; slot.style.opacity = "";
              this.updateVisibleCharacterCount();
            }, duration);
          } else {
            slot.hidden = true; slot.removeAttribute("src"); delete slot.dataset.character;
            this.updateVisibleCharacterCount();
          }
        }
      }
      return;
    }
    const position = command.args.position ?? (command.action === "show" ? this.defaultCharacterPosition : this.findCharacterPosition(command.args.id));
    const slot = this.characterSlots.get(position);
    if (!slot) throw new Error(`unknown character position: ${position}`);
    const character = assets.characters?.[command.args.id];
    const file = character?.expressions?.[command.args.expression];
    if (!file) throw new Error(`character asset not registered: ${command.args.id}/${command.args.expression}`);
    delete slot.dataset.hiding;
    const duration = Number(command.args.duration_ms ?? 0);
    const source = resolveContentUrl(this.workRoot, `images/char/${file}`);
    const replacing = command.action === "show" && !slot.hidden && !!slot.getAttribute("src") && slot.dataset.character !== command.args.id;
    let outgoing = null;
    if (replacing && duration > 0) {
      outgoing = slot.cloneNode(false);
      outgoing.removeAttribute("id");
      outgoing.classList.add("char-crossfade-outgoing");
      outgoing.removeAttribute("aria-label");
      outgoing.alt = "";
      outgoing.style.pointerEvents = "none";
      outgoing.style.setProperty("--char-fade-ms", `${duration}ms`);
      slot.parentElement?.append(outgoing);
      requestAnimationFrame(() => { outgoing.style.opacity = "0"; });
      setTimeout(() => outgoing.remove(), duration);
    }
    slot.src = source;
    slot.alt = character.name || "登場人物";
    slot.dataset.character = command.args.id;
    if (command.args.crop !== undefined || command.action === "show") slot.dataset.crop = command.args.crop ?? "bust";
    this.prepareCharacterCrop(slot, source);
    slot.style.setProperty("--char-fade-ms", `${duration}ms`);
    if (duration > 0) {
      slot.style.opacity = "0";
      slot.hidden = false;
      requestAnimationFrame(() => { if (slot.dataset.character === command.args.id) slot.style.opacity = "1"; });
    } else {
      slot.style.opacity = "";
      slot.hidden = false;
    }
    this.updateVisibleCharacterCount();
  }

  prepareCharacterCrop(slot, source) {
    for (const name of ["--char-face-height","--char-face-top","--char-face-height-mobile","--char-face-top-mobile"]) slot.style.removeProperty(name);
    const apply = bounds => {
      if (!bounds || slot.src !== source) return;
      const offset = calculateCharacterPositionOffset(bounds, slot.dataset.position);
      slot.style.setProperty("--char-position-offset-x", `${offset}%`);
      if (slot.dataset.crop !== "face") return;
      const presentation = calculateFaceCropPresentation(bounds);
      slot.style.setProperty("--char-face-height", `${presentation.desktop.imageHeightVh}vh`);
      slot.style.setProperty("--char-face-top", `${presentation.desktop.imageTopVh}vh`);
      slot.style.setProperty("--char-face-height-mobile", `${presentation.mobile.imageHeightVh}dvh`);
      slot.style.setProperty("--char-face-top-mobile", `${presentation.mobile.imageTopVh}dvh`);
    };
    const cached = this.characterAlphaBounds.get(source);
    if (cached) { apply(cached); return; }
    const measure = () => {
      if (slot.src !== source) return;
      try {
        const bounds = measureAlphaBounds(slot);
        if (!bounds) return;
        this.characterAlphaBounds.set(source, bounds);
        apply(bounds);
      } catch {
        // Keep the CSS fallback preset if pixel inspection is unavailable.
      }
    };
    if (slot.complete && slot.naturalWidth) queueMicrotask(measure);
    else slot.addEventListener("load", measure, { once:true });
  }

  findCharacterPosition(id) {
    for (const [position, slot] of this.characterSlots) if (slot.dataset.character === id) return position;
    throw new Error(`character is not visible: ${id}`);
  }

  showMemo(command, memos) {
    const memo = memos[command.args.id];
    if (!memo) throw new Error(`memo not registered: ${command.args.id}`);
    // Unlock state is owned by Runner; the record screen reads state.unlockedMemoIds.
  }

  showEnding(command, endings, toTitle) {
    const ending = endings[command.args.id];
    if (!ending) throw new Error(`ending not registered: ${command.args.id}`);
    this.clearAdvance();
    document.querySelector("#ending-title").textContent = ending.title || "エンディング";
    document.querySelector("#ending-text").textContent = ending.text ?? "";
    this.ending.hidden = false;
    document.querySelector("#ending-title-button").onclick = () => { this.ending.hidden = true; toTitle(); };
  }

  showChoice(_command, options, select) {
    this.clearAdvance();
    const readingArea=document.querySelector("#reading-area");
    if(readingArea&&this.game){
      const gameRect=this.game.getBoundingClientRect();
      const readingRect=readingArea.getBoundingClientRect();
      this.choices.style.bottom=`${Math.max(0,gameRect.bottom-readingRect.top+80)}px`;
    }
    this.choices.replaceChildren();
    let selected = false;
    for (const option of options) {
      const button = document.createElement("button");
      button.type = "button"; button.textContent = option.args.text;
      button.onclick = () => {
        if (selected) return;
        selected = true;
        for (const choice of this.choices.querySelectorAll("button")) choice.disabled = true;
        this.choices.hidden = true;
        this.choices.replaceChildren();
        select(option);
      };
      this.choices.append(button);
    }
    this.choices.hidden = false;
  }
}
