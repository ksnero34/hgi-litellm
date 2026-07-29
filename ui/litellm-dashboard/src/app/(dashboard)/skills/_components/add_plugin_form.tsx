import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Form, Input, Select } from "antd";
import MessageManager from "@/components/molecules/message_manager";
import { Button } from "@tremor/react";
import { registerClaudeCodePlugin } from "@/components/networking";
import {
  validatePluginName,
  isValidSemanticVersion,
  isValidEmail,
  isValidUrl,
  parseKeywords,
  parseSkillSource,
  isValidSubPath,
  SkillSourcePreview,
} from "@/components/claude_code_plugins/helpers";
import { PluginAuthor, PluginSource, SkillRegisterRequest } from "@/components/claude_code_plugins/types";

const { TextArea } = Input;
const { Option } = Select;

interface AddPluginFormProps {
  visible: boolean;
  onClose: () => void;
  accessToken: string | null;
  onSuccess: () => void;
}

interface AddPluginFormValues {
  name: string;
  skillUrl?: string;
  subPath?: string;
  version?: string;
  description?: string;
  authorName?: string;
  authorEmail?: string;
  homepage?: string;
  category?: string;
  keywords?: string;
  domain?: string;
  namespace?: string;
}

const buildAuthor = (values: AddPluginFormValues): PluginAuthor | undefined => {
  const name = values.authorName?.trim();
  const email = values.authorEmail?.trim();
  if (!name) {
    return undefined;
  }
  return email ? { name, email } : { name };
};

const buildRegisterRequest = (values: AddPluginFormValues, source: PluginSource): SkillRegisterRequest => {
  const author = buildAuthor(values);
  return {
    name: values.name.trim(),
    source,
    ...(values.version ? { version: values.version.trim() } : {}),
    ...(values.description ? { description: values.description.trim() } : {}),
    ...(author ? { author } : {}),
    ...(values.homepage ? { homepage: values.homepage.trim() } : {}),
    ...(values.category ? { category: values.category } : {}),
    ...(values.keywords ? { keywords: parseKeywords(values.keywords) } : {}),
    ...(values.domain ? { domain: values.domain.trim() } : {}),
    ...(values.namespace ? { namespace: values.namespace.trim() } : {}),
  };
};

const PREDEFINED_CATEGORIES = [
  "Development",
  "Productivity",
  "Learning",
  "Security",
  "Data & Analytics",
  "Integration",
  "Testing",
  "Documentation",
];

