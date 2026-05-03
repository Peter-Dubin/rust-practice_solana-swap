import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Solana Swap Demo",
  description: "Minimal UI for Solana Swap program",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-zinc-950 text-zinc-100 min-h-screen">{children}</body>
    </html>
  );
}
