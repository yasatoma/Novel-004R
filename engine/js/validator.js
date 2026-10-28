const COMMANDS = {
  chapter: { start: { required: ["id", "title"] }, end: { required: ["id"] } },
  scene: { start: { required: ["id"] }, end: { required: ["id"] } },
  text: { show: { required: ["id", "speaker"] } },
  bg: { show: { required: ["id"] }, hide: { required: [] } },
  compare: { show: { required: ["left_id", "right_id"] }, hide: { required: [] } },
  char: {
    show: { required: ["id", "expression"] },
    change: { required: ["id", "expression"] },
    hide: { required: ["id"] }
  },
  bgm: { play: { required: ["file"] }, stop: { required: [] } },
  ambient: { play: { required: ["file"] }, stop: { required: [] } },
  location: { show: { required: ["text"] }, hide: { required: [] } },
  chapter_title: { show: { required: ["chapter", "title"] } },
  textbox: { show: { required: [] }, hide: { required: [] } },
  overlay: { show: { required: ["id"] }, hide: { required: [] } },
  se: { play: { required: ["file"] } },
  effect: { play: { required: ["id"] }, stop: { required: ["id"] } },
  wait: { start: { required: ["duration_ms"] } },
  flag: { set: { required: ["id", "value"] } },
  if: { check: { required: ["flag", "operator", "value", "goto"] } },
  jump: { goto: { required: ["target"] } },
  choice: { start: { required: ["id"] }, end: { required: ["id"] } },
  option: { add: { required: ["id", "text", "goto"] } },
  memo: { unlock: { required: ["id"] } },
  ending: { reach: { required: ["id"] } }
};

function fail(command, message) {
  throw new Error(`${command.source.file}:${command.source.line}: ${message}`);
}

export function validateScenario(commands, resources = null) {
  const ids = new Set();
  const scenes = new Set();
  const targets = [];
  let chapter = null;
  let scene = null;
  let choice = null;

  for (const command of commands) {
    const definition = COMMANDS[command.type]?.[command.action];
    if (!definition) fail(command, `未定義命令 @${command.type} ${command.action}`);

    for (const key of definition.required) {
      if (!Object.hasOwn(command.args, key)) fail(command, `必須key不足: ${key}`);
    }

    const declaresId =
      command.type === "text" ||
      command.type === "option" ||
      (["chapter", "scene", "choice"].includes(command.type) && command.action === "start");

    if (declaresId && command.args.id) {
      if (ids.has(command.args.id)) fail(command, `ID重複: ${command.args.id}`);
      ids.add(command.args.id);
    }

    if (command.type === "chapter") {
      if (command.action === "start") {
        if (chapter) fail(command, "chapterの入れ子はできません");
        chapter = command.args.id;
      } else {
        if (scene || choice || chapter !== command.args.id) fail(command, `chapter終端不一致: ${command.args.id}`);
        chapter = null;
      }
    }

    if (command.type === "scene") {
      if (command.action === "start") {
        if (!chapter || scene) fail(command, "sceneはchapter内で一つずつ開始してください");
        scene = command.args.id;
        scenes.add(command.args.id);
      } else {
        if (choice || scene !== command.args.id) fail(command, `scene終端不一致: ${command.args.id}`);
        scene = null;
      }
    }

    if (command.type === "choice") {
      if (command.action === "start") {
        if (!scene || choice) fail(command, "choiceはscene内で一つずつ開始してください");
        choice = command.args.id;
      } else {
        if (choice !== command.args.id) fail(command, `choice終端不一致: ${command.args.id}`);
        choice = null;
      }
    }

    if (command.type === "option" && !choice) fail(command, "@option add はchoice内でのみ使用できます");

    validateValues(command);
    if (resources) validateReference(command, resources);
    if (command.type === "jump") targets.push([command.args.target, command]);
    if (command.type === "if") targets.push([command.args.goto, command]);
    if (command.type === "option") targets.push([command.args.goto, command]);
  }

  if (choice) throw new Error(`choiceが閉じられていません: ${choice}`);
  if (scene) throw new Error(`sceneが閉じられていません: ${scene}`);
  if (chapter) throw new Error(`chapterが閉じられていません: ${chapter}`);

  for (const [target, command] of targets) {
    if (!scenes.has(target)) fail(command, `遷移先sceneがありません: ${target}`);
  }

  return true;
}


