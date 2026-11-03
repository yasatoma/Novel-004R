import { resolveContentUrl } from "./content-url.js";

function resolveBackgroundFile(assets, id, variant = "base") {
  const registered = assets.backgrounds?.[id];
  if (!registered) return null;
  if (typeof registered === "string") return variant === "base" ? registered : null;
  const variants = registered.variants ?? registered;
  return variants?.[variant] ?? null;
}

function characterFile(assets, id, expression) {
  return assets.characters?.[id]?.expressions?.[expression] ?? null;
}

function image(path) { return { kind: "image", path }; }
function audio(path) { return { kind: "audio", path }; }

export function assetRequestsForCommand(command, assets = {}) {
  if (!command?.args) return [];
  const requests = [];
  if (command.type === "bg" && command.action === "show") {
    const file = resolveBackgroundFile(assets, command.args.id, command.args.image ?? "base");
    if (file) requests.push(image(`images/bg/${file}`));
  } else if (command.type === "compare" && command.action === "show") {
    for (const [idKey, imageKey] of [["left_id","left_image"],["right_id","right_image"]]) {
      const file = resolveBackgroundFile(assets, command.args[idKey], command.args[imageKey] ?? "base");
      if (file) requests.push(image(`images/bg/${file}`));
    }
  } else if (command.type === "char" && ["show","change"].includes(command.action)) {
    const file = characterFile(assets, command.args.id, command.args.expression);
    if (file) requests.push(image(`images/char/${file}`));
  } else if (command.type === "overlay" && command.action === "show") {
    requests.push(image(`images/item/${command.args.id}.webp`));
  } else if (["bgm","ambient","se"].includes(command.type) && command.action === "play") {
    requests.push(audio(`audio/${command.type}/${command.args.file}`));
  }
  return requests;
}

export function assetRequestsForState(state = {}, assets = {}) {
  const requests = [];
  if (state.currentBackground) {
    const file = resolveBackgroundFile(assets, state.currentBackground, state.currentBackgroundImage ?? "base");
    if (file) requests.push(image(`images/bg/${file}`));
  }
  for (const character of Object.values(state.visibleCharacters ?? {})) {
    const file = characterFile(assets, character.id, character.expression);
    if (file) requests.push(image(`images/char/${file}`));
  }
  if (state.currentComparison) {
    for (const [idKey, imageKey] of [["left_id","left_image"],["right_id","right_image"]]) {
      const file = resolveBackgroundFile(assets, state.currentComparison[idKey], state.currentComparison[imageKey] ?? "base");
      if (file) requests.push(image(`images/bg/${file}`));
    }
  }
  if (state.currentOverlay?.id) requests.push(image(`images/item/${state.currentOverlay.id}.webp`));
  if (state.currentBgm) requests.push(audio(`audio/bgm/${state.currentBgm}`));
  if (state.currentAmbient) requests.push(audio(`audio/ambient/${state.currentAmbient}`));
  return requests;
}

