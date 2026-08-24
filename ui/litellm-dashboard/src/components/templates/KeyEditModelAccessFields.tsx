// eslint-disable-next-line no-restricted-imports -- this component extracts fields from the existing legacy antd key-edit form
import { Form, Select } from "antd";
import { keyTypeFromRoutes } from "./keyEditFieldNormalizers";
import { hasAllModelsSentinel } from "../key_team_helpers/fetch_available_models_team_key";
import { KeyResponse } from "../key_team_helpers/key_list";

interface KeyEditModelAccessFieldsProps {
  keyData: KeyResponse;
  team: unknown;
  availableModels: string[];
}

const parseAllowedRoutes = (value: unknown): string[] =>
  typeof value === "string" && value.trim() !== ""
    ? value
        .split(",")
        .map((route) => route.trim())
        .filter((route) => route.length > 0)
    : [];

const updateKeyType = (value: string, setFieldValue: (field: string, value: unknown) => void) => {
  if (value === "default") setFieldValue("allowed_routes", "");
  if (value === "llm_api") setFieldValue("allowed_routes", "llm_api_routes");
  if (value === "management") {
    setFieldValue("allowed_routes", "management_routes");
    setFieldValue("models", []);
  }
};

export function KeyEditModelAccessFields({ keyData, team, availableModels }: KeyEditModelAccessFieldsProps) {
  return (
    <>
      <Form.Item label="Models" name="models">
        <Form.Item
          noStyle
          shouldUpdate={(previous, current) =>
            previous.allowed_routes !== current.allowed_routes || previous.models !== current.models
          }
        >
          {({ getFieldValue, setFieldValue }) => {
            const allowedRoutes = parseAllowedRoutes(getFieldValue("allowed_routes"));
            const isDisabled = allowedRoutes.includes("management_routes") || allowedRoutes.includes("info_routes");
            const models = getFieldValue("models") || [];
            return (
              <>
                <Select
                  mode="multiple"
                  placeholder="Select models"
                  style={{ width: "100%" }}
                  disabled={isDisabled}
                  value={isDisabled ? [] : models}
                  onChange={(value) => {
                    if (value.includes("all-team-models")) setFieldValue("models", ["all-team-models"]);
                    else if (value.includes("all-proxy-models")) setFieldValue("models", ["all-proxy-models"]);
                    else setFieldValue("models", value);
                  }}
                >
                  {keyData.team_id != null ? (
                    team != null && <Select.Option value="all-team-models">All Team Models</Select.Option>
                  ) : (
                    <Select.Option value="all-proxy-models">All Proxy Models</Select.Option>
                  )}
                  {availableModels.map((model) => (
                    <Select.Option key={model} value={model} disabled={hasAllModelsSentinel(models)}>
                      {model}
                    </Select.Option>
                  ))}
                </Select>
                {isDisabled && (
                  <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "2px" }}>
                    Models field is disabled for this key type
                  </div>
                )}
              </>
            );
          }}
        </Form.Item>
      </Form.Item>
      <Form.Item label="Key Type">
        <Form.Item noStyle shouldUpdate={(previous, current) => previous.allowed_routes !== current.allowed_routes}>
          {({ getFieldValue, setFieldValue }) => {
            const keyTypeValue = keyTypeFromRoutes(parseAllowedRoutes(getFieldValue("allowed_routes")));
            return (
              <Select
                placeholder="Select key type"
                style={{ width: "100%" }}
                optionLabelProp="label"
                value={keyTypeValue}
                onChange={(value) => updateKeyType(value, setFieldValue)}
              >
                <Select.Option value="default" label="Full Access">
                  <div style={{ padding: "4px 0" }}>
                    <div style={{ fontWeight: 500 }}>Full Access</div>
                    <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "2px" }}>
                      Can call all routes (AI APIs, Management, and read-only)
                    </div>
                  </div>
                </Select.Option>
                <Select.Option value="llm_api" label="AI APIs">
                  <div style={{ padding: "4px 0" }}>
                    <div style={{ fontWeight: 500 }}>AI APIs</div>
                    <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "2px" }}>
                      Can call only AI API routes (chat/completions, embeddings, etc.)
                    </div>
                  </div>
                </Select.Option>
                <Select.Option value="management" label="Management">
                  <div style={{ padding: "4px 0" }}>
                    <div style={{ fontWeight: 500 }}>Management</div>
                    <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "2px" }}>
                      Can call only management routes (user/team/key management)
                    </div>
                  </div>
                </Select.Option>
              </Select>
            );
          }}
        </Form.Item>
      </Form.Item>
    </>
  );
}
