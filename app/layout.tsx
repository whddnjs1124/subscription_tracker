import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Sub Tracker",
  description: "Find and manage your recurring subscriptions from bank statements.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-gradient-to-b from-zinc-50 to-zinc-100/60 text-zinc-900 dark:from-zinc-950 dark:to-zinc-950 dark:text-zinc-100">
        <div className="flex min-h-screen flex-col sm:flex-row">
          <Sidebar />
          <main className="flex-1 px-5 py-6 sm:px-10 sm:py-10">{children}</main>
        </div>
      </body>
    </html>
  );
}
