import type { NotificationLanguage } from "../config/language.js";
import { notificationCopy } from "./notification-catalog.js";
import type { Notification } from "./types.js";

export function createWaitingNotification(
  projectName: string,
  language: NotificationLanguage,
): Notification {
  const copy = notificationCopy(language);
  return {
    title: copy.waitingTitle,
    message: copy.waitingMessage(projectName),
    tags: ["speech_balloon", "hourglass"],
    priority: "default",
  };
}
