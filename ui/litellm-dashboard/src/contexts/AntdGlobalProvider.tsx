"use client";

import React, { useEffect, useRef } from "react";
import { ConfigProvider, notification, message } from "antd";
import enUS from "antd/locale/en_US";
import koKR from "antd/locale/ko_KR";
import { useTranslation } from "react-i18next";
import { StyleProvider } from "@ant-design/cssinjs";
import { setNotificationInstance } from "@/components/molecules/notifications_manager";
import { setMessageInstance } from "@/components/molecules/message_manager";

export default function AntdGlobalProvider({ children }: { children: React.ReactNode }) {
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage === "en" ? enUS : koKR;
  const [notificationApi, notificationContextHolder] = notification.useNotification();
  const [messageApi, messageContextHolder] = message.useMessage();
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      setNotificationInstance(notificationApi);
      setMessageInstance(messageApi);
      initialized.current = true;
    }
  }, [notificationApi, messageApi]);

  return (
    <StyleProvider layer>
      <ConfigProvider locale={locale} theme={{ cssVar: true }}>
        {notificationContextHolder}
        {messageContextHolder}
        {children}
      </ConfigProvider>
    </StyleProvider>
  );
}
