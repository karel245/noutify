import type { AgentId } from "../../config/integrations.js";
import type { AgentAdapter } from "../agent-adapter.js";
import {
  inspectMemoryIntegration,
  installMemoryIntegration,
  memoryInstructionPath,
  preflightMemoryIntegration,
  uninstallMemoryIntegration,
  type MemorySelection,
} from "../agent-memory.js";

export function createGenericMemoryAdapter(
  agent: AgentId,
  relativePath?: string,
): AgentAdapter {
  if (!agent.startsWith("generic:")) {
    throw new Error(`memory adapter requires a generic agent: ${agent}`);
  }
  const selection: MemorySelection = relativePath === undefined
    ? { agent }
    : { agent, relativePath };
  const adapter: AgentAdapter = {
    id: agent,
    mode: "memory",
    ownedPaths: () => [
      memoryInstructionPath(agent),
      ...(relativePath === undefined ? [] : [relativePath]),
    ],
    preflight: (context) =>
      preflightMemoryIntegration(context.projectRoot, selection),
    install: (context) =>
      installMemoryIntegration(context.projectRoot, selection, context.runtime),
    inspect: (context) =>
      inspectMemoryIntegration(context.projectRoot, selection, context.runtime),
    uninstall: (context) =>
      uninstallMemoryIntegration(context.projectRoot, selection, context.runtime),
  };
  if (relativePath !== undefined) adapter.publicPath = relativePath;
  return adapter;
}
