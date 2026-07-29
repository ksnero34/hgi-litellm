import React, { useEffect, useState } from "react";
import { Button as Button2, Form, Select } from "antd";
import { Text, TextInput } from "@tremor/react";
import { useTranslation } from "react-i18next";
import NotificationManager from "./molecules/notifications_manager";
import { getSSOSettings, updateSSOSettings } from "./networking";

interface UIAccessControlFormProps {
  accessToken: string | null;
  onSuccess: () => void;
}

const UIAccessControlForm: React.FC<UIAccessControlFormProps> = ({ accessToken, onSuccess }) => {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const loadUIAccessSettings = async () => {
      if (accessToken) {
        try {
          const ssoData = await getSSOSettings(accessToken);
          if (ssoData && ssoData.values) {
            const uiAccessMode = ssoData.values.ui_access_mode;
            let formValues = {};

            if (uiAccessMode && typeof uiAccessMode === "object") {
              formValues = {
                ui_access_mode_type: uiAccessMode.type,
                restricted_sso_group: uiAccessMode.restricted_sso_group,
                sso_group_jwt_field: uiAccessMode.sso_group_jwt_field,
              };
            } else if (typeof uiAccessMode === "string") {
              formValues = {
                ui_access_mode_type: uiAccessMode,
                restricted_sso_group: ssoData.values.restricted_sso_group,
                sso_group_jwt_field: ssoData.values.team_ids_jwt_field || ssoData.values.sso_group_jwt_field,
              };
            }

            form.setFieldsValue(formValues);
          }
        } catch (error) {
          console.error("Failed to load UI access settings:", error);
        }
      }
    };

    loadUIAccessSettings();
  }, [accessToken, form]);

  const handleUIAccessSubmit = async (formValues: Record<string, any>) => {
    if (!accessToken) {
      NotificationManager.fromBackend(
        t("auth.uiAccess.errors.noAccessToken", { defaultValue: "No access token available" }),
      );
      return;
    }

    setLoading(true);
    try {
      let apiPayload;

      if (formValues.ui_access_mode_type === "all_authenticated_users") {
        apiPayload = {
          ui_access_mode: "none",
        };
      } else {
        apiPayload = {
          ui_access_mode: {
            type: formValues.ui_access_mode_type,
            restricted_sso_group: formValues.restricted_sso_group,
            sso_group_jwt_field: formValues.sso_group_jwt_field,
          },
        };
      }

      await updateSSOSettings(accessToken, apiPayload);
      onSuccess();
    } catch (error) {
      console.error("Failed to save UI access settings:", error);
      NotificationManager.fromBackend(
        t("auth.uiAccess.errors.save", { defaultValue: "Failed to save UI access settings" }),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: "16px" }}>
      <div style={{ marginBottom: "16px" }}>
        <Text style={{ fontSize: "14px", color: "#6b7280" }}>
          {t("auth.uiAccess.description", {
            defaultValue:
              "Configure who can access the UI interface and how group information is extracted from JWT tokens.",
          })}
        </Text>
      </div>

      <Form form={form} onFinish={handleUIAccessSubmit} layout="vertical">
        <Form.Item
          label={t("auth.uiAccess.modeLabel", { defaultValue: "UI Access Mode" })}
          name="ui_access_mode_type"
          tooltip={t("auth.uiAccess.modeTooltip", { defaultValue: "Controls who can access the UI interface" })}
        >
          <Select placeholder={t("auth.uiAccess.modePlaceholder", { defaultValue: "Select access mode" })}>
            <Select.Option value="all_authenticated_users">
              {t("auth.uiAccess.modes.allAuthenticatedUsers", { defaultValue: "All Authenticated Users" })}
            </Select.Option>
            <Select.Option value="restricted_sso_group">
              {t("auth.uiAccess.modes.restrictedSsoGroup", { defaultValue: "Restricted SSO Group" })}
            </Select.Option>
          </Select>
        </Form.Item>

        <Form.Item
          noStyle
          shouldUpdate={(prevValues, currentValues) =>
            prevValues.ui_access_mode_type !== currentValues.ui_access_mode_type
          }
        >
          {({ getFieldValue }) => {
            const uiAccessModeType = getFieldValue("ui_access_mode_type");
            return uiAccessModeType === "restricted_sso_group" ? (
              <Form.Item
                label={t("auth.uiAccess.restrictedGroupLabel", { defaultValue: "Restricted SSO Group" })}
                name="restricted_sso_group"
                rules={[
                  {
                    required: true,
                    message: t("auth.uiAccess.validation.enterRestrictedGroup", {
                      defaultValue: "Please enter the restricted SSO group",
                    }),
                  },
                ]}
              >
                <TextInput
                  placeholder={t("auth.uiAccess.restrictedGroupPlaceholder", { defaultValue: "ui-access-group" })}
                />
              </Form.Item>
            ) : null;
          }}
        </Form.Item>

        <Form.Item
          label={t("auth.uiAccess.jwtFieldLabel", { defaultValue: "SSO Group JWT Field" })}
          name="sso_group_jwt_field"
          tooltip={t("auth.uiAccess.jwtFieldTooltip", {
            defaultValue:
              "JWT field name that contains team/group information. Use dot notation to access nested fields.",
          })}
        >
          <TextInput placeholder={t("auth.uiAccess.jwtFieldPlaceholder", { defaultValue: "groups" })} />
        </Form.Item>

        <div style={{ textAlign: "right", marginTop: "16px" }}>
          <Button2
            type="primary"
            htmlType="submit"
            loading={loading}
            style={{ backgroundColor: "#6366f1", borderColor: "#6366f1" }}
          >
            {t("auth.uiAccess.actions.update", { defaultValue: "Update UI Access Control" })}
          </Button2>
        </div>
      </Form>
    </div>
  );
};

export default UIAccessControlForm;
