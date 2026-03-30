import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

const headingMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-heading",
});

export const metadata: Metadata = {
  title: "Crop Thing",
  description: "Subject-aware image cropping for fast visual cleanup.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn(
        "dark",
        "h-full",
        "font-sans",
        geist.variable,
        geistMono.variable,
        headingMono.variable,
      )}
    >
      <body className="min-h-full flex flex-col antialiased">{children}</body>
    </html>
  );
}