async function defaultLoadAsset(asset, url) {
  if (asset.kind === "image" && typeof Image !== "undefined") {
    const element = new Image();
    element.decoding = "async";
    await new Promise((resolve, reject) => {
      element.onload = () => resolve();
      element.onerror = () => reject(new Error(`image preload failed: ${url}`));
      element.src = url;
      if (element.complete && element.naturalWidth) resolve();
    });
    if (typeof element.decode === "function") {
      try { await element.decode(); } catch {}
    }
    return;
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  await response.arrayBuffer();
}

export class AssetPreloader {
  constructor(workRoot, options = {}) {
    this.workRoot = workRoot;
    this.concurrency = Math.max(1, Number(options.concurrency ?? 3));
    this.normalLimit = Math.max(1, this.concurrency - 1);
    this.loadAsset = options.loadAsset ?? defaultLoadAsset;
    this.logger = options.logger ?? console;
    this.manifest = {};
    this.pending = [];
    this.active = new Map();
    this.completed = new Set();
    this.failed = new Set();
    this.generation = 0;
    this.idleWaiters = [];
  }

  setManifest(manifest) {
    this.manifest = manifest && typeof manifest === "object" ? manifest : {};
  }

  urlFor(asset) {
    return asset.url ?? resolveContentUrl(this.workRoot, asset.path);
  }

  keyFor(asset) {
    return this.urlFor(asset);
  }

  rebase(textId = null) {
    this.generation++;
    const generation = this.generation;
    const retained = [];
    for (const item of this.pending) {
      if (item.priority === "critical") retained.push(item);
      else item.resolve(false);
    }
    this.pending = retained;

    const anchors = Array.isArray(this.manifest?.anchors) ? this.manifest.anchors : [];
    let start = 0;
    if (textId) {
      const found = anchors.findIndex(anchor => anchor?.textId === textId);
      if (found >= 0) start = found;
    }
    for (const anchor of anchors.slice(start)) {
      for (const asset of anchor?.assets ?? []) this.schedule(asset, "normal", generation);
    }
    this.drain();
  }

  ensureCommand(command, assets) {
    return this.ensureAssets(assetRequestsForCommand(command, assets));
  }

  ensureState(state, assets) {
    return this.ensureAssets(assetRequestsForState(state, assets));
  }

  ensureAssets(assets = []) {
    const needed = assets.filter(asset => {
      const key = this.keyFor(asset);
      return !this.completed.has(key) || this.failed.has(key);
    });
    if (!needed.length) return null;
    return Promise.all(needed.map(asset => this.schedule(asset, "critical", this.generation))).then(() => undefined);
  }

  schedule(asset, priority = "normal", generation = this.generation) {
    const normalized = { kind: asset.kind ?? "binary", path: asset.path, url: asset.url };
    const key = this.keyFor(normalized);
    if (this.completed.has(key)) return Promise.resolve(true);
    if (this.failed.has(key)) {
      if (priority !== "critical") return Promise.resolve(false);
      this.failed.delete(key);
    }
    const active = this.active.get(key);
    if (active) return active.promise;
    const existing = this.pending.find(item => item.key === key);
    if (existing) {
      if (priority === "critical") existing.priority = "critical";
      return existing.promise;
    }
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    this.pending.push({ key, asset: normalized, priority, generation, promise, resolve });
    this.drain();
    return promise;
  }

  drain() {
    while (this.active.size < this.concurrency) {
      let index = this.pending.findIndex(item => item.priority === "critical");
      if (index < 0) {
        const normalActive = [...this.active.values()].filter(item => item.priority === "normal").length;
        if (normalActive >= this.normalLimit) break;
        index = this.pending.findIndex(item => item.priority === "normal");
      }
      if (index < 0) break;
      const [item] = this.pending.splice(index, 1);
      if (item.priority === "normal" && item.generation !== this.generation) {
        item.resolve(false);
        continue;
      }
      this.start(item);
    }
    this.resolveIdleIfNeeded();
  }

  start(item) {
    this.active.set(item.key, item);
    item.promise = Promise.resolve()
      .then(() => this.loadAsset(item.asset, item.key))
      .then(() => {
        this.completed.add(item.key);
        this.failed.delete(item.key);
        item.resolve(true);
        return true;
      })
      .catch(error => {
        this.failed.add(item.key);
        this.logger.warn?.("[preload] failed", item.key, error);
        item.resolve(false);
        return false;
      })
      .finally(() => {
        this.active.delete(item.key);
        this.drain();
      });
  }

  whenIdle() {
    if (!this.pending.length && !this.active.size) return Promise.resolve();
    return new Promise(resolve => this.idleWaiters.push(resolve));
  }

  resolveIdleIfNeeded() {
    if (this.pending.length || this.active.size) return;
    for (const resolve of this.idleWaiters.splice(0)) resolve();
  }
}
