// How a stored actor name reads on screen. The database keeps the raw name (`agent:norn/level1/<job>`,
// `norn research agent (cost engineer)`) because it is the identity the log and the permissions refer to;
// the screens say what a person would. The raw name stays reachable as a tooltip, for traceability.

/** A role id in words: `level1` is "Level 1", `level1-statement` is "Level 1 statement". */
const roleWords = (role: string) => role.replace(/level(\d)/gi, 'Level $1').replace(/[_-]+/g, ' ');

/** The name a run of agent events is shown under: "Fern Level 1 statement agent". */
export const agentLabel = (role: string) => `Fern ${roleWords(role)} agent`;

/** "Fern Level 1 agent" for `agent:norn/level1/<job>`; "Fern research agent (cost engineer)" for the research worker. */
export function displayActor(raw: string): string {
  const agent = /^agent:norn\/([^/]+)/.exec(raw);
  if (agent) return agentLabel(agent[1]);
  const named = /^norn(?:[\s_-]+)(.+)$/i.exec(raw);
  if (named) return `Fern ${named[1].replace(/[_-]+/g, ' ')}`;
  return raw;
}

/** The raw name, only when the screen shows something different (so a tooltip is not repeated for plain names). */
export const rawActor = (raw: string): string | undefined => (displayActor(raw) !== raw ? raw : undefined);
