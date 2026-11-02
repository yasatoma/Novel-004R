const TOP_LEVEL = new Set(["bg","bgm","char","chapter_title","ambient"]);

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function assertRecord(value, path) {
  if (!isRecord(value)) throw new Error(`presentation.json: ${path} must be an object`);
}

function assertKnownKeys(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`presentation.json: unknown key ${path}.${key}`);
  }
}

function assertDuration(value, path) {
  if (value === undefined) return;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`presentation.json: ${path} must be a non-negative number`);
}

function validateLeaf(root, name, allowedKeys, validators = {}) {
  const value = root[name];
  if (value === undefined) return;
  assertRecord(value, name);
  assertKnownKeys(value, new Set(allowedKeys), name);
  for (const [key, validator] of Object.entries(validators)) validator(value[key], `${name}.${key}`);
}

export function assertValidPresentation(presentation) {
  assertRecord(presentation, "$");
  assertKnownKeys(presentation, TOP_LEVEL, "$");

  if (presentation.bg !== undefined) {
    assertRecord(presentation.bg, "bg");
    assertKnownKeys(presentation.bg, new Set(["show"]), "bg");
    validateLeaf(presentation.bg, "show", ["transition","duration_ms"], {
      transition(value, path) {
        if (value !== undefined && !["cut","fade","dissolve","blackfade"].includes(value)) {
          throw new Error(`presentation.json: ${path} has an unsupported value`);
        }
      },
      duration_ms: assertDuration
    });
  }

  if (presentation.bgm !== undefined) {
    assertRecord(presentation.bgm, "bgm");
    assertKnownKeys(presentation.bgm, new Set(["play","stop"]), "bgm");
    validateLeaf(presentation.bgm, "play", ["fade_ms"], { fade_ms: assertDuration });
    validateLeaf(presentation.bgm, "stop", ["fade_ms"], { fade_ms: assertDuration });
  }

  if (presentation.ambient !== undefined) {
    assertRecord(presentation.ambient, "ambient");
    assertKnownKeys(presentation.ambient, new Set(["play","stop"]), "ambient");
    validateLeaf(presentation.ambient, "play", ["fade_ms"], { fade_ms: assertDuration });
    validateLeaf(presentation.ambient, "stop", ["fade_ms"], { fade_ms: assertDuration });
  }

  if (presentation.char !== undefined) {
    assertRecord(presentation.char, "char");
    assertKnownKeys(presentation.char, new Set(["show","hide"]), "char");
    validateLeaf(presentation.char, "show", ["duration_ms"], { duration_ms: assertDuration });
    validateLeaf(presentation.char, "hide", ["duration_ms"], { duration_ms: assertDuration });
  }

  if (presentation.chapter_title !== undefined) {
    assertRecord(presentation.chapter_title, "chapter_title");
    assertKnownKeys(presentation.chapter_title, new Set(["show"]), "chapter_title");
    validateLeaf(presentation.chapter_title, "show", ["duration_ms","hold_ms"], {
      duration_ms: assertDuration,
      hold_ms: assertDuration
    });
  }

  return presentation;
}

export function applyPresentationDefaults(command, presentation = {}) {
  let defaults = null;
  if (command.type === "bg" && command.action === "show") defaults = presentation.bg?.show;
  else if (command.type === "bgm" && ["play","stop"].includes(command.action)) defaults = presentation.bgm?.[command.action];
  else if (command.type === "ambient" && ["play","stop"].includes(command.action)) defaults = presentation.ambient?.[command.action];
  else if (command.type === "char" && ["show","hide"].includes(command.action)) defaults = presentation.char?.[command.action];
  else if (command.type === "chapter_title" && command.action === "show") defaults = presentation.chapter_title?.show;
  if (!defaults || !Object.keys(defaults).length) return command;
  return {...command, args:{...defaults, ...command.args}};
}

export class PresentationTracker {
  constructor() {
    this.timers = new Map();
    this.waiters = new Set();
  }

  start(key, durationMs) {
    this.finish(key);
    const duration = Number(durationMs);
    if (!Number.isFinite(duration) || duration <= 0) return;
    const timer = setTimeout(() => {
      if (this.timers.get(key) !== timer) return;
      this.timers.delete(key);
      this.flush();
    }, duration);
    this.timers.set(key, timer);
  }

  finish(key) {
    const timer = this.timers.get(key);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(key);
    this.flush();
  }

  finishPrefix(prefix) {
    for (const key of [...this.timers.keys()]) if (key.startsWith(prefix)) this.finish(key);
  }

  waitForIdle() {
    if (this.timers.size === 0) return Promise.resolve();
    return new Promise(resolve => this.waiters.add(resolve));
  }

  reset() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.flush();
  }

  flush() {
    if (this.timers.size !== 0) return;
    for (const resolve of this.waiters) resolve();
    this.waiters.clear();
  }

  get activeCount() {
    return this.timers.size;
  }
}
