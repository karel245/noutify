import type { Notification } from "./types.js";

export function createWaitingNotification(projectName: string): Notification {
  return {
    title: "Agent waiting",
    message: `${projectName}: The agent finished its response and is waiting for the next prompt.`,
    tags: ["speech_balloon", "hourglass"],
    priority: "default",
  };
}
