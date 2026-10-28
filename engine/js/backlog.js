export class Backlog {
  constructor(limit = 200) { this.limit = limit; }
  add(state, command, speaker = null) {
    state.backlog.push({
      id: command.args.id,
      speaker: command.args.speaker,
      speakerName: command.args.speaker === "narration" ? null : (speaker?.name ?? null),
      text: command.text
    });
    if (state.backlog.length > this.limit) state.backlog.splice(0, state.backlog.length - this.limit);
  }
}
