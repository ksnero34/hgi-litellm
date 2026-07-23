import type { Metadata } from "next";
import "./globals.css";

import AntdGlobalProvider from "@/contexts/AntdGlobalProvider";
import I18nProvider from "@/i18n/I18nProvider";
import { AuthProvider } from "@/contexts/AuthContext";
import ReactQueryProvider from "@/contexts/ReactQueryProvider";

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
          <ReactQueryProvider>
            <AntdGlobalProvider>
              <AuthProvider>{children}</AuthProvider>
            </AntdGlobalProvider>
          </ReactQueryProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
