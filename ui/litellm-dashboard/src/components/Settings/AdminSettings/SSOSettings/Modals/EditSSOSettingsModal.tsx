"use client";

import { useEditSSOSettings } from "@/app/(dashboard)/hooks/sso/useEditSSOSettings";
import { useSSOSettings } from "@/app/(dashboard)/hooks/sso/useSSOSettings";
import NotificationsManager from "@/components/molecules/notifications_manager";
import { parseErrorMessage } from "@/components/shared/errorUtils";
import { Button, Form, Modal, Space } from "antd";
import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { detectSSOProvider, processSSOSettingsPayload } from "../utils";
import BaseSSOSettingsForm from "./BaseSSOSettingsForm";

interface EditSSOSettingsModalProps {
  isVisible: boolean;
  onCancel: () => void;
  onSuccess: () => void;
}

const EditSSOSettingsModal: React.FC<EditSSOSettingsModalProps> = ({ isVisible, onCancel, onSuccess }) => {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const ssoSettings = useSSOSettings();
  const { mutateAsync, isPending } = useEditSSOSettings();

  useEffect(() => {
    if (!isVisible || !ssoSettings.data?.values) {
      return;
    }

    const ssoData = ssoSettings.data;
    const selectedProvider = detectSSOProvider(ssoData.values);

    let roleMappingFields = {};
    if (ssoData.values.role_mappings) {
      const roleMappings = ssoData.values.role_mappings;
      const joinTeams = (teams: string[] | undefined): string => {
        if (!teams || teams.length === 0) return "";
        return teams.join(", ");
      };

      roleMappingFields = {
        use_role_mappings: true,
        group_claim: roleMappings.group_claim,
        default_role: roleMappings.default_role || "internal_user",
        proxy_admin_teams: joinTeams(roleMappings.roles?.proxy_admin),
        admin_viewer_teams: joinTeams(roleMappings.roles?.proxy_admin_viewer),
        internal_user_teams: joinTeams(roleMappings.roles?.internal_user),
        internal_viewer_teams: joinTeams(roleMappings.roles?.internal_user_viewer),
      };
    }

    let teamMappingFields = {};
    if (ssoData.values.team_mappings) {
      teamMappingFields = {
        use_team_mappings: true,
        team_ids_jwt_field: ssoData.values.team_mappings.team_ids_jwt_field,
      };
    }

    const formValues = {
      sso_provider: selectedProvider,
      ...ssoData.values,
      ...roleMappingFields,
      ...teamMappingFields,
      ...(ssoData.values.saml_allow_unsolicited != null
        ? { saml_allow_unsolicited: ssoData.values.saml_allow_unsolicited === "true" }
        : {}),
    };

    form.resetFields();
    setTimeout(() => {
      form.setFieldsValue(formValues);
    }, 100);
  }, [form, isVisible, ssoSettings.data]);

  const handleFormSubmit = async (formValues: Record<string, any>) => {
    try {
      const payload = processSSOSettingsPayload(formValues);

      await mutateAsync(payload, {
        onSuccess: () => {
          NotificationsManager.success(
            t("settings.sso.updateSuccess", { defaultValue: "SSO settings updated successfully" }),
          );
          onSuccess();
        },
        onError: (error) => {
          NotificationsManager.fromBackend(
            t("settings.sso.saveError", {
              defaultValue: "Failed to save SSO settings: {{error}}",
              error: parseErrorMessage(error),
            }),
          );
        },
      });
    } catch (error) {
      NotificationsManager.fromBackend(
        t("settings.sso.processError", {
          defaultValue: "Failed to process SSO settings: {{error}}",
          error: parseErrorMessage(error),
        }),
      );
    }
  };

  const handleCancel = () => {
    form.resetFields();
    onCancel();
  };

  return (
    <Modal
      title={t("settings.sso.modal.editTitle", { defaultValue: "Edit SSO Settings" })}
      open={isVisible}
      width={800}
      footer={
        <Space>
          <Button onClick={handleCancel} disabled={isPending}>
            {t("settings.sso.modal.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button loading={isPending} onClick={() => form.submit()}>
            {isPending
              ? t("settings.sso.modal.saving", { defaultValue: "Saving..." })
              : t("settings.sso.modal.save", { defaultValue: "Save" })}
          </Button>
        </Space>
      }
      onCancel={handleCancel}
    >
      <BaseSSOSettingsForm form={form} onFormSubmit={handleFormSubmit} />
    </Modal>
  );
};

export default EditSSOSettingsModal;
