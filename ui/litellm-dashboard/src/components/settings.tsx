import {
  Button,
  Card,
  Grid,
  SelectItem,
  Switch,
  Tab,
  TabGroup,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TabList,
  TabPanel,
  TabPanels,
  Text,
  TextInput,
} from "@tremor/react";
import React, { useEffect, useState } from "react";

import { Button as Button2, Form, Input, Modal, Select } from "antd";
import EmailSettings from "./email_settings";
import { Logo } from "@/components/molecules/logo/Logo";
import NotificationsManager from "./molecules/notifications_manager";
import { useTranslation } from "react-i18next";

import FormItem from "antd/es/form/FormItem";
import AlertingSettings from "./alerting/alerting_settings";
import CloudZeroCostTracking from "./CloudZeroCostTracking/CloudZeroCostTracking";
import DeleteResourceModal from "./common_components/DeleteResourceModal";
import {
  deleteCallback,
  getCallbackConfigsCall,
  getCallbacksCall,
  serviceHealthCheck,
  setCallbacksCall,
} from "./networking";
import { LoggingCallbacksTable } from "./Settings/LoggingAndAlerts/LoggingCallbacks/LoggingCallbacksTable";
import { AlertingObject } from "./Settings/LoggingAndAlerts/LoggingCallbacks/types";
import { parseErrorMessage } from "./shared/errorUtils";
interface SettingsPageProps {
  accessToken: string | null;
  userRole: string | null;
  userID: string | null;
  premiumUser: boolean;
}

const assetsLogoFolder = "/ui/assets/logos/";

export const backendCallbackLogoSrc = (logo: string | null | undefined): string | undefined => {
  if (!logo) return undefined;
  if (logo.includes("/") || logo.startsWith("data:") || logo.startsWith("http")) return logo;
  return `${assetsLogoFolder}${logo}`;
};

interface DynamicParamsFieldsProps {
  params: string[];
  callbackConfigs: any[];
  selectedCallback: string | null;
  t: (key: string, options?: Record<string, unknown>) => string;
}

const DynamicParamsFields: React.FC<DynamicParamsFieldsProps> = ({ params, callbackConfigs, selectedCallback, t }) => {
  if (!params || params.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4 mt-6 p-4 bg-gray-50 rounded-lg border">
      {params.map((param) => {
        const callbackConfig = callbackConfigs.find((config) => config.id === selectedCallback);
        const paramConfig = callbackConfig?.dynamic_params?.[param] || {};
        const paramType = paramConfig.type || "text";
        const fieldLabel = paramConfig.ui_name || param.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
        const isRequired = paramConfig.required || false;

        return (
          <FormItem
            label={<span className="text-sm font-medium text-gray-700">{fieldLabel} </span>}
            name={param}
            key={param}
            className="mb-4"
            rules={
              isRequired
                ? [
                    {
                      required: true,
                      message: t("settings.shared.enterField", { field: fieldLabel.toLowerCase() }),
                    },
                  ]
                : undefined
            }
          >
            {paramType === "password" ? (
              <Input.Password
                size="large"
                placeholder={t("settings.shared.enterYourField", { field: fieldLabel.toLowerCase() })}
                className="w-full rounded-md border-gray-300 shadow-xs focus:border-blue-500 focus:ring-blue-500"
              />
            ) : paramType === "number" ? (
              <Input
                type="number"
                size="large"
                placeholder={t("settings.shared.enterFieldGeneric", { field: fieldLabel.toLowerCase() })}
                className="w-full rounded-md border-gray-300 shadow-xs focus:border-blue-500 focus:ring-blue-500"
                min={0}
                max={1}
                step={0.1}
              />
            ) : (
              <Input
                size="large"
                placeholder={t("settings.shared.enterYourField", { field: fieldLabel.toLowerCase() })}
                className="w-full rounded-md border-gray-300 shadow-xs focus:border-blue-500 focus:ring-blue-500"
              />
            )}
          </FormItem>
        );
      })}
    </div>
  );
};

