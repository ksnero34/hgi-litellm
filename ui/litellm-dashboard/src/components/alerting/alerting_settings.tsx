/**
 * UI for controlling slack alerting settings
 */
import React, { useState, useEffect } from "react";

import { alertingSettingsCall, updateConfigFieldSetting } from "../networking";
import DynamicForm from "./dynamic_form";
import NotificationsManager from "../molecules/notifications_manager";
import { useTranslation } from "react-i18next";
interface alertingSettingsItem {
  field_name: string;
  field_type: string;
  field_value: any;
  field_default_value: any;
  field_description: string;
  stored_in_db: boolean | null;
  premium_field: boolean;
}

interface AlertingSettingsProps {
  accessToken: string | null;
  premiumUser: boolean;
}

const AlertingSettings: React.FC<AlertingSettingsProps> = ({ accessToken, premiumUser }) => {
  const { t } = useTranslation();
  const [alertingSettings, setAlertingSettings] = useState<alertingSettingsItem[]>([]);

  useEffect(() => {
    // get values
    if (!accessToken) {
      return;
    }
    alertingSettingsCall(accessToken).then((data) => {
      setAlertingSettings(data);
    });
  }, [accessToken]);

  const handleInputChange = (fieldName: string, newValue: any) => {
    // Update the value in the state
    const updatedSettings = alertingSettings.map((setting) =>
      setting.field_name === fieldName ? { ...setting, field_value: newValue } : setting,
    );

    setAlertingSettings(updatedSettings);
  };

  const handleSubmit = (formValues: Record<string, any>) => {
    if (!accessToken) {
      return;
    }

    let fieldValue = formValues;

    if (fieldValue == null || fieldValue == undefined) {
      return;
    }

    const initialFormValues: Record<string, any> = {};

    alertingSettings.forEach((setting) => {
      initialFormValues[setting.field_name] = setting.field_value;
    });

    // Merge initialFormValues with actual formValues
    const mergedFormValues = { ...formValues, ...initialFormValues };
    const { slack_alerting, ...alertingArgs } = mergedFormValues;
    try {
      updateConfigFieldSetting(accessToken, "alerting_args", alertingArgs);
      if (typeof slack_alerting === "boolean") {
        if (slack_alerting == true) {
          updateConfigFieldSetting(accessToken, "alerting", ["slack"]);
        } else {
          updateConfigFieldSetting(accessToken, "alerting", []);
        }
      }
      // update value in state
      NotificationsManager.success(t("settings.alerting.waitForUpdate"));
    } catch (error) {
      // do something
    }
  };

  const handleResetField = (fieldName: string, idx: number) => {
    if (!accessToken) {
      return;
    }

    try {
      //   deleteConfigFieldSetting(accessToken, fieldName);
      // update value in state

      const updatedSettings = alertingSettings.map((setting) =>
        setting.field_name === fieldName
          ? {
              ...setting,
              stored_in_db: null,
              field_value: setting.field_default_value,
            }
          : setting,
      );
      setAlertingSettings(updatedSettings);
    } catch (error) {
      // do something
    }
  };

  return (
    <DynamicForm
      alertingSettings={alertingSettings}
      handleInputChange={handleInputChange}
      handleResetField={handleResetField}
      handleSubmit={handleSubmit}
      premiumUser={premiumUser}
      updateLabel={t("settings.alerting.updateSettings")}
      inDbLabel={t("settings.router.status.inDb")}
      inConfigLabel={t("settings.router.status.inConfig")}
      notSetLabel={t("settings.router.status.notSet")}
      resetLabel={t("settings.router.reset")}
    />
  );
};

export default AlertingSettings;
