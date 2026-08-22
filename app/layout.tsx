import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AnkiChat — Học tiếng Anh qua hội thoại AI",
  description:
    "Ứng dụng học tiếng Anh thông minh: lấy flashcard từ Anki, sinh hội thoại AI, luyện nói real-time với Gemini Live.",
  keywords: ["học tiếng anh", "anki", "flashcard", "AI", "hội thoại", "gemini"],
};

/**
 * `viewportFit: "cover"` is what makes `env(safe-area-inset-*)` resolve to
 * anything but `0`. Without it the session screen's bottom control row sits
 * under the home indicator on a notched phone and its inset padding is inert.
 * The other two fields are Next's own defaults, restated because declaring the
 * export replaces the default tag wholesale.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Dark is the only mode this story ships. The attribute is set explicitly
    // rather than left off so `[data-theme="light"]` in globals.css has a
    // switch to flip when a later story adds one — DESIGN.md rejects following
    // the OS, so there is deliberately no `prefers-color-scheme` fallback.
    <html lang="vi" data-theme="dark" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <div className="bg-ambient" aria-hidden="true" />
        <div style={{ position: "relative", zIndex: 1 }}>
          {children}
        </div>
      </body>
    </html>
  );
}
