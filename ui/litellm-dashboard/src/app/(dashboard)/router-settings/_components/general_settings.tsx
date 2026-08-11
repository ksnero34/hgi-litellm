import React, { useState, useEffect } from "react";
import {
  Card,
  Table,
  TableHead,
  TableRow,
  TableHeaderCell,
  TableCell,
  TableBody,
  Title,
  Text,
  Button,
  Icon,
  Switch,
} from "@tremor/react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getGeneralSettingsCall, updateConfigFieldSetting, deleteConfigFieldSetting } from "@/components/networking";
import { InputNumber, Select as AntdSelect } from "antd";
import { TrashIcon } from "@heroicons/react/outline";
import { StatusBadge } from "@/components/shared/table_cells";

import RouterSettings from "@/components/router_settings";
import Fallbacks from "@/components/Settings/RouterSettings/Fallbacks/Fallbacks";
import RoutingGroups from "@/components/routing_groups";

const PROMPT_CACHING_TAB = "prompt_caching";
const ENABLE_ANTHROPIC_PROMPT_CACHING = "enable_anthropic_prompt_caching";
const ANTHROPIC_PROMPT_CACHING_TTL = "anthropic_prompt_caching_ttl";

interface GeneralSettingsPageProps {
  accessToken: string | null;
  userRole: string | null;
  userID: string | null;
}

export interface generalSettingsItem {
  field_name: string;
  field_type: string;
  field_value: any;
  field_description: string;
  stored_in_db: boolean | null;
  field_options?: string[] | null;
  field_tab?: string | null;
  field_default_value?: any;
}

const SettingValueEditor: React.FC<{
  setting: generalSettingsItem;
  onChange: (fieldName: string, newValue: any) => void;
}> = ({ setting, onChange }) => {
  if (setting.field_type === "Integer") {
    return (
      <InputNumber
        step={1}
        value={setting.field_value}
        onChange={(newValue) => onChange(setting.field_name, newValue)}
      />
    );
  }
  if (setting.field_type === "Boolean") {
    return (
      <Switch
        checked={setting.field_value === true || setting.field_value === "true"}
        onChange={(checked) => onChange(setting.field_name, checked)}
      />
    );
  }
  if (setting.field_type === "Float") {
    return (
      <InputNumber
        min={0}
        max={1}
        step={0.05}
        value={setting.field_value}
        onChange={(newValue) => onChange(setting.field_name, newValue)}
      />
    );
  }
  if (setting.field_type === "Dollar") {
    return (
      <InputNumber
        min={0.01}
        step={0.25}
        prefix="$"
        value={setting.field_value}
        onChange={(newValue) => onChange(setting.field_name, newValue)}
      />
    );
  }
  if (setting.field_type === "Select") {
    return (
      <AntdSelect
        allowClear
        style={{ minWidth: "8rem" }}
        placeholder="Default"
        value={setting.field_value || undefined}
        options={(setting.field_options ?? []).map((option) => ({ label: option, value: option }))}
        onChange={(newValue) => onChange(setting.field_name, newValue ?? "")}
      />
    );
  }
  return null;
};

export const PromptCachingPanel: React.FC<{
  accessToken: string;
  settings: generalSettingsItem[];
  onChange: (fieldName: string, newValue: any) => void;
}> = ({ accessToken, settings, onChange }) => {
  const enableSetting = settings.find((s) => s.field_name === ENABLE_ANTHROPIC_PROMPT_CACHING);
  const ttlSetting = settings.find((s) => s.field_name === ANTHROPIC_PROMPT_CACHING_TTL);

  if (!enableSetting) {
    return null;
  }

  const enabled = enableSetting.field_value === true || enableSetting.field_value === "true";

  const persist = (fieldName: string, value: any) => {
    onChange(fieldName, value);
    if (value === "" || value === null || value === undefined) {
      deleteConfigFieldSetting(accessToken, fieldName);
    } else {
      updateConfigFieldSetting(accessToken, fieldName, value);
    }
  };

  return (
    <Card>
      <Title>Prompt Caching</Title>

      <div className="mt-6 flex items-start justify-between gap-8">
        <div className="max-w-2xl">
          <Text className="font-medium">Automatic Anthropic prompt caching</Text>
          <p className="mt-1 text-xs text-gray-500">{enableSetting.field_description}</p>
        </div>
        <Switch checked={enabled} onChange={(checked) => persist(ENABLE_ANTHROPIC_PROMPT_CACHING, checked)} />
      </div>

      {ttlSetting && (
        <div className="mt-6 flex items-start justify-between gap-8">
          <div className="max-w-2xl">
            <Text className={`font-medium ${enabled ? "" : "text-gray-400"}`}>Cache lifetime (TTL)</Text>
            <p className="mt-1 text-xs text-gray-500">{ttlSetting.field_description}</p>
          </div>
          <AntdSelect
            allowClear
            disabled={!enabled}
            style={{ minWidth: "10rem" }}
            placeholder="5m (default)"
            value={ttlSetting.field_value || undefined}
            options={(ttlSetting.field_options ?? []).map((option) => ({ label: option, value: option }))}
            onChange={(newValue) => persist(ANTHROPIC_PROMPT_CACHING_TTL, newValue ?? "")}
          />
        </div>
      )}
    </Card>
  );
};