function validateReference(command, resources) {
  const assets = resources.assets ?? {};
  if (command.type === "bg" && command.action === "show") {
    validateBackgroundReference(command, assets, command.args.id, command.args.image ?? "base");
  }
  if (command.type === "compare" && command.action === "show") {
    validateBackgroundReference(command, assets, command.args.left_id, command.args.left_image ?? "base");
    validateBackgroundReference(command, assets, command.args.right_id, command.args.right_image ?? "base");
  }
  if (command.type === "text" && command.action === "show" && command.args.speaker !== "narration") {
    const character = assets.characters?.[command.args.speaker];
    if (!character) fail(command, `未登録話者: ${command.args.speaker}`);
  }
  if (command.type === "char" && ["show", "change"].includes(command.action)) {
    const character = assets.characters?.[command.args.id];
    if (!character) fail(command, `未登録キャラクター: ${command.args.id}`);
    if (!character.expressions?.[command.args.expression]) {
      fail(command, `未登録表情: ${command.args.id}/${command.args.expression}`);
    }
  }
  if (command.type === "memo" && !resources.memos?.[command.args.id]) {
    fail(command, `未登録メモ: ${command.args.id}`);
  }
  if (command.type === "ending" && !resources.endings?.[command.args.id]) {
    fail(command, `未登録エンディング: ${command.args.id}`);
  }
}

function validateBackgroundReference(command, assets, id, variant) {
  const registered = assets.backgrounds?.[id];
  if (!registered) fail(command, `未登録背景: ${id}`);
  if (typeof registered === "string") {
    if (variant !== "base") fail(command, `未登録背景variant: ${id}/${variant}`);
    return;
  }
  const variants = registered.variants ?? registered;
  if (!variants?.[variant]) fail(command, `未登録背景variant: ${id}/${variant}`);
}

function validateValues(command) {
  const a=command.args;
  if(command.type==="bg"&&command.action==="show"){
    if(a.effect_layer!==undefined&&!["background","foreground"].includes(a.effect_layer)) fail(command,`未定義bg.effect_layer: ${a.effect_layer}`);
    if(a.filter&&!["normal","evening","night","dim","bright","warm","cool"].includes(a.filter)) fail(command,`未定義bg.filter: ${a.filter}`);
    if(a.view&&!["full","wall_crop","detail_crop","entrance"].includes(a.view)) fail(command,`未定義bg.view: ${a.view}`);
    if(a.transition&&!["cut","fade","dissolve","blackfade"].includes(a.transition)) fail(command,`未定義bg.transition: ${a.transition}`);
    if(a.effect&&!["none","mist_weak","steam_weak","steam_medium","dust_weak","dust_medium"].includes(a.effect)) fail(command,`未定義bg.effect: ${a.effect}`);
  }
  if(command.type==="char"&&["show","change"].includes(command.action)&&a.position&&!["left","center","right"].includes(a.position)) fail(command,`未定義char.position: ${a.position}`);
  if(command.type==="char"&&["show","change"].includes(command.action)&&a.crop&&!["bust","face"].includes(a.crop)) fail(command,`未定義char.crop: ${a.crop}`);
  if(command.type==="wait"&&a.mode!==undefined&&!["always","auto_only"].includes(a.mode)) fail(command,`未定義wait.mode: ${a.mode}`);
  if(command.type==="effect"&&!["shake","flash","fade","mist","blackfade"].includes(a.id)) fail(command,`未定義effect.id: ${a.id}`);
  if(command.type==="effect"&&a.strength!==undefined&&!["","small","normal"].includes(a.strength)) fail(command,`未定義effect.strength: ${a.strength}`);
  if(["bgm","ambient"].includes(command.type)&&a.continue_if_same!==undefined&&typeof a.continue_if_same!=="boolean") fail(command,`continue_if_sameはtrue/false: ${a.continue_if_same}`);
  if(command.type==="overlay"&&command.action==="show"&&!/^I\d{3}$/.test(a.id)) fail(command,`overlay.idはI + 3桁数字: ${a.id}`);
  if(command.type==="overlay"&&command.action==="show"&&a.position!==undefined&&!["left","center","right"].includes(a.position)) fail(command,`未定義overlay.position: ${a.position}`);
  if(command.type==="overlay"&&command.action==="show"&&a.size!==undefined&&!["small","medium","large"].includes(a.size)) fail(command,`未定義overlay.size: ${a.size}`);
  if(a.blocking!==undefined&&typeof a.blocking!=="boolean") fail(command,`blockingはtrue/false: ${a.blocking}`);
  for(const key of ["duration_ms","fade_ms","hold_ms"]) if(a[key]!==undefined&&(!Number.isFinite(Number(a[key]))||Number(a[key])<0)) fail(command,`${key}は0以上の数値: ${a[key]}`);
  if(a.volume!==undefined&&(!Number.isFinite(Number(a.volume))||Number(a.volume)<0||Number(a.volume)>1)) fail(command,`volumeは0..1: ${a.volume}`);
}
