import { resolveContentUrl } from "./content-url.js";
const CNEA_MAGIC = [0x43, 0x4e, 0x45, 0x41];
const CNEA_VERSION = 1;
const CNEA_FORMATS = new Map([
  [0x01, "audio/ogg"],
  [0x02, "audio/mpeg"],
  [0x03, "audio/wav"]
]);
const CNEA_HEADER_SIZE = 6;
export const UI_SOUNDS = Object.freeze({ start: "U001.dat", confirm: "U002.dat", cancel: "U003.dat" });

export function decodeCnea(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < CNEA_HEADER_SIZE) throw new Error("CNEA audio is too short");
  if (!CNEA_MAGIC.every((value, index) => bytes[index] === value)) {
    throw new Error("invalid CNEA audio magic");
  }
  if (bytes[4] !== CNEA_VERSION) {
    throw new Error(`unsupported CNEA version: ${bytes[4]}`);
  }
  const mimeType = CNEA_FORMATS.get(bytes[5]);
  if (!mimeType) throw new Error(`unsupported CNEA audio format: ${bytes[5]}`);
  return { mimeType, payload: buffer.slice(CNEA_HEADER_SIZE) };
}

export class AudioManager {
  constructor(workRoot, getSettings = () => ({})) {
    this.workRoot = workRoot;
    this.getSettings = getSettings;
    this.bgm = null;
    this.ambient = null;
    this.se = new Set();
    this.pausedByVisibility = new Set();
    this.cneaUrls = new Map();
    this.fadeTokens = new WeakMap();
  }

  handle(command) {
    switch (command.type) {
      case "bgm":
        return command.action === "play"
          ? this.playLoop("bgm", command.args.file, command.args)
          : this.stopLoop("bgm", command.args);
      case "ambient":
        return command.action === "play"
          ? this.playLoop("ambient", command.args.file, command.args)
          : this.stopLoop("ambient", command.args);
      case "se":
        return this.playSe(command.args.file);
      default:
        throw new Error(`unsupported audio command: ${command.type}`);
    }
  }

  resolve(kind, file) {
    return resolveContentUrl(this.workRoot, `audio/${kind}/${file}`);
  }

  async resolvePlayable(kind, file) {
    const source = this.resolve(kind, file);
    if (!file.toLowerCase().endsWith(".dat")) return source;
    if (this.cneaUrls.has(source)) return this.cneaUrls.get(source);

    const response = await fetch(source);
    if (!response.ok) throw new Error(`${source}: HTTP ${response.status}`);
    const { mimeType, payload } = decodeCnea(await response.arrayBuffer());
    const url = URL.createObjectURL(new Blob([payload], { type: mimeType }));
    this.cneaUrls.set(source, url);
    return url;
  }

  volume(kind) {
    const settings = this.getSettings();
    const master = clamp(settings.master ?? 1);
    return master * clamp(settings[kind] ?? 1);
  }

  async playLoop(kind, file, options = {}) {
    const current = this[kind];
    if (current?.dataset.file === file && options.continue_if_same !== "false" && options.continue_if_same !== false) {
      this.cancelFade(current);
      current.dataset.volumeMultiplier = String(clamp(options.volume ?? current.dataset.volumeMultiplier ?? 1));
      const target = this.volume(kind) * Number(current.dataset.volumeMultiplier);
      if (Number(options.fade_ms) > 0) this.fade(current, current.volume, target, Number(options.fade_ms));
      else current.volume = target;
      return;
    }

    this.stopLoop(kind);
    const audio = new Audio(await this.resolvePlayable(kind, file));
    audio.dataset.file = file;
    audio.dataset.volumeMultiplier = String(clamp(options.volume ?? 1));
    audio.loop = true;
    const targetVolume = this.volume(kind) * Number(audio.dataset.volumeMultiplier);
    audio.volume = Number(options.fade_ms) > 0 ? 0 : targetVolume;
    this[kind] = audio;
    await safePlay(audio);
    if (Number(options.fade_ms) > 0) this.fade(audio, 0, targetVolume, Number(options.fade_ms));
  }

