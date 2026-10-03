import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shoebox Studio",
  description: "Review, preview and approve episodes",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#0e1113", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans text-[15px] antialiased">{children}</body>
    </html>
  );
}
