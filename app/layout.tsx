import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AnkiChat — Học tiếng Anh qua hội thoại AI",
  description:
    "Ứng dụng học tiếng Anh thông minh: lấy flashcard từ Anki, sinh hội thoại AI, luyện nói real-time với Gemini Live.",
  keywords: ["học tiếng anh", "anki", "flashcard", "AI", "hội thoại", "gemini"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <div className="bg-ambient" aria-hidden="true" />
        <div style={{ position: "relative", zIndex: 1 }}>
          {children}
        </div>
      </body>
    </html>
  );
}
