import type { NotificationType } from "@/main/notifications";

export function showNotification(
  message: string,
  type: NotificationType = "info"
) {
  window.electronAPI.notify({ message, type });
}
