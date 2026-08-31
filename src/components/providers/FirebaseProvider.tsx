"use client";

import { useEffect, type ReactNode } from "react";
import { getFirebaseApp } from "@/lib/firebase/client";

export function FirebaseProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    getFirebaseApp();
  }, []);

  return children;
}
