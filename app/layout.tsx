import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NavHeader } from "@/components/NavHeader";
import { NavigationBlockerProvider } from "@/components/NavigationBlocker";
import { getCurrentUser } from "@/lib/auth/dal";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Alliance Stats Tracker",
  description: "Screenshot pipeline for alliance stats tracking",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();

  return (
    <html
      lang="en"
      data-theme={user?.theme ?? "default"}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-neutral-50 text-neutral-900">
        <NavigationBlockerProvider>
          <NavHeader user={user ? { name: user.name, role: user.role } : null} />
          <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-6">{children}</main>
        </NavigationBlockerProvider>
      </body>
    </html>
  );
}