// Shared component for rendering callback selector
interface CallbackSelectorProps {
  callbackConfigs: any[];
  selectedCallback: string | null;
  onCallbackChange: (value: string) => void;
  disabled?: boolean;
  t: (key: string) => string;
}

export const CallbackSelector: React.FC<CallbackSelectorProps> = ({
  callbackConfigs,
  selectedCallback,
  onCallbackChange,
  disabled = false,
  t,
}) => {
  return (
    <FormItem
      label={t("settings.shared.callback")}
      name="callback"
      rules={disabled ? undefined : [{ required: true, message: t("settings.shared.callbackRequired") }]}
    >
      <Select
        placeholder={t("settings.shared.callbackPlaceholder")}
        size="large"
        className="w-full"
        showSearch
        disabled={disabled}
        value={selectedCallback}
        filterOption={(input, option) => {
          return (option?.value?.toString() ?? "").toLowerCase().includes(input.toLowerCase());
        }}
        onChange={onCallbackChange}
      >
        {callbackConfigs.map((callbackConfig) => {
          return (
            <SelectItem key={callbackConfig.id} value={callbackConfig.id}>
              <div className="flex items-center space-x-3 py-1">
                <div className="w-6 h-6 flex items-center justify-center">
                  <Logo
                    src={backendCallbackLogoSrc(callbackConfig.logo)}
                    label={callbackConfig.displayName}
                    className="w-6 h-6 rounded-sm object-contain"
                  />
                </div>
                <span className="font-medium text-gray-900">{callbackConfig.displayName}</span>
              </div>
            </SelectItem>
          );
        })}
      </Select>
    </FormItem>
  );
};

// Shared helper function to get dynamic params for a callback
const getDynamicParamsForCallback = (
  callbackName: string | null,
  callbackConfigs: any[],
  fallbackVariables?: Record<string, any>,
): string[] => {
  if (!callbackName) {
    return fallbackVariables ? Object.keys(fallbackVariables) : [];
  }

  const callbackConfig = callbackConfigs.find((config) => config.id === callbackName);
  if (callbackConfig?.dynamic_params) {
    return Object.keys(callbackConfig.dynamic_params);
  }

  return fallbackVariables ? Object.keys(fallbackVariables) : [];
};

// Shared helper function to build callback payload
const buildCallbackPayload = (formValues: Record<string, any>, callbackName: string) => {
  return {
    environment_variables: formValues,
    litellm_settings: {
      success_callback: [callbackName],
    },
  };
};

