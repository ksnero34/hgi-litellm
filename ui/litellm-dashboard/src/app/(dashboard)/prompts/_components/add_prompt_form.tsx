import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Form, Select, Upload, Button, Divider } from "antd";
import { TextInput } from "@tremor/react";
import { UploadOutlined } from "@ant-design/icons";
import type { UploadFile, UploadProps } from "antd";
import { convertPromptFileToJson, createPromptCall } from "@/components/networking";
import NotificationsManager from "@/components/molecules/notifications_manager";

const { Option } = Select;

interface AddPromptFormProps {
  visible: boolean;
  onClose: () => void;
  accessToken: string | null;
  onSuccess: () => void;
}

const AddPromptForm: React.FC<AddPromptFormProps> = ({ visible, onClose, accessToken, onSuccess }) => {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [promptIntegration, setPromptIntegration] = useState<string>("dotprompt");

  const handleCancel = () => {
    form.resetFields();
    setFileList([]);
    setPromptIntegration("dotprompt");
    onClose();
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();

      if (!accessToken) {
        NotificationsManager.fromBackend(t("interactionExtra.prompts.tokenRequired"));
        return;
      }

      if (promptIntegration === "dotprompt" && fileList.length === 0) {
        NotificationsManager.fromBackend(t("interactionExtra.prompts.uploadRequired"));
        return;
      }

      setLoading(true);

      let promptData: any = {};

      if (promptIntegration === "dotprompt" && fileList.length > 0) {
        // Convert the uploaded file to JSON
        const file = fileList[0].originFileObj as File;

        try {
          const conversionResult = await convertPromptFileToJson(accessToken, file);

          // Prepare prompt data for creation
          promptData = {
            prompt_id: values.prompt_id,
            litellm_params: {
              prompt_integration: "dotprompt",
              prompt_id: conversionResult.prompt_id,
              prompt_data: conversionResult.json_data,
            },
            prompt_info: {
              prompt_type: "db",
            },
          };
        } catch (conversionError) {
          console.error("Error converting prompt file:", conversionError);
          NotificationsManager.fromBackend(t("interactionExtra.prompts.convertFailed"));
          setLoading(false);
          return;
        }
      }

      // Create the prompt
      try {
        await createPromptCall(accessToken, promptData);
        NotificationsManager.success(t("interactionExtra.prompts.created"));
        handleCancel();
        onSuccess();
      } catch (createError) {
        console.error("Error creating prompt:", createError);
        NotificationsManager.fromBackend(t("interactionExtra.prompts.createFailed"));
      }
    } catch (error) {
      console.error("Form validation error:", error);
    } finally {
      setLoading(false);
    }
  };

  const uploadProps: UploadProps = {
    beforeUpload: (file) => {
      if (!file.name.endsWith(".prompt")) {
        NotificationsManager.fromBackend(t("interactionExtra.prompts.uploadRequired"));
        return false;
      }
      return false; // Prevent automatic upload
    },
    fileList,
    onChange: ({ fileList: newFileList }) => {
      setFileList(newFileList.slice(-1)); // Keep only the last file
    },
    onRemove: () => {
      setFileList([]);
    },
  };

  return (
    <Modal
      title={t("interactionExtra.prompts.addTitle")}
      open={visible}
      onCancel={handleCancel}
      footer={[
        <Button key="cancel" onClick={handleCancel}>
          {t("interactionExtra.prompts.cancel")}
        </Button>,
        <Button key="submit" loading={loading} onClick={handleSubmit}>
          {t("interactionExtra.prompts.create")}
        </Button>,
      ]}
      width={600}
    >
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item
          label={t("interactionExtra.prompts.id")}
          name="prompt_id"
          rules={[
            { required: true, message: t("interactionExtra.prompts.idRequired") },
            {
              pattern: /^[a-zA-Z0-9_-]+$/,
              message: t("interactionExtra.prompts.idInvalid"),
            },
          ]}
        >
          <TextInput placeholder={t("interactionExtra.prompts.idPlaceholder")} />
        </Form.Item>

        <Form.Item label={t("interactionExtra.prompts.integration")} name="prompt_integration" initialValue="dotprompt">
          <Select value={promptIntegration} onChange={setPromptIntegration}>
            <Option value="dotprompt">dotprompt</Option>
          </Select>
        </Form.Item>

        {promptIntegration === "dotprompt" && (
          <>
            <Divider />
            <Form.Item label={t("interactionExtra.prompts.file")} extra={t("interactionExtra.prompts.fileHelp")}>
              <Upload {...uploadProps}>
                <Button icon={<UploadOutlined />}>{t("interactionExtra.prompts.selectFile")}</Button>
              </Upload>
              {fileList.length > 0 && (
                <div className="mt-2 text-sm text-gray-600">
                  {t("interactionExtra.prompts.selected", { name: fileList[0].name })}
                </div>
              )}
            </Form.Item>
          </>
        )}
      </Form>
    </Modal>
  );
};

export default AddPromptForm;
