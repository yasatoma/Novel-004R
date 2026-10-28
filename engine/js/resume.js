import { createGameState } from "./state.js";
import { Runner } from "./runner.js";
import { commandAnchor, scenarioRevision } from "./scenario-identity.js";

function findAnchor(commands, anchor) {
  if (!anchor) return -1;
  return commands.findIndex(c => {
    const candidate = commandAnchor(c);
    return candidate?.type === anchor.type && candidate?.id === anchor.id;
  });
}

export function resolveResumeIndex(commands, data = {}, state = {}) {
  const ending = state.reachedEndingIds?.at(-1);
  const candidates = [
    ending && {type:"ending",id:ending},
    state.currentResumePoint,
    state.currentChoiceId && {type:"choice",id:state.currentChoiceId},
    state.currentTextId && {type:"text",id:state.currentTextId}
  ];
  for (const anchor of candidates) {
    const index = findAnchor(commands, anchor);
    if (index < 0) continue;
    // Legacy scene autosaves may still contain the preceding scene's text ID.
    if (anchor?.type === "text" && !state.currentResumePoint && state.currentSceneId) {
      let scene = null;
      for (let i = 0; i <= index; i++) {
        if (commands[i].type === "scene" && commands[i].action === "start") scene = commands[i].args.id;
      }
      if (scene !== state.currentSceneId) continue;
    }
    return index;
  }
  const scene = findAnchor(commands, {type:"scene",id:state.currentSceneId});
  if (scene >= 0) return scene;
  const chapter = commands.findIndex(c => c.type === "chapter" && c.action === "start" && c.args.id === state.currentChapterId);
  if (chapter >= 0) return chapter;
  // ID-less historical saves have no better anchor. Retain their bounded index.
  const raw = Number.isInteger(data.resumeCommandIndex) ? data.resumeCommandIndex :
    (Number.isInteger(state.currentCommandIndex) ? state.currentCommandIndex : 0);
  return Math.max(0, Math.min(raw, commands.length));
}

// Reconstruct presentation without replaying text, choices, flags or audio.
export function prepareResumeState(commands, data, saved, defaultCharacterPosition = "right") {
  const state = {...createGameState(), ...structuredClone(saved)};
  const index = resolveResumeIndex(commands, data, state);
  const revision = scenarioRevision(commands);
  if (state.scenarioRevision !== revision) {
    const scenes = new Map();
    let chapter = null, scene = null;
    commands.forEach((command, i) => {
      if (command.type === "chapter" && command.action === "start") chapter = command;
      if (command.type === "scene" && command.action === "start") {
        scene = {start:i, end:commands.length, chapter};
        scenes.set(command.args.id, scene);
      }
      if (command.type === "scene" && command.action === "end" && scene) scene.end = i;
    });
    let targetScene = null;
    for (let i = 0; i <= index && i < commands.length; i++) {
      if (commands[i].type === "scene" && commands[i].action === "start") targetScene = commands[i].args.id;
    }
    const trail = (state.trail ?? []).filter(id => scenes.has(id));
    const last = trail.lastIndexOf(targetScene);
    const path = last >= 0 ? trail.slice(0, last + 1) : [...trail, targetScene].filter(Boolean);
    const presentation = [];
    let activeChapter = null;
    for (let n = 0; n < path.length; n++) {
      const item = scenes.get(path[n]);
      if (!item) continue;
      if (item.chapter && activeChapter !== item.chapter.args.id) {
        presentation.push(item.chapter);
        activeChapter = item.chapter.args.id;
      }
      const end = n === path.length - 1 ? Math.min(index, item.end) : item.end;
      for (let i = item.start; i < end; i++) {
        if (["bg","char","compare","bgm","ambient","location","overlay"].includes(commands[i].type)) presentation.push(commands[i]);
      }
    }
    const rebuilt = createGameState();
    new Runner(presentation, rebuilt, {}, {defaultCharacterPosition}).start();
    for (const key of ["visibleCharacters","currentBackground","currentBackgroundImage",
      "currentBackgroundFilter","currentBackgroundEffect","currentBackgroundEffectLayer",
      "currentBackgroundView","currentComparison","currentBgm","currentBgmVolume","currentAmbient","currentAmbientVolume","currentLocationText","currentOverlay"]) {
      state[key] = rebuilt[key];
    }
    if (activeChapter) state.currentChapterId = activeChapter;
    if (targetScene) state.currentSceneId = targetScene;
  } else if (state.visibleCharacters?.undefined) {
    state.visibleCharacters[defaultCharacterPosition] ??= state.visibleCharacters.undefined;
    delete state.visibleCharacters.undefined;
  }
  state.scenarioRevision = revision;
  state.currentCommandIndex = index;
  state.currentResumePoint = commandAnchor(commands[index]);
  return {state, index};
}
