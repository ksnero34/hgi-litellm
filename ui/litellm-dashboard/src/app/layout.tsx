import type { Metadata } from "next";
import "./globals.css";

import { NuqsAdapter } from "nuqs/adapters/next/app";

import AntdGlobalProvider from "@/contexts/AntdGlobalProvider";
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
    <html lang="ko">
      <body>
        <I18nProvider>
          <NuqsAdapter>
            <ReactQueryProvider>
              <AntdGlobalProvider>
                <AuthProvider>{children}</AuthProvider>
              </AntdGlobalProvider>
            </ReactQueryProvider>
          </NuqsAdapter>
        </I18nProvider>
      </body>
    </html>
  );
}
