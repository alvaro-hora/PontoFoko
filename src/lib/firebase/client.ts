import { initializeApp, getApps, type FirebaseApp } from "firebase/app";

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value?.trim() || undefined;
}

export function isFirebaseConfigured(): boolean {
  return Boolean(
    readEnv("NEXT_PUBLIC_FIREBASE_API_KEY") &&
      readEnv("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN") &&
      readEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID"),
  );
}

export function getFirebaseApp(): FirebaseApp | null {
  if (!isFirebaseConfigured()) return null;
  if (getApps().length > 0) {
    return getApps()[0]!;
  }
  return initializeApp({
    apiKey: readEnv("NEXT_PUBLIC_FIREBASE_API_KEY")!,
    authDomain: readEnv("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN")!,
    projectId: readEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID")!,
    storageBucket: readEnv("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET"),
    messagingSenderId: readEnv("NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"),
    appId: readEnv("NEXT_PUBLIC_FIREBASE_APP_ID"),
  });
}
