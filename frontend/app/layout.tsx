import type { Metadata } from "next";
import { AuthGate } from "@/components/AuthGate";
import "./styles.css";

export const metadata: Metadata = {
  title: "Synapse AI",
  description: "Synapse multi-agent AI/ML operations dashboard",
  icons: {
    icon: "/synapse.png",
    shortcut: "/synapse.png",
    apple: "/synapse.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
