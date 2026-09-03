import type { Metadata } from "next";
import "./globals.css";

import { NuqsAdapter } from "nuqs/adapters/next/app";
import { ThemeProvider } from "next-themes";

import AntdGlobalProvider from "@/contexts/AntdGlobalProvider";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/contexts/AuthContext";
import ReactQueryProvider from "@/contexts/ReactQueryProvider";
import I18nProvider from "@/i18n/I18nProvider";

export const metadata: Metadata = {
  title: "사내 LLM Gateway",
  description: "사내 LLM Gateway 관리 화면",
  icons: { icon: "/get_favicon" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // next-themes stamps the theme class on <html> before paint, which the exported markup
    // cannot predict; suppressHydrationWarning confines that mismatch to this element.
    <html lang="ko" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          <I18nProvider>
            <NuqsAdapter>
              <ReactQueryProvider>
                <AntdGlobalProvider>
                  <AuthProvider>{children}</AuthProvider>
                  <Toaster />
                </AntdGlobalProvider>
              </ReactQueryProvider>
            </NuqsAdapter>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
