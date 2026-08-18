import React from "react";
import { useTranslation } from "react-i18next";
import { Form, Button, Tooltip, Typography, Modal } from "antd";
import { TextInput } from "@tremor/react";
import { CredentialItem } from "../networking";
const { Link } = Typography;

interface ReuseCredentialsModalProps {
  isVisible: boolean;
  onCancel: () => void;
  onAddCredential: (values: any) => void;
  existingCredential: CredentialItem | null;
  setIsCredentialModalOpen: (isVisible: boolean) => void;
}

const ReuseCredentialsModal: React.FC<ReuseCredentialsModalProps> = ({
  isVisible,
  onCancel,
  onAddCredential,
  existingCredential,
  setIsCredentialModalOpen,
}) => {
  const { t } = useTranslation();
  const [form] = Form.useForm();

  const handleSubmit = (values: any) => {
    onAddCredential(values);
    form.resetFields();
    setIsCredentialModalOpen(false);
  };

  return (
    <Modal
      title={t("modelManagement.reuseCredentials")}
      open={isVisible}
      onCancel={() => {
        onCancel();
        form.resetFields();
      }}
      footer={null}
      width={600}
    >
      <Form form={form} onFinish={handleSubmit} layout="vertical">
        {/* Credential Name */}
        <Form.Item
          label={t("modelManagement.credentialName")}
          name="credential_name"
          rules={[{ required: true, message: t("modelManagement.credentialNameRequired") }]}
          initialValue={existingCredential?.credential_name}
        >
          <TextInput placeholder={t("modelManagement.credentialNamePlaceholder")} />
        </Form.Item>

        {/* Display Credential Values of existingCredential, don't allow user to edit. Credential values is a dictionary */}
        {Object.entries(existingCredential?.credential_values || {}).map(([key, value]) => (
          <Form.Item key={key} label={key} name={key} initialValue={value}>
            <TextInput placeholder={`Enter ${key}`} disabled={true} />
          </Form.Item>
        ))}

        {/* Modal Footer */}
        <div className="flex justify-between items-center">
          <Tooltip title={t("modelManagement.helpTooltip")}>
            <Link href="https://github.com/BerriAI/litellm/issues">{t("modelManagement.needHelp")}</Link>
          </Tooltip>

          <div>
            <Button
              onClick={() => {
                onCancel();
                form.resetFields();
              }}
              style={{ marginRight: 10 }}
            >
              Cancel
            </Button>
            <Button htmlType="submit">{t("modelManagement.reuseCredentials")}</Button>
          </div>
        </div>
      </Form>
    </Modal>
  );
};

export default ReuseCredentialsModal;
