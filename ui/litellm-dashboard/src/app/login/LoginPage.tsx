"use client";

import { useLogin } from "@/app/(dashboard)/hooks/login/useLogin";
import { useUIConfig } from "@/app/(dashboard)/hooks/uiConfig/useUIConfig";
import LoadingScreen from "@/components/common_components/LoadingScreen";
import { exchangeLoginCode, getProxyBaseUrl, switchToWorkerUrl } from "@/components/networking";
import { useWorker } from "@/hooks/useWorker";
import { clearTokenCookies, getCookieFromDocument } from "@/utils/cookieUtils";
import { isJwtExpired } from "@/utils/jwtUtils";
import { consumeReturnUrl, getReturnUrl, isValidReturnUrl } from "@/utils/returnUrlUtils";
import { CloudServerOutlined, InfoCircleOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Form, Input, Popover, Select, Space, Typography } from "antd";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

function LoginPageContent() {
  const { t } = useTranslation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const { data: uiConfig, isLoading: isConfigLoading } = useUIConfig();
  const loginMutation = useLogin();
  const router = useRouter();
  const { workers, selectWorker } = useWorker();
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const workerParam = params.get("worker");
    if (workerParam) {
      setSelectedWorkerId(workerParam);
    }
  }, []);

  useEffect(() => {
    if (isConfigLoading) {
      return;
    }

    if (uiConfig && uiConfig.admin_ui_disabled) {
      setIsLoading(false);
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const rawSsoCode = params.get("code");
    const ssoCode = rawSsoCode && /^[a-zA-Z0-9._~+/=-]+$/.test(rawSsoCode) ? rawSsoCode : null;
    if (ssoCode) {
      const rawWorkerUrl = localStorage.getItem("litellm_worker_url");
      const workerUrl = rawWorkerUrl && /^https?:\/\/.+/.test(rawWorkerUrl) ? rawWorkerUrl : null;
      exchangeLoginCode(ssoCode, workerUrl).then(() => {
        params.delete("code");
        const cleanSearch = params.toString();
        window.history.replaceState(null, "", window.location.pathname + (cleanSearch ? `?${cleanSearch}` : ""));
        router.replace("/ui/?login=success");
      });
      return;
    }

    const switchingWorker = params.has("worker");
    if (switchingWorker && uiConfig?.is_control_plane) {
      clearTokenCookies();
      setIsLoading(false);
      return;
    }

    const rawToken = getCookieFromDocument("token");
    if (rawToken && !isJwtExpired(rawToken)) {
      const returnUrl = consumeReturnUrl();
      if (returnUrl) {
        router.replace(returnUrl);
      } else {
        router.replace("/ui");
      }
      return;
    }

    if (uiConfig && uiConfig.auto_redirect_to_sso) {
      const returnUrl = getReturnUrl();
      let ssoUrl = `${getProxyBaseUrl()}/sso/key/generate`;
      if (returnUrl && isValidReturnUrl(returnUrl)) {
        ssoUrl += `?redirect_to=${encodeURIComponent(returnUrl)}`;
      }
      router.push(ssoUrl);
      return;
    }

    setIsLoading(false);
  }, [isConfigLoading, router, uiConfig]);

  const handleSubmit = () => {
    const selectedWorker = workers.find((worker) => worker.worker_id === selectedWorkerId);
    if (selectedWorker) {
      switchToWorkerUrl(selectedWorker.url);
    }

    loginMutation.mutate(
      { username, password, useV3: !!selectedWorker },
      {
        onSuccess: (data) => {
          if (selectedWorker) {
            selectWorker(selectedWorker.worker_id);
            router.push("/ui/?login=success");
          } else {
            const returnUrl = consumeReturnUrl();
            if (returnUrl) {
              router.push(returnUrl);
            } else {
              router.push(data.redirect_url);
            }
          }
        },
        onError: () => {
          if (selectedWorker) {
            switchToWorkerUrl(null);
          }
        },
      },
    );
  };

  const error = loginMutation.error instanceof Error ? loginMutation.error.message : null;
  const isLoginLoading = loginMutation.isPending;

  const { Paragraph, Text, Title } = Typography;

  if (isConfigLoading || isLoading) {
    return <LoadingScreen />;
  }

  if (uiConfig && uiConfig.admin_ui_disabled) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-lg shadow-md">
          <Space direction="vertical" size="middle" className="w-full">
            <div className="text-center">
              <Title level={2}>{t("app.name")}</Title>
            </div>

            <Alert
              message={t("auth.login.adminUiDisabled.title")}
              description={
                <>
                  <Paragraph className="text-sm">{t("auth.login.adminUiDisabled.description")}</Paragraph>
                  <Paragraph className="text-sm">
                    <code className="bg-gray-100 px-1 py-0.5 rounded-sm text-xs">DISABLE_ADMIN_UI=False</code>
                  </Paragraph>
                </>
              }
              type="warning"
              showIcon
            />
          </Space>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-lg shadow-md">
        <Space direction="vertical" size="middle" className="w-full">
          <div className="text-center">
            <Title level={2}>{t("app.name")}</Title>
          </div>

          <div className="text-center">
            <Title level={3}>{t("auth.login.title")}</Title>
            <Text type="secondary">{t("auth.login.subtitle")}</Text>
          </div>

          {!uiConfig?.hide_default_credentials_hint && (
            <Alert
              message={t("auth.login.defaultCredentials.title")}
              description={
                <Paragraph className="text-sm">
                  {t("auth.login.defaultCredentials.descriptionPrefix")}{" "}
                  <code className="bg-gray-100 px-1 py-0.5 rounded-sm text-xs">admin</code>{" "}
                  {t("auth.login.defaultCredentials.descriptionMiddle")}{" "}
                  <code className="bg-gray-100 px-1 py-0.5 rounded-sm text-xs">MASTER_KEY</code>.
                </Paragraph>
              }
              type="info"
              icon={<InfoCircleOutlined />}
              showIcon
            />
          )}

          {error && <Alert message={error} type="error" showIcon />}

          <Form onFinish={handleSubmit} layout="vertical" requiredMark={false}>
            {uiConfig?.is_control_plane && workers.length > 0 && (
              <Form.Item label={t("auth.login.worker.label")} style={{ marginBottom: 16 }}>
                <Select
                  value={selectedWorkerId || undefined}
                  onChange={(value) => setSelectedWorkerId(value)}
                  placeholder={t("auth.login.worker.placeholder")}
                  size="large"
                  suffixIcon={<CloudServerOutlined />}
                  options={workers.map((worker) => ({
                    label: worker.name,
                    value: worker.worker_id,
                  }))}
                />
              </Form.Item>
            )}

            <Form.Item
              label={t("auth.login.username.label")}
              name="username"
              rules={[
                {
                  required: true,
                  message: t("auth.login.username.required"),
                },
              ]}
            >
              <Input
                placeholder={t("auth.login.username.placeholder")}
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                disabled={isLoginLoading}
                size="large"
                className="rounded-md border-gray-300"
              />
            </Form.Item>

            <Form.Item
              label={t("auth.login.password.label")}
              name="password"
              rules={[
                {
                  required: true,
                  message: t("auth.login.password.required"),
                },
              ]}
            >
              <Input.Password
                placeholder={t("auth.login.password.placeholder")}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={isLoginLoading}
                size="large"
              />
            </Form.Item>

            <Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                loading={isLoginLoading}
                disabled={isLoginLoading}
                block
                size="large"
              >
                {isLoginLoading ? t("auth.login.actions.signingIn") : t("auth.login.actions.signIn")}
              </Button>
            </Form.Item>
            <Form.Item>
              {!uiConfig?.sso_configured ? (
                <Popover content={t("auth.login.sso.configureHint")} trigger="hover">
                  <Button disabled block size="large">
                    {t("auth.login.actions.signInWithSso")}
                  </Button>
                </Popover>
              ) : (
                <Button
                  disabled={isLoginLoading || (!!selectedWorkerId && workers.length === 0)}
                  onClick={() => {
                    const selectedWorker = workers.find((worker) => worker.worker_id === selectedWorkerId);
                    if (selectedWorker) {
                      localStorage.setItem("litellm_selected_worker_id", selectedWorkerId!);
                      switchToWorkerUrl(selectedWorker.url);
                    }
                    const ssoBase = selectedWorker?.url ?? getProxyBaseUrl();
                    const returnTo = encodeURIComponent(window.location.origin + "/ui/login");
                    router.push(`${ssoBase}/sso/key/generate?return_to=${returnTo}`);
                  }}
                  block
                  size="large"
                >
                  {t("auth.login.actions.signInWithSso")}
                </Button>
              )}
            </Form.Item>
          </Form>
        </Space>
        {uiConfig?.sso_configured && (
          <Alert
            type="info"
            showIcon
            closable
            message={
              <Text>
                {t("auth.login.sso.enabledNoticePrefix")} <Text code>AUTO_REDIRECT_UI_LOGIN_TO_SSO=true</Text>
                {t("auth.login.sso.enabledNoticeSuffix")}
              </Text>
            }
          />
        )}
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return <LoginPageContent />;
}