  stopLoop(kind, options = {}) {
    const audio = this[kind];
    if (!audio) return;
    const finish=()=>{this.cancelFade(audio);audio.pause();audio.currentTime=0;if(this[kind]===audio)this[kind]=null;};
    const ms=Number(options.fade_ms ?? 0); if(ms>0){this.fade(audio,audio.volume,0,ms,finish);return;} finish();
  }

  async playSe(file) {
    const audio = new Audio(await this.resolvePlayable("se", file));
    audio.volume = this.volume("se");
    this.se.add(audio);
    audio.addEventListener("ended", () => this.se.delete(audio), { once: true });
    await safePlay(audio);
  }

  async resolveUiPlayable(file) {
    const source = new URL(`../audio/ui/${file}`, import.meta.url).href;
    if (this.cneaUrls.has(source)) return this.cneaUrls.get(source);
    const response = await fetch(source);
    if (!response.ok) throw new Error(`${source}: HTTP ${response.status}`);
    const { mimeType, payload } = decodeCnea(await response.arrayBuffer());
    const url = URL.createObjectURL(new Blob([payload], { type: mimeType }));
    this.cneaUrls.set(source, url);
    return url;
  }

  async playUi(action = "confirm") {
    const file = UI_SOUNDS[action] ?? UI_SOUNDS.confirm;
    const audio = new Audio(await this.resolveUiPlayable(file));
    audio.volume = this.volume("se");
    this.se.add(audio);
    audio.addEventListener("ended", () => this.se.delete(audio), { once: true });
    await safePlay(audio);
  }

  cancelFade(audio) { if (audio) this.fadeTokens.delete(audio); }

  fade(audio, from, to, ms, done) {
    const token={};
    this.fadeTokens.set(audio,token);
    audio.volume=from;
    const started=performance.now();
    const tick=now=>{
      if(this.fadeTokens.get(audio)!==token)return;
      const p=Math.min(1,(now-started)/ms);
      audio.volume=from+(to-from)*p;
      if(p<1)requestAnimationFrame(tick);
      else { this.fadeTokens.delete(audio); done?.(); }
    };
    requestAnimationFrame(tick);
  }

  stopSe() {
    for (const audio of this.se) { audio.pause(); audio.currentTime = 0; }
    this.se.clear();
  }

  resetPresentation() {
    this.stopLoop("ambient");
    this.stopSe();
  }

  resetAll() {
    this.stopLoop("bgm");
    this.stopLoop("ambient");
    this.stopSe();
  }

  async restore(state = {}) {
    this.stopLoop("bgm");
    this.stopLoop("ambient");
    this.stopSe();
    const tasks=[];
    if(state.currentBgm) tasks.push(this.playLoop("bgm",state.currentBgm,{volume:state.currentBgmVolume ?? 1}));
    if(state.currentAmbient) tasks.push(this.playLoop("ambient",state.currentAmbient,{volume:state.currentAmbientVolume ?? 1}));
    await Promise.all(tasks);
  }

  pauseAll() {
    this.pausedByVisibility.clear();
    for (const audio of [this.bgm, this.ambient, ...this.se]) {
      if (audio && !audio.paused) { audio.pause(); this.pausedByVisibility.add(audio); }
    }
  }

  resumeAll() {
    for (const audio of this.pausedByVisibility) void safePlay(audio);
    this.pausedByVisibility.clear();
  }

  refreshVolumes() {
    if (this.bgm) this.bgm.volume = this.volume("bgm") * Number(this.bgm.dataset.volumeMultiplier ?? 1);
    if (this.ambient) this.ambient.volume = this.volume("ambient") * Number(this.ambient.dataset.volumeMultiplier ?? 1);
    for (const audio of this.se) audio.volume = this.volume("se");
  }
}

async function safePlay(audio) {
  try { await audio.play(); }
  catch (error) {
    if (error?.name !== "NotAllowedError") throw error;
  }
}

function clamp(value) {
  return Math.max(0, Math.min(1, Number(value)));
}