const Settings: React.FC<SettingsPageProps> = ({ accessToken, userRole, userID, premiumUser }) => {
  const { t } = useTranslation();
  const [callbacks, setCallbacks] = useState<AlertingObject[]>([]);
  const [isLoadingCallbacks, setIsLoadingCallbacks] = useState(true);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [addForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [selectedCallback, setSelectedCallback] = useState<string | null>(null);
  const [catchAllWebhookURL, setCatchAllWebhookURL] = useState<string>("");
  const [alertToWebhooks, setAlertToWebhooks] = useState<Record<string, string>>({});
  const [activeAlerts, setActiveAlerts] = useState<string[]>([]);

  const [showAddCallbacksModal, setShowAddCallbacksModal] = useState(false);
  const [callbackConfigs, setCallbackConfigs] = useState<any[]>([]);
  const [allCallbacks, setAllCallbacks] = useState<
    Record<
      string,
      {
        litellm_callback_name: string;
        litellm_callback_params: string[];
        ui_callback_name: string;
      }
    >
  >({});

  const [selectedCallbackParams, setSelectedCallbackParams] = useState<string[]>([]);

  const [showEditCallback, setShowEditCallback] = useState(false);
  const [selectedEditCallback, setSelectedEditCallback] = useState<any | null>(null);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [callbackToDelete, setCallbackToDelete] = useState<any | null>(null);
  const [isUpdatingCallback, setIsUpdatingCallback] = useState(false);
  const [isAddingCallback, setIsAddingCallback] = useState(false);
  const [isDeletingCallback, setIsDeletingCallback] = useState(false);

  useEffect(() => {
    if (!accessToken) {
      return;
    }
    getCallbackConfigsCall(accessToken)
      .then((data) => {
        setCallbackConfigs(data || []);
      })
      .catch((error) => {
        NotificationsManager.fromBackend(
          t("settings.shared.callbackConfigsLoadError", { error: parseErrorMessage(error) }),
        );
      });
  }, [accessToken]);

  useEffect(() => {
    if (showEditCallback && selectedEditCallback) {
      const normalized = Object.fromEntries(
        Object.entries(selectedEditCallback.variables || {}).map(([k, v]) => [k, v ?? ""]),
      );
      editForm.setFieldsValue({
        ...normalized,
        callback: selectedEditCallback.name,
      });
    }
  }, [showEditCallback, selectedEditCallback, editForm]);

  const handleSwitchChange = (alertName: string) => {
    if (activeAlerts.includes(alertName)) {
      setActiveAlerts(activeAlerts.filter((alert) => alert !== alertName));
    } else {
      setActiveAlerts([...activeAlerts, alertName]);
    }
  };
  const alerts_to_UI_NAME: Record<string, string> = {
    llm_exceptions: t("settings.alerting.llmExceptions"),
    llm_too_slow: t("settings.alerting.llmTooSlow"),
    llm_requests_hanging: t("settings.alerting.llmRequestsHanging"),
    budget_alerts: t("settings.alerting.budgetAlerts"),
    db_exceptions: t("settings.alerting.dbExceptions"),
    daily_reports: t("settings.alerting.dailyReports"),
    outage_alerts: t("settings.alerting.outageAlerts"),
    region_outage_alerts: t("settings.alerting.regionOutageAlerts"),
  };

  useEffect(() => {
    const fetchCallbacks = async () => {
      if (!accessToken || !userRole || !userID) {
        setIsLoadingCallbacks(false);
        return;
      }
      try {
        const data = await getCallbacksCall(accessToken, userID, userRole);
        setCallbacks(data.callbacks);
        setAllCallbacks(data.available_callbacks);

        let alerts_data = data.alerts;
        if (alerts_data) {
          if (alerts_data.length > 0) {
            let _alert_info = alerts_data[0];
            let catch_all_webhook = _alert_info.variables.SLACK_WEBHOOK_URL;

            let active_alerts = _alert_info.active_alerts;
            setActiveAlerts(active_alerts);
            setCatchAllWebhookURL(catch_all_webhook);
            setAlertToWebhooks(_alert_info.alerts_to_webhook);
          }
        }

        setAlerts(alerts_data);
      } finally {
        setIsLoadingCallbacks(false);
      }
    };
    fetchCallbacks();
  }, [accessToken, userRole, userID]);

  const isAlertOn = (alertName: string) => {
    return activeAlerts && activeAlerts.includes(alertName);
  };

  // Shared handler for callback form submission
  const handleCallbackSubmit = async (formValues: Record<string, any>, callbackName: string, isEdit: boolean) => {
    if (!accessToken) {
      return;
    }

    if (isEdit) {
      setIsUpdatingCallback(true);
    } else {
      setIsAddingCallback(true);
    }

    const payload = buildCallbackPayload(formValues, callbackName);

    try {
      await setCallbacksCall(accessToken, payload);
      NotificationsManager.success(
        isEdit
          ? t("settings.shared.callbackUpdatedSuccess")
          : t("settings.shared.callbackAddedSuccess", { name: callbackName }),
      );

      if (isEdit) {
        setShowEditCallback(false);
        editForm.resetFields();
        setSelectedEditCallback(null);
      } else {
        setShowAddCallbacksModal(false);
        addForm.resetFields();
        setSelectedCallback(null);
        setSelectedCallbackParams([]);
      }

      // Refresh the callbacks list
      if (userID && userRole) {
        const updatedData = await getCallbacksCall(accessToken, userID, userRole);
        setCallbacks(updatedData.callbacks);
      }
    } catch (error) {
      NotificationsManager.fromBackend(error);
    } finally {
      if (isEdit) {
        setIsUpdatingCallback(false);
      } else {
        setIsAddingCallback(false);
      }
    }
  };

  const updateCallbackCall = async (formValues: Record<string, any>) => {
    if (!selectedEditCallback) {
      return;
    }
    await handleCallbackSubmit(formValues, selectedEditCallback.name, true);
  };

  const addNewCallbackCall = async (formValues: Record<string, any>) => {
    const new_callback = formValues?.callback;
    if (!new_callback) {
      return;
    }
    await handleCallbackSubmit(formValues, new_callback, false);
  };

  const handleSelectedCallbackChange = (callbackName: string) => {
    setSelectedCallback(callbackName);
    const params = getDynamicParamsForCallback(callbackName, callbackConfigs);
    setSelectedCallbackParams(params);
  };

  const handleSaveAlerts = async () => {
    if (!accessToken) {
      return;
    }

    const updatedAlertToWebhooks: Record<string, string> = {};
    Object.entries(alerts_to_UI_NAME).forEach(([key, value]) => {
      const webhookInput = document.querySelector(`input[name="${key}"]`) as HTMLInputElement;
      const newWebhookValue = webhookInput?.value || "";
      updatedAlertToWebhooks[key] = newWebhookValue;
    });

    const payload = {
      general_settings: {
        alert_to_webhook_url: updatedAlertToWebhooks,
        alert_types: activeAlerts,
      },
    };

    try {
      await setCallbacksCall(accessToken, payload);
    } catch (error) {
      NotificationsManager.fromBackend(error);
    }
    NotificationsManager.success(t("settings.shared.alertsUpdatedSuccess"));
  };
  const handleSaveChanges = (callback: any) => {
    if (!accessToken) {
      return;
    }

    const updatedVariables = Object.fromEntries(
      Object.entries(callback.variables).map(([key, value]) => [
        key,
        (document.querySelector(`input[name="${key}"]`) as HTMLInputElement)?.value || value,
      ]),
    );

    const payload = {
      environment_variables: updatedVariables,
      litellm_settings: {
        success_callback: [callback.name],
      },
    };

    try {
      setCallbacksCall(accessToken, payload);
    } catch (error) {
      NotificationsManager.fromBackend(error);
    }
    NotificationsManager.success(t("settings.shared.callbackUpdatedSuccess"));
  };

  const handleDeleteCallback = (callback: any) => {
    setCallbackToDelete(callback);
    setShowDeleteConfirmModal(true);
  };

  const confirmDeleteCallback = async () => {
    if (!callbackToDelete || !accessToken) {
      return;
    }

    try {
      setIsDeletingCallback(true);
      await deleteCallback(accessToken, callbackToDelete.name);
      NotificationsManager.success(t("settings.shared.deleteCallbackSuccess", { name: callbackToDelete.name }));

      // Refresh the callbacks list
      if (userID && userRole) {
        const data = await getCallbacksCall(accessToken, userID, userRole);
        setCallbacks(data.callbacks);
      }

      setShowDeleteConfirmModal(false);
      setCallbackToDelete(null);
    } catch (error) {
      console.error("Failed to delete callback:", error);
      NotificationsManager.fromBackend(error);
    } finally {
      setIsDeletingCallback(false);
    }
  };

  if (!accessToken) {
    return null;
  }

  return (
    <div className="mx-4">
      <Grid numItems={1} className="gap-2 p-8 w-full mt-2">
        <TabGroup>
          <TabList variant="line" defaultValue="1">
            <Tab value="1">{t("settings.shared.loggingCallbacksTab")}</Tab>
            <Tab value="2">{t("settings.shared.cloudzeroTab")}</Tab>
            <Tab value="2">{t("settings.shared.alertingTypesTab")}</Tab>
            <Tab value="3">{t("settings.shared.alertingSettingsTab")}</Tab>
            <Tab value="4">{t("settings.shared.emailAlertsTab")}</Tab>
          </TabList>
          <TabPanels>
            <TabPanel>
              <LoggingCallbacksTable
                callbacks={callbacks}
                availableCallbacks={allCallbacks}
                isLoading={isLoadingCallbacks}
                onAdd={() => setShowAddCallbacksModal(true)}
                onEdit={(cb) => {
                  setSelectedEditCallback(cb);
                  setShowEditCallback(true);
                }}
                onDelete={(cb) => handleDeleteCallback(cb)}
                onTest={async (cb) => {
                  try {
                    await serviceHealthCheck(accessToken, cb.name);
                    NotificationsManager.success(t("settings.shared.healthCheckTriggered"));
                  } catch (error) {
                    NotificationsManager.fromBackend(parseErrorMessage(error));
                  }
                }}
              />
            </TabPanel>
            <TabPanel>
              <div className="p-8">
                <CloudZeroCostTracking />
              </div>
            </TabPanel>
            <TabPanel>
              <Card>
                <Text className="my-2">
                  {t("settings.shared.slackWebhookHelp")}{" "}
                  <a href="https://api.slack.com/messaging/webhooks" target="_blank" style={{ color: "blue" }}>
                    {t("settings.shared.here")}
                  </a>
                </Text>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell></TableHeaderCell>
                      <TableHeaderCell></TableHeaderCell>
                      <TableHeaderCell>{t("settings.shared.slackWebhookUrl")}</TableHeaderCell>
                    </TableRow>
                  </TableHead>

                  <TableBody>
                    {Object.entries(alerts_to_UI_NAME).map(([key, value], index) => (
                      <TableRow key={index}>
                        <TableCell>
                          {key == "region_outage_alerts" ? (
                            premiumUser ? (
                              <Switch
                                id="switch"
                                name="switch"
                                checked={isAlertOn(key)}
                                onChange={() => handleSwitchChange(key)}
                              />
                            ) : (
                              <span className="text-gray-400">{t("settings.shared.unavailable")}</span>
                            )
                          ) : (
                            <Switch
                              id="switch"
                              name="switch"
                              checked={isAlertOn(key)}
                              onChange={() => handleSwitchChange(key)}
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          <Text>{value}</Text>
                        </TableCell>
                        <TableCell>
                          <TextInput
                            name={key}
                            type="password"
                            defaultValue={
                              alertToWebhooks && alertToWebhooks[key]
                                ? alertToWebhooks[key]
                                : (catchAllWebhookURL as string)
                            }
                          ></TextInput>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <Button size="xs" className="mt-2" onClick={handleSaveAlerts}>
                  {t("settings.cache.saveChanges")}
                </Button>

                <Button
                  onClick={async () => {
                    try {
                      await serviceHealthCheck(accessToken, "slack");
                      NotificationsManager.success(t("settings.shared.testAlertsSuccess"));
                    } catch (error) {
                      NotificationsManager.fromBackend(parseErrorMessage(error));
                    }
                  }}
                  className="mx-2"
                >
                  {t("settings.shared.testAlerts")}
                </Button>
              </Card>
            </TabPanel>
            <TabPanel>
              <AlertingSettings accessToken={accessToken} premiumUser={premiumUser} />
            </TabPanel>
            <TabPanel>
              <EmailSettings accessToken={accessToken} premiumUser={premiumUser} alerts={alerts} />
            </TabPanel>
          </TabPanels>
        </TabGroup>
      </Grid>

      <Modal
        title={t("settings.shared.addLoggingCallbackTitle")}
        open={showAddCallbacksModal}
        width={800}
        onCancel={() => {
          setShowAddCallbacksModal(false);
          setSelectedCallback(null);
          setSelectedCallbackParams([]);
        }}
        footer={null}
      >
        <a
          href="https://docs.litellm.ai/docs/proxy/logging"
          className="mb-8 mt-4"
          target="_blank"
          style={{ color: "blue" }}
        >
          {t("settings.shared.loggingDocs")}
        </a>

        <Form
          form={addForm}
          onFinish={addNewCallbackCall}
          labelCol={{ span: 8 }}
          wrapperCol={{ span: 16 }}
          labelAlign="left"
        >
          <CallbackSelector
            callbackConfigs={callbackConfigs}
            selectedCallback={selectedCallback}
            onCallbackChange={handleSelectedCallbackChange}
            t={t}
          />

          <DynamicParamsFields
            params={selectedCallbackParams}
            callbackConfigs={callbackConfigs}
            selectedCallback={selectedCallback}
            t={t}
          />

          <div className="flex justify-end space-x-3 pt-6 mt-6 border-t border-gray-200">
            <Button2
              onClick={() => {
                setShowAddCallbacksModal(false);
                setSelectedCallback(null);
                setSelectedCallbackParams([]);
                addForm.resetFields();
              }}
              disabled={isAddingCallback}
            >
              {t("settings.shared.cancel")}
            </Button2>
            <Button2 htmlType="submit" loading={isAddingCallback} disabled={isAddingCallback}>
              {isAddingCallback ? t("settings.shared.adding") : t("settings.shared.addCallback")}
            </Button2>
          </div>
        </Form>
      </Modal>

      <Modal
        open={showEditCallback}
        width={800}
        title={t("settings.shared.editCallbackSettings")}
        onCancel={() => {
          setShowEditCallback(false);
          setSelectedEditCallback(null);
          editForm.resetFields();
        }}
        footer={null}
      >
        <Form
          form={editForm}
          onFinish={updateCallbackCall}
          labelCol={{ span: 8 }}
          wrapperCol={{ span: 16 }}
          labelAlign="left"
        >
          {selectedEditCallback && (
            <>
              <CallbackSelector
                callbackConfigs={callbackConfigs}
                selectedCallback={selectedEditCallback.name}
                onCallbackChange={() => {}}
                disabled={true}
                t={t}
              />

              <DynamicParamsFields
                params={getDynamicParamsForCallback(
                  selectedEditCallback.name,
                  callbackConfigs,
                  selectedEditCallback.variables,
                )}
                callbackConfigs={callbackConfigs}
                selectedCallback={selectedEditCallback.name}
                t={t}
              />
            </>
          )}

          <div className="flex justify-end space-x-3 pt-6 mt-6 border-t border-gray-200">
            <Button2
              onClick={() => {
                setShowEditCallback(false);
                setSelectedEditCallback(null);
                editForm.resetFields();
              }}
              disabled={isUpdatingCallback}
            >
              {t("settings.shared.cancel")}
            </Button2>
            <Button2
              onClick={() => {
                editForm.submit();
              }}
              loading={isUpdatingCallback}
              disabled={isUpdatingCallback}
            >
              {isUpdatingCallback ? t("settings.cache.saving") : t("settings.cache.saveChanges")}
            </Button2>
          </div>
        </Form>
      </Modal>

      <DeleteResourceModal
        isOpen={showDeleteConfirmModal}
        title={t("settings.shared.deleteCallbackTitle")}
        message={t("settings.shared.deleteCallbackMessage")}
        resourceInformationTitle={t("settings.shared.callbackInformation")}
        resourceInformation={[
          { label: t("settings.shared.callbackName"), value: callbackToDelete?.name },
          { label: t("settings.shared.mode"), value: callbackToDelete?.mode || "success" },
        ]}
        onCancel={() => {
          setShowDeleteConfirmModal(false);
          setCallbackToDelete(null);
        }}
        onOk={confirmDeleteCallback}
        confirmLoading={isDeletingCallback}
      />
    </div>
  );
};

export default Settings;
