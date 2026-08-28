import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import { CheckOutlined, CopyOutlined, SyncOutlined } from "@ant-design/icons";
import { Alert, Button, Col, Flex, Form, Input, InputNumber, Modal, Row, Space, Typography } from "antd";
import { useEffect, useState } from "react";
import { CopyToClipboard } from "react-copy-to-clipboard";
import { useTranslation } from "react-i18next";
import { KeyResponse } from "../key_team_helpers/key_list";
import NotificationManager from "../molecules/notifications_manager";
import { personalKeyRotateCall, regenerateKeyCall } from "../networking";
import { calculateExpiryPreviewFromDuration, formatExpiresUtc, isKeyExpired } from "@/utils/keyExpiryUtils";

const { Text } = Typography;

interface RegenerateKeyModalProps {
  selectedToken: KeyResponse | null;
  visible: boolean;
  onClose: () => void;
  onKeyUpdate?: (updatedKeyData: Partial<KeyResponse>) => void;
}

export function RegenerateKeyModal({ selectedToken, visible, onClose, onKeyUpdate }: RegenerateKeyModalProps) {
  const { t } = useTranslation();
  const { accessToken } = useAuthorized();
  const [form] = Form.useForm();
  const [regeneratedKey, setRegeneratedKey] = useState<string | null>(null);
  const [previousKeyRevokeAt, setPreviousKeyRevokeAt] = useState<string | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  const keyIsExpired = isKeyExpired(selectedToken?.expires);
  const durationValue = Form.useWatch("duration", form);
  const durationRule = {
    pattern: /^(\d+(s|m|h|d|w|mo))?$/,
    message: t("gateway.regenerate.durationPattern"),
  };

  // Expired keys must get a new duration, otherwise regeneration produces a key
  // that inherits the old (past) expiry and is immediately unusable.
  const durationRules = keyIsExpired
    ? [{ required: true, message: t("gateway.regenerate.expiredDurationRequired") }, durationRule]
    : [durationRule];

  useEffect(() => {
    if (visible && selectedToken && accessToken) {
      form.setFieldsValue({
        key_alias: selectedToken.key_alias,
        max_budget: selectedToken.max_budget,
        tpm_limit: selectedToken.tpm_limit,
        rpm_limit: selectedToken.rpm_limit,
        duration: selectedToken.duration || "",
        grace_period: "",
      });
    }
  }, [visible, selectedToken, form, accessToken]);

  const newExpiryTime = durationValue ? calculateExpiryPreviewFromDuration(durationValue) : null;

  const handleRegenerateKey = async () => {
    if (!selectedToken || !accessToken) return;

    setIsRegenerating(true);
    try {
      const formValues = await form.validateFields();
      const personalKeyMetadata = selectedToken.metadata?.personal_key;
      const isManagedPersonalKey =
        personalKeyMetadata != null &&
        typeof personalKeyMetadata === "object" &&
        personalKeyMetadata.key_purpose === "personal_llm";

      const response =
        isManagedPersonalKey && selectedToken.user_id
          ? await personalKeyRotateCall(accessToken, selectedToken.user_id)
          : await regenerateKeyCall(accessToken, selectedToken.token || selectedToken.token_id, formValues);
      setRegeneratedKey(response.key);
      setPreviousKeyRevokeAt(response.previous_key_revoke_at || null);
      NotificationManager.success(t("gateway.regenerate.success"));

      // Build the update payload. Spread the API response first so any new
      // fields it returns (new token, timestamps, etc.) are captured, then
      // override with the explicit form values — the user's just-submitted
      // edits must win over whatever the API echoes back.
      // expires must come from the API (an ISO string), never the locale-
      // formatted preview, otherwise downstream expiry parsing breaks.
      const updatedKeyData: Partial<KeyResponse> = {
        ...response,
        token: response.token || response.key_id || selectedToken.token,
        key_name: response.key,
        max_budget: formValues.max_budget,
        tpm_limit: formValues.tpm_limit,
        rpm_limit: formValues.rpm_limit,
        expires: response.expires ?? selectedToken.expires,
      };

      // Update the parent component with new key data
      if (onKeyUpdate) {
        onKeyUpdate(updatedKeyData);
      }

      setIsRegenerating(false);
    } catch (error) {
      setIsRegenerating(false); // Reset regenerating state on error
      // Ant Design form validation rejections surface inline under the field;
      // don't also raise a backend-style toast for them.
      if (error && typeof error === "object" && "errorFields" in error) {
        return;
      }
      console.error("Error regenerating key:", error);
      NotificationManager.fromBackend(error);
    }
  };

  const handleClose = () => {
    setRegeneratedKey(null);
    setPreviousKeyRevokeAt(null);
    setIsRegenerating(false);
    setCopied(false);
    form.resetFields();
    onClose();
  };

  const handleCopyKey = () => {
    setCopied(true);
  };

  return (
    <Modal
      title={t("gateway.regenerate.title")}
      open={visible}
      onCancel={handleClose}
      width={520}
      maskClosable={false}
      footer={
        regeneratedKey
          ? [
              <Space key="footer-actions">
                <Button onClick={handleClose} aria-label="Close">
                  {t("gateway.regenerate.close")}
                </Button>
                <CopyToClipboard text={regeneratedKey} onCopy={handleCopyKey}>
                  <Button
                    type="primary"
                    icon={copied ? <CheckOutlined /> : <CopyOutlined />}
                    aria-label={copied ? t("gateway.regenerate.copied") : t("gateway.regenerate.copy")}
                  >
                    {copied ? t("gateway.regenerate.copied") : t("gateway.regenerate.copy")}
                  </Button>
                </CopyToClipboard>
              </Space>,
            ]
          : [
              <Space key="footer-actions">
                <Button onClick={handleClose} aria-label="Cancel">
                  {t("gateway.regenerate.cancel")}
                </Button>
                <Button
                  type="primary"
                  icon={<SyncOutlined />}
                  onClick={handleRegenerateKey}
                  loading={isRegenerating}
                  aria-label={t("gateway.regenerate.issue")}
                >
                  {t("gateway.regenerate.issue")}
                </Button>
              </Space>,
            ]
      }
    >
      {regeneratedKey ? (
        <Flex vertical gap="middle">
          <Alert type="warning" showIcon message={t("gateway.regenerate.saveWarning")} />
          {previousKeyRevokeAt ? (
            <Alert
              type="info"
              showIcon
              message={t("gateway.regenerate.previousKeyWindow")}
              description={t("gateway.regenerate.previousKeyRevokeAt", {
                value: formatExpiresUtc(previousKeyRevokeAt),
              })}
            />
          ) : (
            <Alert type="warning" showIcon message={t("gateway.regenerate.previousKeyUnavailable")} />
          )}

          <Flex vertical gap={2}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t("gateway.regenerate.keyAlias")}
            </Text>
            <Text>{selectedToken?.key_alias || t("gateway.regenerate.noAlias")}</Text>
          </Flex>

          <Flex vertical gap={6}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t("gateway.regenerate.virtualKey")}
            </Text>
            <div
              style={{
                background: "#f5f5f5",
                border: "1px solid #e8e8e8",
                borderRadius: 6,
                padding: "14px 16px",
                fontFamily: "SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace",
                fontSize: 16,
                wordBreak: "break-all",
                color: "#262626",
              }}
            >
              {regeneratedKey}
            </div>
          </Flex>
        </Flex>
      ) : (
        <Form form={form} layout="vertical" style={{ marginTop: 4 }}>
          <Form.Item name="key_alias" label={t("gateway.regenerate.keyAlias")}>
            <Input disabled aria-label="Key Alias" />
          </Form.Item>

          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="max_budget" label={t("gateway.regenerate.maxBudget")}>
                <InputNumber step={0.01} precision={2} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="tpm_limit" label={t("gateway.regenerate.tpmLimit")}>
                <InputNumber style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="rpm_limit" label={t("gateway.regenerate.rpmLimit")}>
                <InputNumber style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                name="duration"
                label={t("gateway.regenerate.expireKey")}
                rules={durationRules}
                extra={
                  <Flex vertical gap={2}>
                    <Text type={keyIsExpired ? "danger" : "secondary"} style={{ fontSize: 12 }}>
                      {t("gateway.regenerate.currentExpiry", {
                        value: selectedToken?.expires
                          ? formatExpiresUtc(selectedToken.expires)
                          : t("gateway.regenerate.never"),
                      })}
                      {keyIsExpired ? ` ${t("gateway.regenerate.expired")}` : ""}
                    </Text>
                    {newExpiryTime && (
                      <Text type="success" style={{ fontSize: 12 }}>
                        {t("gateway.regenerate.newExpiry", { value: newExpiryTime })}
                      </Text>
                    )}
                  </Flex>
                }
              >
                <Input placeholder={t("gateway.regenerate.durationPlaceholder")} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="grace_period"
                label={t("gateway.regenerate.gracePeriod")}
                extra={
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t("gateway.regenerate.graceRecommendation")}
                  </Text>
                }
                rules={[durationRule]}
              >
                <Input placeholder={t("gateway.regenerate.gracePlaceholder")} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      )}
    </Modal>
  );
}
