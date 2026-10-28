export function scenarioRevision(commands) {
  let hash = 2166136261;
  const text = JSON.stringify(commands.map(({type, action, args, text}) => ({type, action, args, text})));
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `scenario-${(hash >>> 0).toString(16)}`;
}

export function commandAnchor(command) {
  if (!command?.args?.id) return null;
  if (["text","ending"].includes(command.type) ||
      (["scene","choice"].includes(command.type) && command.action === "start")) {
    return {type:command.type, id:command.args.id};
  }
  return null;
}
