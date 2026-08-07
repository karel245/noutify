export type NoutifyEventType =
  | "WAITING"
  | "ACTION_REQUIRED"
  | "COMPLETED"
  | "BLOCKED"
  | "ERROR";

export interface NoutifyEvent {
  type: NoutifyEventType;
  occurredAt: string;
  project: string;
  agent?: string;
  sessionId?: string;
  sourceEvent?: string;
  summary?: string;
  correlationId?: string;
}

export interface Notification {
  title: string;
  message: string;
  tags: string[];
  priority: "default" | "high" | "urgent";
}
