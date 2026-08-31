import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Plus_Jakarta_Sans, Syne } from "next/font/google";
import { AppShell } from "@/components/AppShell";
import { AuthProvider, FirebaseProvider, RoutineProvider } from "@/components/providers";
import "./globals.css";

const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const ibm = IBM_Plex_Mono({
  variable: "--font-ibm",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "PontoFoko",
  description:
    "Registre o começo e o fim de cada horário com selfie, veja o que já fez, o que faltou e o que rolou a mais.",
  icons: {
    icon: [
      { url: "/icon.png", type: "image/png" },
      { url: "/logo.png", type: "image/png" },
    ],
    apple: [{ url: "/logo.png", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#eef1f4",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${syne.variable} ${jakarta.variable} ${ibm.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <FirebaseProvider>
          <AuthProvider>
            <RoutineProvider>
              <AppShell>{children}</AppShell>
            </RoutineProvider>
          </AuthProvider>
        </FirebaseProvider>
      </body>
    </html>
  );
}
