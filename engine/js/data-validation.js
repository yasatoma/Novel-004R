export function parseJsonOr(value, fallback) {
  if (typeof value !== "string") return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function isPlainRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function normalizeSettings(raw, defaults) {
  const source = isPlainRecord(raw) ? raw : {};
  const clamp = (value, min, max, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  return {
    textSize: clamp(source.textSize, .8, 1.5, defaults.textSize),
    textSpeed: clamp(source.textSpeed, 0, 80, defaults.textSpeed),
    autoDelay: clamp(source.autoDelay, 300, 3000, defaults.autoDelay),
    master: clamp(source.master, 0, 1, defaults.master),
    bgm: clamp(source.bgm, 0, 1, defaults.bgm),
    ambient: clamp(source.ambient, 0, 1, defaults.ambient),
    se: clamp(source.se, 0, 1, defaults.se),
    reducedMotion: typeof source.reducedMotion === "boolean" ? source.reducedMotion : defaults.reducedMotion,
    toast: typeof source.toast === "boolean" ? source.toast : defaults.toast
  };
}

export function normalizeStringArray(value, maxItems = 10000) {
  if (!Array.isArray(value)) return [];
  return value.filter(item => typeof item === "string").slice(0, maxItems);
}

function optionalString(value) {
  return value == null || typeof value === "string";
}

function validFlags(value) {
  if (!isPlainRecord(value)) return false;
  return Object.values(value).every(v => ["string","number","boolean"].includes(typeof v) || v === null);
}

function validVisibleCharacters(value) {
  if (!isPlainRecord(value)) return false;
  return Object.values(value).every(entry =>
    isPlainRecord(entry) &&
    typeof entry.id === "string" &&
    typeof entry.expression === "string" &&
    (entry.crop === undefined || ["bust","face"].includes(entry.crop))
  );
}

function validComparison(value) {
  if (value === null) return true;
  if (!isPlainRecord(value)) return false;
  return ["left_id","left_image","right_id","right_image"].every(key => value[key] === undefined || typeof value[key] === "string");
}

function validOverlay(value) {
  if (value === null) return true;
  return isPlainRecord(value) &&
    typeof value.id === "string" && /^I\d{3}$/.test(value.id) &&
    ["left","center","right"].includes(value.position) &&
    ["small","medium","large"].includes(value.size) &&
    Object.keys(value).every(key => ["id","position","size"].includes(key));
}

function validRubySeen(value) {
  if (!isPlainRecord(value)) return false;
  return Object.values(value).every(words => Array.isArray(words) && words.every(word => typeof word === "string"));
}

function validBacklog(value) {
  if (!Array.isArray(value)) return false;
  return value.every(entry =>
    isPlainRecord(entry) &&
    typeof entry.text === "string" &&
    typeof entry.speaker === "string" &&
    optionalString(entry.speakerName) &&
    optionalString(entry.id)
  );
}

export function assertValidSaveState(state) {
  if (!isPlainRecord(state)) throw new Error("Save state invalid");
  if ("currentBackgroundEffectLayer" in state && !["background","foreground"].includes(state.currentBackgroundEffectLayer)) throw new Error("Save state invalid: currentBackgroundEffectLayer");
  validateResumeFields(state);
  const nullableStrings = ["currentChapterId","currentSceneId","currentTextId","currentBackground","currentBackgroundImage","currentBackgroundFilter","currentBackgroundEffect","currentBackgroundEffectLayer","currentBackgroundView","currentBgm","currentAmbient","currentLocationText","currentChoiceId"];
  for (const key of nullableStrings) if (key in state && !optionalString(state[key])) throw new Error(`Save state invalid: ${key}`);
  for (const key of ["currentCommandIndex"]) {
    if (key in state && (!Number.isInteger(state[key]) || state[key] < 0)) throw new Error(`Save state invalid: ${key}`);
  }
  for (const key of ["unlockedMemoIds","trail","reachedEndingIds","currentBackgroundEffects"]) {
    if (key in state && (!Array.isArray(state[key]) || !state[key].every(v => typeof v === "string"))) throw new Error(`Save state invalid: ${key}`);
  }
  if ("flags" in state && !validFlags(state.flags)) throw new Error("Save state invalid: flags");
  if ("visibleCharacters" in state && !validVisibleCharacters(state.visibleCharacters)) throw new Error("Save state invalid: visibleCharacters");
  if ("backlog" in state && !validBacklog(state.backlog)) throw new Error("Save state invalid: backlog");
  if ("currentComparison" in state && !validComparison(state.currentComparison)) throw new Error("Save state invalid: currentComparison");
  if ("currentBgmVolume" in state && (!Number.isFinite(Number(state.currentBgmVolume)) || Number(state.currentBgmVolume) < 0 || Number(state.currentBgmVolume) > 1)) throw new Error("Save state invalid: currentBgmVolume");
  if ("currentAmbientVolume" in state && (!Number.isFinite(Number(state.currentAmbientVolume)) || Number(state.currentAmbientVolume) < 0 || Number(state.currentAmbientVolume) > 1)) throw new Error("Save state invalid: currentAmbientVolume");
  if ("currentOverlay" in state && !validOverlay(state.currentOverlay)) throw new Error("Save state invalid: currentOverlay");
  if ("rubySeenByChapter" in state && !validRubySeen(state.rubySeenByChapter)) throw new Error("Save state invalid: rubySeenByChapter");
  return state;
}

export function assertValidTransferPayload(data) {
  if (!isPlainRecord(data) || !isPlainRecord(data.state) || !Array.isArray(data.readIds)) throw new Error("Transfer payload invalid");
  const state = data.state;
  validateResumeFields(state);
  if ("currentBackgroundEffectLayer" in state && !["background","foreground"].includes(state.currentBackgroundEffectLayer)) throw new Error("Transfer payload invalid: currentBackgroundEffectLayer");
  const allowed = new Set(["currentResumePoint","scenarioRevision","currentChoiceId","currentChapterId","currentSceneId","currentCommandIndex","currentTextId","flags","unlockedMemoIds","trail","reachedEndingIds","visibleCharacters","currentBackground","currentBackgroundImage","currentBackgroundFilter","currentBackgroundEffect","currentBackgroundEffectLayer","currentBackgroundView","currentComparison","currentBgm","currentBgmVolume","currentAmbient","currentAmbientVolume","currentLocationText","currentOverlay","rubySeenByChapter"]);
  if (Object.keys(state).some(key => !allowed.has(key))) throw new Error("Transfer payload invalid: unknown state key");
  for (const key of ["currentChapterId","currentSceneId","currentTextId","currentBackground","currentBackgroundImage","currentBackgroundFilter","currentBackgroundEffect","currentBackgroundEffectLayer","currentBackgroundView","currentBgm","currentAmbient","currentLocationText"]) if (key in state && !optionalString(state[key])) throw new Error(`Transfer payload invalid: ${key}`);
  if ("currentCommandIndex" in state && (!Number.isInteger(state.currentCommandIndex) || state.currentCommandIndex < 0)) throw new Error("Transfer payload invalid: currentCommandIndex");
  if ("flags" in state && !validFlags(state.flags)) throw new Error("Transfer payload invalid: flags");
  if ("visibleCharacters" in state && !validVisibleCharacters(state.visibleCharacters)) throw new Error("Transfer payload invalid: visibleCharacters");
  if ("currentComparison" in state && !validComparison(state.currentComparison)) throw new Error("Transfer payload invalid: currentComparison");
  if ("currentBgmVolume" in state && (!Number.isFinite(Number(state.currentBgmVolume)) || Number(state.currentBgmVolume) < 0 || Number(state.currentBgmVolume) > 1)) throw new Error("Transfer payload invalid: currentBgmVolume");
  if ("currentAmbientVolume" in state && (!Number.isFinite(Number(state.currentAmbientVolume)) || Number(state.currentAmbientVolume) < 0 || Number(state.currentAmbientVolume) > 1)) throw new Error("Transfer payload invalid: currentAmbientVolume");
  if ("currentOverlay" in state && !validOverlay(state.currentOverlay)) throw new Error("Transfer payload invalid: currentOverlay");
  if ("rubySeenByChapter" in state && !validRubySeen(state.rubySeenByChapter)) throw new Error("Transfer payload invalid: rubySeenByChapter");
  for (const key of ["unlockedMemoIds","trail","reachedEndingIds"]) {
    if (key in state && (!Array.isArray(state[key]) || !state[key].every(v => typeof v === "string"))) throw new Error(`Transfer payload invalid: ${key}`);
  }
  if (!data.readIds.every(v => typeof v === "string")) throw new Error("Transfer payload invalid: readIds");
  return data;
}

function validateResumeFields(state) {
  if (state.scenarioRevision !== undefined && typeof state.scenarioRevision !== "string") throw new Error("Invalid scenarioRevision");
  if (state.currentChoiceId !== undefined && !optionalString(state.currentChoiceId)) throw new Error("Invalid currentChoiceId");
  const anchor=state.currentResumePoint;
  if (anchor != null && (!isPlainRecord(anchor) || !["text","scene","choice","ending"].includes(anchor.type) || typeof anchor.id !== "string" || !anchor.id || Object.keys(anchor).some(k=>!["type","id"].includes(k)))) throw new Error("Invalid currentResumePoint");
}
