import { ipcMain, Notification, BrowserWindow } from "electron";

export type NotificationType = "success" | "error" | "info";

function isMainWindowFocused(): boolean {
  const allWindows = BrowserWindow.getAllWindows();
  if (allWindows.length === 0) return false;
  return allWindows[0].isFocused();
}

function getNotificationOptions(
  message: string,
  type: NotificationType
): Electron.NotificationConstructorOptions {
  const base: Electron.NotificationConstructorOptions = {
    body: message
  };

  switch (type) {
    case "error":
      base.title = "Fly on the Wall — Error";
      base.urgency = "critical";
      base.silent = false;
      break;
    case "success":
      base.title = "Fly on the Wall";
      base.urgency = "low";
      base.silent = true;
      break;
    case "info":
    default:
      base.title = "Fly on the Wall";
      base.urgency = "normal";
      base.silent = true;
      break;
  }

  return base;
}

ipcMain.handle(
  "notify",
  async (_event, data: { message: string; type?: NotificationType }) => {
    try {
      const type = data.type ?? "info";

      if (isMainWindowFocused()) {
        return { success: true, suppressed: true };
      }

      if (!Notification.isSupported()) {
        console.warn("Native notifications are not supported on this system");
        return { success: false, error: "Notifications not supported" };
      }

      const options = getNotificationOptions(data.message, type);
      const notification = new Notification(options);
      notification.show();

      return { success: true, suppressed: false };
    } catch (error) {
      console.error("Error showing notification:", error);
      return { success: false, error: String(error) };
    }
  }
);
