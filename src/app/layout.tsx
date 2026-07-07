import type { Metadata, Viewport } from "next";
import "./globals.css";
import { MobileNav } from "@/components/MobileNav";
import { Sidebar } from "@/components/Sidebar";

export const metadata: Metadata = {
  // Per-page titles fill the %s; pages without their own title get the default.
  title: {
    default: "Finance Engine",
    template: "%s · Finance Engine",
  },
  applicationName: "Finance Engine",
  description: "Private, locally self-hosted personal finance engine",
  appleWebApp: {
    title: "Finance Engine",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // page-plane tokens from globals.css
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9f9f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0d0d" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <MobileNav />
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="min-w-0 flex-1 px-4 py-4 md:px-8 md:py-6 max-w-5xl">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