const GeneralSettings: React.FC<GeneralSettingsPageProps> = ({ accessToken, userRole, userID }) => {
  const { t } = useTranslation();
  const [generalSettings, setGeneralSettings] = useState<generalSettingsItem[]>([]);

  useEffect(() => {
    if (!accessToken) {
      return;
    }
    getGeneralSettingsCall(accessToken).then((data) => {
      const general_settings = data;
      setGeneralSettings(general_settings);
    });
  }, [accessToken]);

  const handleInputChange = (fieldName: string, newValue: any) => {
    const updatedSettings = generalSettings.map((setting) =>
      setting.field_name === fieldName ? { ...setting, field_value: newValue } : setting,
    );
    setGeneralSettings(updatedSettings);
  };

  const handleUpdateField = (fieldName: string) => {
    if (!accessToken) {
      return;
    }

    const fieldValue = generalSettings.find((setting) => setting.field_name === fieldName)?.field_value;

    if (fieldValue == null || fieldValue == undefined) {
      return;
    }
    try {
      updateConfigFieldSetting(accessToken, fieldName, fieldValue);

      const updatedSettings = generalSettings.map((setting) =>
        setting.field_name === fieldName ? { ...setting, stored_in_db: true } : setting,
      );
      setGeneralSettings(updatedSettings);
    } catch (error) {
      return;
    }
  };

  const handleResetField = (fieldName: string) => {
    if (!accessToken) {
      return;
    }

    try {
      deleteConfigFieldSetting(accessToken, fieldName);

      const updatedSettings = generalSettings.map((setting) =>
        setting.field_name === fieldName
          ? { ...setting, stored_in_db: null, field_value: setting.field_default_value ?? null }
          : setting,
      );
      setGeneralSettings(updatedSettings);
    } catch (error) {
      return;
    }
  };

  if (!accessToken) {
    return null;
  }

  return (
    <div className="w-full">
      <Tabs defaultValue="loadbalancing" className="h-[75vh] w-full">
        <TabsList variant="line" className="mx-8 mt-4">
          <TabsTrigger value="loadbalancing">{t("settings.router.tabs.loadbalancing")}</TabsTrigger>
          <TabsTrigger value="routing-groups">{t("settings.router.tabs.routingGroups")}</TabsTrigger>
          <TabsTrigger value="fallbacks">{t("settings.router.tabs.fallbacks")}</TabsTrigger>
          <TabsTrigger value="prompt-caching">Prompt Caching</TabsTrigger>
          <TabsTrigger value="general">{t("settings.router.tabs.general")}</TabsTrigger>
        </TabsList>
        <TabsContent value="loadbalancing" className="px-8 py-6">
          <RouterSettings accessToken={accessToken} userRole={userRole} userID={userID} />
        </TabsContent>
        <TabsContent value="routing-groups" className="px-8 py-6">
          <RoutingGroups />
        </TabsContent>
        <TabsContent value="fallbacks" className="px-8 py-6">
          <Fallbacks accessToken={accessToken} userRole={userRole} userID={userID} />
        </TabsContent>
        <TabsContent value="prompt-caching" className="px-8 py-6">
          <PromptCachingPanel accessToken={accessToken} settings={generalSettings} onChange={handleInputChange} />
        </TabsContent>
        <TabsContent value="general" className="px-8 py-6">
          <Card>
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>{t("settings.router.table.setting")}</TableHeaderCell>
                  <TableHeaderCell>{t("settings.router.table.value")}</TableHeaderCell>
                  <TableHeaderCell>{t("settings.router.table.status")}</TableHeaderCell>
                  <TableHeaderCell>{t("settings.router.table.action")}</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {generalSettings
                  .filter((value) => value.field_type !== "TypedDictionary" && value.field_tab !== PROMPT_CACHING_TAB)
                  .map((value, index) => (
                    <TableRow key={index}>
                      <TableCell>
                        <Text>{value.field_name}</Text>
                        <p
                          style={{
                            fontSize: "0.65rem",
                            color: "#808080",
                            fontStyle: "italic",
                          }}
                          className="mt-1"
                        >
                          {value.field_description}
                        </p>
                      </TableCell>
                      <TableCell>
                        <SettingValueEditor setting={value} onChange={handleInputChange} />
                      </TableCell>
                      <TableCell>
                        {value.stored_in_db == true ? (
                          <StatusBadge tone="success" label={t("settings.router.status.inDb")} />
                        ) : value.stored_in_db == false ? (
                          <StatusBadge tone="neutral" label={t("settings.router.status.inConfig")} />
                        ) : (
                          <StatusBadge tone="neutral" label={t("settings.router.status.notSet")} />
                        )}
                      </TableCell>
                      <TableCell>
                        <Button onClick={() => handleUpdateField(value.field_name)}>
                          {t("settings.router.update")}
                        </Button>
                        <Icon icon={TrashIcon} color="red" onClick={() => handleResetField(value.field_name)}>
                          {t("settings.router.reset")}
                        </Icon>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default GeneralSettings;
