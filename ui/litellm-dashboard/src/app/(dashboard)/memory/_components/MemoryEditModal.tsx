"use client";

import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Input, Modal, Typography } from "antd";
import type { MemoryRow } from "@/components/networking";

const { Text } = Typography;

interface MemoryEditModalProps {
  open: boolean;
  mode: "create" | "edit";
  initialRow?: MemoryRow;
  onClose: () => void;
  onSave: (key: string, value: string, metadataText: string, isCreate: boolean) => Promise<boolean>;
}

export const MemoryEditModal: React.FC<MemoryEditModalProps> = ({ open, mode, initialRow, onClose, onSave }) => {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && initialRow) {
      form.setFieldsValue({
        key: initialRow.key,
        value: initialRow.value,
        metadata: initialRow.metadata != null ? JSON.stringify(initialRow.metadata, null, 2) : "",
      });
    } else {
      form.resetFields();
    }
  }, [open, mode, initialRow, form]);

  const handleOk = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    const ok = await onSave(values.key.trim(), values.value ?? "", values.metadata ?? "", mode === "create");
    setSubmitting(false);
    if (ok) {
      form.resetFields();
      onClose();
    }
  };

  return (
    <Modal
      open={open}
      title={
        mode === "create"
          ? t("interactionExtra.memory.createTitle")
          : t("interactionExtra.memory.editTitle", { key: initialRow?.key ?? "" })
      }
      onCancel={() => {
        form.resetFields();
        onClose();
      }}
      onOk={handleOk}
      okText={mode === "create" ? t("interactionExtra.memory.create") : t("interactionExtra.memory.save")}
      confirmLoading={submitting}
      width={640}
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Form.Item
          label={t("interactionExtra.memory.key")}
          name="key"
          rules={[{ required: true, message: t("interactionExtra.memory.keyRequired") }]}
          tooltip={t("interactionExtra.memory.keyHelp")}
        >
          <Input placeholder={t("interactionExtra.memory.keyPlaceholder")} disabled={mode === "edit"} />
        </Form.Item>
        <Form.Item
          label={t("interactionExtra.memory.value")}
          name="value"
          rules={[{ required: true, message: t("interactionExtra.memory.valueRequired") }]}
          tooltip={t("interactionExtra.memory.valueHelp")}
        >
          <Input.TextArea rows={8} placeholder={t("interactionExtra.memory.valuePlaceholder")} />
        </Form.Item>
        <Form.Item
          label={
            <span>
              {t("interactionExtra.memory.metadata")}{" "}
              <Text type="secondary">{t("interactionExtra.memory.optionalJson")}</Text>
            </span>
          }
          name="metadata"
          tooltip={t("interactionExtra.memory.metadataHelp")}
        >
          <Input.TextArea
            rows={4}
            placeholder='{"tags": ["example"]}'
            style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default MemoryEditModal;
