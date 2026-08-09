import type {
  AgentId,
  IntegrationMode,
  NativeAgentId,
} from "../config/integrations.js";
import { claudeCodeAdapter } from "./adapters/claude-code.js";
import { codexAdapter } from "./adapters/codex.js";
import { copilotCliAdapter } from "./adapters/copilot-cli.js";
import { geminiCliAdapter } from "./adapters/gemini-cli.js";
import { windsurfAdapter } from "./adapters/windsurf.js";

export interface RuntimePaths {
  nodePath: string;
  cliPath: string;
}

export interface AdapterContext {
  projectRoot: string;
  runtime: RuntimePaths;
}

export interface AdapterInspection {
  installed: boolean;
  detail: string;
}

export interface AdapterMutation {
  changed: boolean;
  pending?: boolean;
}

export interface AgentAdapter {
  id: AgentId;
  mode: IntegrationMode;
  publicPath?: string;
  ownedPaths(context: AdapterContext): string[];
  preflight(context: AdapterContext): Promise<void>;
  install(context: AdapterContext): Promise<AdapterMutation>;
  inspect(context: AdapterContext): Promise<AdapterInspection>;
  uninstall(context: AdapterContext): Promise<AdapterMutation>;
}

export const AVAILABLE_NATIVE_ADAPTERS: ReadonlyMap<NativeAgentId, AgentAdapter> =
  new Map([
    ["claude-code", claudeCodeAdapter],
    ["codex", codexAdapter],
    ["copilot-cli", copilotCliAdapter],
    ["gemini-cli", geminiCliAdapter],
    ["windsurf", windsurfAdapter],
  ]);

export function nativeAdapter(id: NativeAgentId): AgentAdapter {
  const adapter = AVAILABLE_NATIVE_ADAPTERS.get(id);
  if (adapter === undefined) {
    throw new Error(`native adapter is not available: ${id}`);
  }
  return adapter;
}
