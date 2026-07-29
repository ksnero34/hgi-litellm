import React from "react";
import { useTranslation } from "react-i18next";
import { Typography, Select, Modal, Space, Button, Input } from "antd";

const { Text } = Typography;
const { Option } = Select;

interface CustomPatternModalProps {
  visible: boolean;
  patternName: string;
  patternRegex: string;
  patternAction: "BLOCK" | "MASK";
  onNameChange: (name: string) => void;
  onRegexChange: (regex: string) => void;
  onActionChange: (action: "BLOCK" | "MASK") => void;
  onAdd: () => void;
  onCancel: () => void;
}

const CustomPatternModal: React.FC<CustomPatternModalProps> = ({
  visible,
  patternName,
  patternRegex,
  patternAction,
  onNameChange,
  onRegexChange,
  onActionChange,
  onAdd,
  onCancel,
}) => {
  const { t } = useTranslation();
  return (
    <Modal
      title={t("safety.contentFilter.addCustomTitle")}
      open={visible}
      onCancel={onCancel}
      footer={null}
      width={800}
    >
      <Space direction="vertical" style={{ width: "100%" }} size="large">
        <div>
          <Text strong>{t("safety.contentFilter.patternName")}</Text>
          <Input
            placeholder={t("safety.contentFilter.patternNamePlaceholder")}
            value={patternName}
            onChange={(e) => onNameChange(e.target.value)}
            style={{ marginTop: 8 }}
          />
        </div>

        <div>
          <Text strong>{t("safety.contentFilter.regexPattern")}</Text>
          <Input
            placeholder={t("safety.contentFilter.regexPlaceholder")}
            value={patternRegex}
            onChange={(e) => onRegexChange(e.target.value)}
            style={{ marginTop: 8 }}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t("safety.contentFilter.regexHelp")}
          </Text>
        </div>

        <div>
          <Text strong>{t("safety.contentFilter.action")}</Text>
          <Text type="secondary" style={{ display: "block", marginTop: 4, marginBottom: 8 }}>
            {t("safety.contentFilter.patternActionHelp")}
          </Text>
          <Select value={patternAction} onChange={onActionChange} style={{ width: "100%" }}>
            <Option value="BLOCK">{t("safety.contentFilter.block")}</Option>
            <Option value="MASK">{t("safety.contentFilter.mask")}</Option>
          </Select>
        </div>
      </Space>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "24px" }}>
        <Button onClick={onCancel}>{t("safety.contentFilter.cancel")}</Button>
        <Button type="primary" onClick={onAdd}>
          {t("safety.contentFilter.add")}
        </Button>
      </div>
    </Modal>
  );
};

export default CustomPatternModal;
