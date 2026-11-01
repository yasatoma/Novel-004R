import { commandAnchor, scenarioRevision } from "./scenario-identity.js";

export class Runner {
  constructor(commands, state, hooks = {}, options = {}) {
    this.commands = commands;
    this.state = state;
    this.hooks = hooks;
    this.defaultCharacterPosition = options.defaultCharacterPosition ?? "right";
    this.characterBookIds = new Set(options.characterBookIds ?? []);
    if (!Array.isArray(this.state.unlockedCharacterIds)) this.state.unlockedCharacterIds = [];
    this.revision = scenarioRevision(commands);
    this.index = 0;
    this.sceneIndexes = new Map();
    commands.forEach((command, index) => {
      if (command.type === "scene" && command.action === "start") {
        this.sceneIndexes.set(command.args.id, index);
      }
    });
  }

  start(index = 0) {
    this.index = index;
    this.run();
  }

  restore(state) {
    this.state = state;
    this.index = state.currentCommandIndex ?? 0;
    this.run();
  }

  resume() {
    this.index++;
    this.run();
  }

  jump(sceneId) {
    const index = this.sceneIndexes.get(sceneId);
    if (index === undefined) throw new Error(`scene not found: ${sceneId}`);
    this.index = index;
  }

  run() {
    while (this.index < this.commands.length) {
      const command = this.commands[this.index];
      this.state.currentCommandIndex = this.index;
      this.state.scenarioRevision = this.revision;
      const anchor = commandAnchor(command);
      if (anchor) this.state.currentResumePoint = anchor;

      switch (command.type) {
        case "chapter":
          if (command.action === "start") {
            this.state.currentChapterId = command.args.id;
            this.hooks.chapterStart?.(command);
          }
          break;

        case "scene":
          if (command.action === "start") {
            this.state.currentSceneId = command.args.id;
            this.state.currentTextId = null;
            this.state.currentChoiceId = null;
            this.state.trail.push(command.args.id);
            this.hooks.sceneStart?.(command);
          }
          break;

        case "flag":
          this.state.flags[command.args.id] = command.args.value;
          break;

        case "text": {
          this.state.currentTextId = command.args.id;
          const speakerId = command.args.speaker;
          if (this.characterBookIds.has(speakerId) && !this.state.unlockedCharacterIds.includes(speakerId)) {
            this.state.unlockedCharacterIds.push(speakerId);
            this.hooks.characterBookUnlock?.(speakerId, command);
          }
          this.hooks.text?.(command, () => this.resume(), this);
          return;
        }

        case "bg":
          if (command.action === "show") {
            this.state.currentBackground = command.args.id;
            this.state.currentBackgroundImage = command.args.image ?? "base";
            this.state.currentBackgroundFilter = command.args.filter ?? "normal";
            this.state.currentBackgroundEffect = command.args.effect ?? "none";
            this.state.currentBackgroundEffectLayer = command.args.effect_layer ?? "background";
            this.state.currentBackgroundView = command.args.view ?? "full";
          } else {
            this.state.currentBackground = null;
            this.state.currentBackgroundImage = "base";
            this.state.currentBackgroundFilter = "normal";
            this.state.currentBackgroundEffect = "none";
              this.state.currentBackgroundEffectLayer = "background";
            this.state.currentBackgroundView = "full";
          }
          if (command.args.blocking && this.hooks.bg) {
            this.hooks.bg(command, () => this.resume());
            return;
          }
          this.hooks.bg?.(command);
          break;

        case "compare":
          this.state.currentComparison = command.action === "show" ? {
            left_id: command.args.left_id,
            left_image: command.args.left_image ?? "base",
            right_id: command.args.right_id,
            right_image: command.args.right_image ?? "base"
          } : null;
          this.hooks.compare?.(command);
          break;

        case "char":
          if (command.action === "show") {
            const position = command.args.position ?? this.defaultCharacterPosition;
            for (const [slot, value] of Object.entries(this.state.visibleCharacters)) {
              if (value.id === command.args.id) delete this.state.visibleCharacters[slot];
            }
            this.state.visibleCharacters[position] = { id: command.args.id, expression: command.args.expression, crop: command.args.crop ?? "bust" };
          }
          else if (command.action === "change") {
            const visible = Object.values(this.state.visibleCharacters).find(value => value.id === command.args.id);
            if (!visible) {
              const source = command.source ? ` (${command.source.file}:${command.source.line})` : "";
              console.warn(`@char change skipped: character is not visible: ${command.args.id}${source}`);
              break;
            }
            visible.expression = command.args.expression;
            if (command.args.crop !== undefined) visible.crop = command.args.crop;
          } else {
            if (command.args.id === "ALL") this.state.visibleCharacters = {};
            else for (const [position, value] of Object.entries(this.state.visibleCharacters)) if (value.id === command.args.id) delete this.state.visibleCharacters[position];
          }
          this.hooks.character?.(command.action === "show" ? {...command, args:{...command.args, position:command.args.position ?? this.defaultCharacterPosition}} : command);
          break;

        case "bgm":
        case "ambient":
        case "se":
          if (command.type === "bgm") { this.state.currentBgm = command.action === "play" ? command.args.file : null; this.state.currentBgmVolume = command.action === "play" ? Number(command.args.volume ?? 1) : 1; }
          if (command.type === "ambient") {
            this.state.currentAmbient = command.action === "play" ? command.args.file : null;
            this.state.currentAmbientVolume = command.action === "play" ? Number(command.args.volume ?? 1) : 1;
          }
          this.hooks.audio?.(command);
          break;

        case "location":
          this.state.currentLocationText = command.action === "show" ? command.args.text : null;
          this.hooks.location?.(command);
          break;

        case "chapter_title":
          this.hooks.chapterTitle?.(command);
          break;

        case "textbox":
          this.hooks.textbox?.(command);
          break;

        case "overlay":
          this.state.currentOverlay = command.action === "show" ? {
            id: command.args.id,
            position: command.args.position ?? "center",
            size: command.args.size ?? "medium"
          } : null;
          this.hooks.overlay?.(command);
          break;

        case "effect":
          if (command.args.blocking && command.action === "play" && this.hooks.effect) {
            this.hooks.effect(command, () => this.resume());
            return;
          }
          this.hooks.effect?.(command);
          break;

        case "wait":
          if (command.args.mode === "auto_only" && !this.hooks.isAuto?.()) break;
          this.hooks.wait?.(command, () => this.resume());
          return;

        case "memo":
          if (!this.state.unlockedMemoIds.includes(command.args.id)) {
            this.state.unlockedMemoIds.push(command.args.id);
          }
          this.hooks.memo?.(command);
          break;

        case "ending":
          if (!this.state.reachedEndingIds.includes(command.args.id)) {
            this.state.reachedEndingIds.push(command.args.id);
          }
          this.hooks.ending?.(command);
          return;

        case "jump":
          this.jump(command.args.target);
          continue;

        case "if": {
          const left = this.state.flags[command.args.flag];
          if (compare(left, command.args.operator, command.args.value)) {
            this.jump(command.args.goto);
            continue;
          }
          break;
        }

        case "choice":
          if (command.action === "start") {
            const { options, endIndex } = collectChoice(this.commands, this.index, command.args.id);
            this.state.currentChoiceId = command.args.id;
            this.hooks.choice?.(command, options, option => {
              this.state.currentChoiceId = null;
              this.jump(option.args.goto);
              this.run();
            });
            return;
          }
          break;

        case "option":
          throw new Error(`orphan @option add at ${command.source.file}:${command.source.line}`);

        default:
          throw new Error(`runner unsupported command: @${command.type} ${command.action}`);
      }

      this.index++;
    }

    this.hooks.complete?.();
  }
}

function collectChoice(commands, startIndex, choiceId) {
  const options = [];
  for (let index = startIndex + 1; index < commands.length; index++) {
    const command = commands[index];
    if (command.type === "option" && command.action === "add") {
      options.push(command);
      continue;
    }
    if (command.type === "choice" && command.action === "end") {
      if (command.args.id !== choiceId) throw new Error(`choice end mismatch: ${choiceId}`);
      if (!options.length) throw new Error(`choice has no options: ${choiceId}`);
      return { options, endIndex: index };
    }
    throw new Error(`invalid command inside choice: @${command.type} ${command.action}`);
  }
  throw new Error(`choice not closed: ${choiceId}`);
}

function compare(left, operator, right) {
  switch (operator) {
    case "eq": return left === right;
    case "ne": return left !== right;
    case "gt": return left > right;
    case "ge": return left >= right;
    case "lt": return left < right;
    case "le": return left <= right;
    default: throw new Error(`unknown operator: ${operator}`);
  }
}
