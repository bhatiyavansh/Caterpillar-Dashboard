import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AppProviders } from "@/components/app-providers";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-stack", display: "swap" });

export const metadata: Metadata = {
  title: "CAT Visual Assist",
  description:
    "Fleet monitoring and in-cab visual assistant for heavy construction and mining equipment.",
};

export const viewport: Viewport = {
  themeColor: "#0a0b0d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-ink-950 text-zinc-100 antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
