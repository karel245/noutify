import type { NotificationLanguage } from "../config/language.js";

interface NotificationCopy {
  testTitle: string;
  testMessage: (project: string) => string;
  waitingTitle: string;
  waitingMessage: (project: string) => string;
}

const catalog: Record<NotificationLanguage, NotificationCopy> = {
  en: {
    testTitle: "Noutify connected",
    testMessage: (project: string) =>
      `${project}: Test notification delivered by Noutify.`,
    waitingTitle: "Agent waiting",
    waitingMessage: (project: string) =>
      `${project}: The agent finished its response and is waiting for instructions.`,
  },
  es: {
    testTitle: "Noutify conectado",
    testMessage: (project: string) =>
      `${project}: Notificación de prueba enviada por Noutify.`,
    waitingTitle: "Agente en espera",
    waitingMessage: (project: string) =>
      `${project}: El agente terminó su respuesta y espera instrucciones.`,
  },
};

export function notificationCopy(language: NotificationLanguage) {
  return catalog[language];
}
