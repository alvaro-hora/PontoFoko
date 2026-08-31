export function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return Promise.resolve("denied");
  }
  if (Notification.permission === "granted") {
    return Promise.resolve("granted");
  }
  if (Notification.permission === "denied") {
    return Promise.resolve("denied");
  }
  return Notification.requestPermission();
}

export function notify(title: string, body: string, tag?: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  try {
    new Notification(title, {
      body,
      tag,
      silent: false,
    });
  } catch {
    // Alguns browsers exigem service worker; falha silenciosa
  }

  try {
    const audio = new Audio(
      "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdH2Onp6ViHFqZ3N+i5ubkYVyaWZze4mZmJCBcGhlc3qImJaOf25oZnJ5h5aWjn5sZ2VxeIWVlI19bGdkcHeGlJSMemtoZnB2hZOTjHlqZ2VvdYSTkoz",
    );
    void audio.play().catch(() => undefined);
  } catch {
    // ignore
  }
}
