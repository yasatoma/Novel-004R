export class ScenarioSyntaxError extends Error {
  constructor(message, file, line) {
    super(`${file}:${line}: ${message}`);
    this.name = "ScenarioSyntaxError";
    this.file = file;
    this.line = line;
  }
}

function parseAtom(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  return value;
}

function tokenize(line, file, lineNumber) {
  const tokens = [];
  let current = "";
  let quoted = false;

  for (const char of line) {
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (/\s/.test(char) && !quoted) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (quoted) throw new ScenarioSyntaxError("引用符が閉じていません", file, lineNumber);
  if (current) tokens.push(current);
  return tokens;
}

export function parseScenario(source, file = "scenario") {
  const lines = source.replace(/\r/g, "").split("\n");
  const commands = [];

  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const trimmed = lines[index].trim();

    if (!trimmed || trimmed.startsWith("#")) continue;
    if (!trimmed.startsWith("@")) {
      throw new ScenarioSyntaxError("命令外の本文です", file, lineNumber);
    }

    const tokens = tokenize(trimmed, file, lineNumber);
    if (tokens.length < 2) {
      throw new ScenarioSyntaxError("command/action が必要です", file, lineNumber);
    }

    const type = tokens[0].slice(1);
    const action = tokens[1];
    const args = {};

    for (const token of tokens.slice(2)) {
      const separator = token.indexOf("=");
      if (separator < 1) {
        throw new ScenarioSyntaxError(`key=value ではありません: ${token}`, file, lineNumber);
      }

      const key = token.slice(0, separator);
      if (Object.hasOwn(args, key)) {
        throw new ScenarioSyntaxError(`key重複: ${key}`, file, lineNumber);
      }
      args[key] = parseAtom(token.slice(separator + 1));
    }

    const command = { type, action, args, source: { file, line: lineNumber } };

    if (type === "text" && action === "show") {
      let bodyIndex = index + 1;
      while (bodyIndex < lines.length && !lines[bodyIndex].trim()) bodyIndex++;

      const body = lines[bodyIndex]?.trim();
      if (!body || body.startsWith("@") || body.startsWith("#")) {
        throw new ScenarioSyntaxError("@text show の本文がありません", file, lineNumber);
      }

      command.text = lines[bodyIndex];
      index = bodyIndex;
    }

    commands.push(command);
  }

  return commands;
}
