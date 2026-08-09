export const NATIVE_AGENT_IDS = [
  "claude-code",
  "codex",
  "gemini-cli",
  "copilot-cli",
  "windsurf",
] as const;

export type NativeAgentId = (typeof NATIVE_AGENT_IDS)[number];
export type AgentId = NativeAgentId | `generic:${string}`;
export type IntegrationMode = "native" | "memory";

export interface IntegrationConfig {
  agent: AgentId;
  mode: IntegrationMode;
  path?: string;
}

export function parseAgentId(value: string): AgentId {
  if ((NATIVE_AGENT_IDS as readonly string[]).includes(value)) {
    return value as NativeAgentId;
  }
  if (/^generic:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    return value as AgentId;
  }
  throw new Error(`invalid agent identifier: ${value}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected !== undefined) {
    throw new Error(`integration contains unexpected field: ${unexpected}`);
  }
}

export function normalizeIntegrations(
  values: readonly IntegrationConfig[],
): IntegrationConfig[] {
  const agents = new Set<AgentId>();
  const normalized = values.map((value) => {
    if (!isRecord(value)) {
      throw new Error("integration must be an object");
    }
    assertOnlyKeys(value, ["agent", "mode", "path"]);
    if (typeof value.agent !== "string") {
      throw new Error("integration agent must be a string");
    }
    const agent = parseAgentId(value.agent);
    if (value.mode !== "native" && value.mode !== "memory") {
      throw new Error("integration mode must be native or memory");
    }
    if (
      (NATIVE_AGENT_IDS as readonly string[]).includes(agent) &&
      value.mode !== "native"
    ) {
      throw new Error(`native agent must use native mode: ${agent}`);
    }
    if (agent.startsWith("generic:") && value.mode !== "memory") {
      throw new Error(`generic agent must use memory mode: ${agent}`);
    }
    if (value.path !== undefined && typeof value.path !== "string") {
      throw new Error("integration path must be a string");
    }
    if (agents.has(agent)) {
      throw new Error(`duplicate integration agent: ${agent}`);
    }
    agents.add(agent);
    return value.path === undefined
      ? { agent, mode: value.mode }
      : { agent, mode: value.mode, path: value.path };
  });

  return normalized.sort((left, right) =>
    left.agent < right.agent ? -1 : left.agent > right.agent ? 1 : 0,
  );
}
