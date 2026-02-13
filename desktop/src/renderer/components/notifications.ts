// TODO: leverage native desktop notifications instead of custom html

let notificationContainer: HTMLDivElement | null = null;

// wonder if there's a way to apply styles via CSS rather than inline styles

function getOrCreateContainer(): HTMLDivElement {
  if (!notificationContainer) {
    notificationContainer = document.createElement("div");
    notificationContainer.id = "notification-container";
    notificationContainer.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10000;
      display: flex;
      flex-direction: column;
      gap: 10px;
      pointer-events: none;
    `;
    document.body.appendChild(notificationContainer);
  }
  return notificationContainer;
}

type NotificationType = "success" | "error" | "info";

export function showNotification(
  message: string,
  type: NotificationType = "info",
  duration = 3000
): void {
  const container = getOrCreateContainer();

  const notification = document.createElement("div");
  notification.style.cssText = `
    padding: 12px 16px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    max-width: 300px;
    word-wrap: break-word;
    pointer-events: auto;
    animation: slideIn 0.3s ease-out;
    transition: opacity 0.3s ease-out;
  `;

  switch (type) {
    case "success":
      notification.style.backgroundColor = "#10b981";
      notification.style.color = "#ffffff";
      break;
    case "error":
      notification.style.backgroundColor = "#ef4444";
      notification.style.color = "#ffffff";
      break;
    case "info":
      notification.style.backgroundColor = "#3b82f6";
      notification.style.color = "#ffffff";
      break;
  }

  notification.textContent = message;

  if (!document.getElementById("notification-styles")) {
    const style = document.createElement("style");
    style.id = "notification-styles";
    style.textContent = `
      @keyframes slideIn {
        from {
          transform: translateX(400px);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
    `;
    document.head.appendChild(style);
  }

  container.appendChild(notification);

  setTimeout(() => {
    notification.style.opacity = "0";
    setTimeout(() => {
      if (notification.parentNode === container) {
        container.removeChild(notification);
      }
    }, 300);
  }, duration);
}
