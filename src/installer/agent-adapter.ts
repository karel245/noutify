import type { NativeAgentId } from "../config/integrations.js";
import { claudeCodeAdapter } from "./adapters/claude-code.js";

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
}

export interface AgentAdapter {
  id: NativeAgentId;
  mode: "native";
  publicPath: string;
  ownedPaths(context: AdapterContext): string[];
  preflight(context: AdapterContext): Promise<void>;
  install(context: AdapterContext): Promise<AdapterMutation>;
  inspect(context: AdapterContext): Promise<AdapterInspection>;
  uninstall(context: AdapterContext): Promise<AdapterMutation>;
}

export function nativeAdapter(id: NativeAgentId): AgentAdapter {
  if (id === "claude-code") {
    return claudeCodeAdapter;
  }
  throw new Error(`native adapter is not available: ${id}`);
}