const AddPluginForm: React.FC<AddPluginFormProps> = ({ visible, onClose, accessToken, onSuccess }) => {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [urlPreview, setUrlPreview] = useState<SkillSourcePreview | null>(null);
  const [urlEncodesSubdir, setUrlEncodesSubdir] = useState(false);

  const recomputePreview = (skillUrl: string, subPath: string) => {
    const encodesSubdir = parseSkillSource(skillUrl)?.parsed.source === "git-subdir";
    setUrlEncodesSubdir(encodesSubdir);
    if (encodesSubdir && form.getFieldValue("subPath")) {
      form.setFieldsValue({ subPath: "" });
    }
    const preview = parseSkillSource(skillUrl, encodesSubdir ? undefined : subPath);
    setUrlPreview(preview);
    if (preview && !form.getFieldValue("name")) {
      form.setFieldsValue({ name: preview.suggestedName });
    }
  };

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    recomputePreview(e.target.value, form.getFieldValue("subPath") ?? "");
  };

  const handleSubPathChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    recomputePreview(form.getFieldValue("skillUrl") ?? "", e.target.value);
  };

  const handleSubmit = async (values: AddPluginFormValues) => {
    if (!accessToken) {
      MessageManager.error(t("hubSkills.skills.accessTokenRequired"));
      return;
    }

    if (!urlPreview) {
      MessageManager.error(t("hubSkills.skills.repositoryInvalid"));
      return;
    }

    if (!validatePluginName(values.name)) {
      MessageManager.error(t("hubSkills.skills.nameInvalid"));
      return;
    }

    if (values.version && !isValidSemanticVersion(values.version)) {
      MessageManager.error(t("hubSkills.skills.versionInvalid"));
      return;
    }

    if (values.authorEmail && !isValidEmail(values.authorEmail)) {
      MessageManager.error(t("hubSkills.skills.emailInvalid"));
      return;
    }

    if (values.homepage && !isValidUrl(values.homepage)) {
      MessageManager.error("Invalid homepage URL format");
      return;
    }

    setIsSubmitting(true);
    try {
      await registerClaudeCodePlugin(accessToken, buildRegisterRequest(values, urlPreview.parsed));
      MessageManager.success(t("hubSkills.skills.registeredSuccess"));
      form.resetFields();
      setUrlPreview(null);
      setUrlEncodesSubdir(false);
      onSuccess();
      onClose();
    } catch (error) {
      console.error("Error registering skill:", error);
      const reason = error instanceof Error && error.message ? error.message : t("hubSkills.skills.registerError");
      MessageManager.error(`Failed to register skill: ${reason}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    form.resetFields();
    setUrlPreview(null);
    setUrlEncodesSubdir(false);
    onClose();
  };

  return (
    <Modal
      title={t("hubSkills.skills.addTitle")}
      open={visible}
      onCancel={handleCancel}
      footer={null}
      width={700}
      className="top-8"
    >
      <Form form={form} layout="vertical" onFinish={handleSubmit} className="mt-4">
        {/* Smart URL Input */}
        <Form.Item
          label={t("hubSkills.skills.repositoryUrl")}
          name="skillUrl"
          rules={[{ required: true, message: t("hubSkills.skills.repositoryRequired") }]}
          tooltip={t("hubSkills.skills.repositoryTooltip")}
        >
          <Input
            placeholder="https://github.com/org/repo or https://gitlab.com/org/repo"
            className="rounded-lg"
            onChange={handleUrlChange}
          />
        </Form.Item>

        {/* Optional subfolder for monorepos */}
        <Form.Item
          label={t("hubSkills.skills.subfolder")}
          name="subPath"
          rules={[
            {
              validator: (_, value) =>
                !value || isValidSubPath(value)
                  ? Promise.resolve()
                  : Promise.reject(new Error(t("hubSkills.skills.subfolderInvalid"))),
            },
          ]}
          tooltip={t("hubSkills.skills.subfolderTooltip")}
          extra={urlEncodesSubdir ? t("hubSkills.skills.subfolderFromUrl") : undefined}
        >
          <Input
            placeholder="plugins/my-skill"
            className="rounded-lg"
            onChange={handleSubPathChange}
            disabled={urlEncodesSubdir}
          />
        </Form.Item>

        {/* Parsed preview */}
        {urlPreview && (
          <div className="mb-4 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
            Detected: {urlPreview.label}
          </div>
        )}

        {/* Skill Name */}
        <Form.Item
          label={t("hubSkills.skills.name")}
          name="name"
          rules={[
            { required: true, message: t("hubSkills.skills.nameRequired") },
            {
              pattern: /^[a-z0-9-]+$/,
              message: t("hubSkills.skills.nameInvalid"),
            },
          ]}
          tooltip={t("hubSkills.skills.nameTooltip")}
        >
          <Input placeholder="my-skill" className="rounded-lg" />
        </Form.Item>

        {/* Domain and Namespace — side by side */}
        <div className="flex gap-4">
          <Form.Item
            label={t("hubSkills.skills.domainOptional")}
            name="domain"
            tooltip={t("hubSkills.skills.domainTooltip")}
            className="flex-1"
          >
            <Input placeholder="Productivity" className="rounded-lg" />
          </Form.Item>
          <Form.Item
            label={t("hubSkills.skills.namespaceOptional")}
            name="namespace"
            tooltip={t("hubSkills.skills.namespaceTooltip")}
            className="flex-1"
          >
            <Input placeholder="workflows" className="rounded-lg" />
          </Form.Item>
        </div>

        {/* Description */}
        <Form.Item
          label={t("hubSkills.skills.descriptionOptional")}
          name="description"
          tooltip={t("hubSkills.skills.descriptionTooltip")}
        >
          <TextArea
            rows={3}
            placeholder={t("hubSkills.skills.descriptionPlaceholder")}
            maxLength={500}
            className="rounded-lg"
          />
        </Form.Item>

        {/* Category */}
        <Form.Item
          label={t("hubSkills.skills.categoryOptional")}
          name="category"
          tooltip={t("hubSkills.skills.categoryTooltip")}
        >
          <Select
            placeholder={t("hubSkills.skills.categoryPlaceholder")}
            allowClear
            showSearch
            optionFilterProp="children"
            className="rounded-lg"
          >
            {PREDEFINED_CATEGORIES.map((cat) => (
              <Option key={cat} value={cat}>
                {cat}
              </Option>
            ))}
          </Select>
        </Form.Item>

        {/* Keywords */}
        <Form.Item
          label={t("hubSkills.skills.keywordsOptional")}
          name="keywords"
          tooltip={t("hubSkills.skills.keywordsTooltip")}
        >
          <Input placeholder="search, web, api" className="rounded-lg" />
        </Form.Item>

        {/* Version */}
        <Form.Item
          label={t("hubSkills.skills.versionOptional")}
          name="version"
          tooltip={t("hubSkills.skills.versionTooltip")}
        >
          <Input placeholder="1.0.0" className="rounded-lg" />
        </Form.Item>

        {/* Author Name */}
        <Form.Item
          label={t("hubSkills.skills.authorOptional")}
          name="authorName"
          tooltip={t("hubSkills.skills.authorTooltip")}
        >
          <Input placeholder={t("hubSkills.skills.authorPlaceholder")} className="rounded-lg" />
        </Form.Item>

        {/* Author Email */}
        <Form.Item
          label={t("hubSkills.skills.emailOptional")}
          name="authorEmail"
          rules={[{ type: "email", message: t("hubSkills.skills.emailInvalid") }]}
          tooltip={t("hubSkills.skills.emailTooltip")}
        >
          <Input type="email" placeholder="author@example.com" className="rounded-lg" />
        </Form.Item>

        {/* Submit Buttons */}
        <Form.Item className="mb-0 mt-6">
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={handleCancel} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {isSubmitting ? t("hubSkills.skills.adding") : t("hubSkills.skills.add")}
            </Button>
          </div>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default AddPluginForm;
