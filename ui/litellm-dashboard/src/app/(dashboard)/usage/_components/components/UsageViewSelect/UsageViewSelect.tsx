import {
  BankOutlined,
  BarChartOutlined,
  GlobalOutlined,
  LineChartOutlined,
  RobotOutlined,
  ShoppingCartOutlined,
  TagsOutlined,
  TeamOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Badge, Select } from "antd";
import React from "react";
import { useTranslation } from "react-i18next";
export type UsageOption =
  | "global"
  | "my-usage"
  | "organization"
  | "team"
  | "customer"
  | "tag"
  | "agent"
  | "user"
  | "user-agent-activity";
export interface UsageViewSelectProps {
  value: UsageOption;
  onChange: (value: UsageOption) => void;
  isAdmin: boolean;
  canViewTagUsage?: boolean;
  title?: string;
  description?: string;
  "data-id"?: string;
}
interface OptionConfig {
  value: UsageOption;
  label: string;
  description: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
  showForAdmin?: string;
  showForNonAdmin?: string;
  descriptionForAdmin?: string;
  descriptionForNonAdmin?: string;
  badgeText?: string;
}
const OPTIONS: OptionConfig[] = [
  {
    value: "global",
    label: "observabilityExtra.usage.global",
    showForAdmin: "observabilityExtra.usage.global",
    showForNonAdmin: "observabilityExtra.usage.yours",
    description: "observabilityExtra.usage.allResourcesDescription",
    descriptionForAdmin: "observabilityExtra.usage.allResourcesDescription",
    descriptionForNonAdmin: "observabilityExtra.usage.yoursDescription",
    icon: <GlobalOutlined style={{ fontSize: "16px" }} />,
    adminOnly: true,
  },
  {
    value: "my-usage",
    label: "observabilityExtra.usage.yours",
    description: "observabilityExtra.usage.ownDescription",
    icon: <UserOutlined style={{ fontSize: "16px" }} />,
  },
  {
    value: "organization",
    label: "observabilityExtra.usage.organization",
    showForAdmin: "observabilityExtra.usage.organization",
    showForNonAdmin: "observabilityExtra.usage.yourOrganization",
    description: "observabilityExtra.usage.organizationDescription",
    descriptionForAdmin: "observabilityExtra.usage.allOrganizationsDescription",
    descriptionForNonAdmin: "observabilityExtra.usage.yourOrganizationDescription",
    icon: <BankOutlined style={{ fontSize: "16px" }} />,
    adminOnly: true,
  },
  {
    value: "team",
    label: "observabilityExtra.usage.team",
    description: "observabilityExtra.usage.teamDescription",
    icon: <TeamOutlined style={{ fontSize: "16px" }} />,
  },
  {
    value: "customer",
    label: "observabilityExtra.usage.customer",
    description: "observabilityExtra.usage.customerDescription",
    icon: <ShoppingCartOutlined style={{ fontSize: "16px" }} />,
    adminOnly: true,
  },
  {
    value: "tag",
    label: "observabilityExtra.usage.tag",
    description: "observabilityExtra.usage.tagDescription",
    icon: <TagsOutlined style={{ fontSize: "16px" }} />,
    adminOnly: true,
  },
  {
    value: "agent",
    label: "observabilityExtra.usage.agent",
    description: "observabilityExtra.usage.agentDescription",
    icon: <RobotOutlined style={{ fontSize: "16px" }} />,
    adminOnly: true,
  },
  {
    value: "user",
    label: "observabilityExtra.usage.user",
    description: "observabilityExtra.usage.userDescription",
    icon: <UserOutlined style={{ fontSize: "16px" }} />,
    adminOnly: true,
  },
  {
    value: "user-agent-activity",
    label: "observabilityExtra.usage.userAgentActivity",
    description: "observabilityExtra.usage.userAgentDescription",
    icon: <LineChartOutlined style={{ fontSize: "16px" }} />,
    adminOnly: true,
  },
];
export const UsageViewSelect: React.FC<UsageViewSelectProps> = ({
  value,
  onChange,
  isAdmin,
  canViewTagUsage = false,
  title,
  description,
  "data-id": dataId,
}) => {
  const { t } = useTranslation();
  const getFilteredOptions = () => {
    return OPTIONS.filter((option) => {
      if (option.adminOnly && !isAdmin) {
        return false;
      }
      if (option.value === "tag" && !isAdmin && !canViewTagUsage) {
        return false;
      }
      return true;
    }).map((option) => {
      let label = option.label;
      let desc = option.description;
      if (option.showForAdmin && option.showForNonAdmin) {
        label = isAdmin ? option.showForAdmin : option.showForNonAdmin;
      }
      if (option.descriptionForAdmin && option.descriptionForNonAdmin) {
        desc = isAdmin ? option.descriptionForAdmin : option.descriptionForNonAdmin;
      }
      return {
        value: option.value,
        label: t(label),
        description: t(desc),
        icon: option.icon,
        badgeText: option.badgeText,
      };
    });
  };
  const filteredOptions = getFilteredOptions();
  return (
    <div className="w-full" data-id={dataId}>
      <div className="flex flex-wrap items-center justify-start gap-4">
        <div className="flex items-stretch gap-2 min-w-0">
          <div className="shrink-0 flex items-center">
            <BarChartOutlined style={{ fontSize: "32px" }} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-gray-900 mb-0.5 leading-tight">
              {title ?? t("observabilityExtra.usage.viewTitle")}
            </h3>
            <p className="text-xs text-gray-600 leading-tight">
              {description ?? t("observabilityExtra.usage.viewDescription")}
            </p>
          </div>
        </div>
        <div className="shrink-0">
          <Select
            value={value}
            onChange={onChange}
            className="w-54 sm:w-64 md:w-72"
            size="large"
            options={filteredOptions.map((opt) => ({
              value: opt.value,
              label: opt.label,
            }))}
            optionRender={(option) => {
              const opt = filteredOptions.find((o) => o.value === option.value);
              if (!opt) return option.label;
              return (
                <div className="flex items-center gap-2 py-1">
                  <div className="shrink-0 mt-0.5">{opt.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900">{opt.label}</div>
                    <div className="text-xs text-gray-600 mt-0.5">{opt.description}</div>
                  </div>
                  {opt.badgeText && (
                    <div className="items-center">
                      <Badge color="blue" count={opt.badgeText} />
                    </div>
                  )}
                </div>
              );
            }}
            labelRender={(props) => {
              const opt = filteredOptions.find((o) => o.value === props.value);
              if (!opt) return props.label;
              return (
                <div className="flex items-center gap-2">
                  <div>{opt.icon}</div>
                  <span className="text-sm">{opt.label}</span>
                </div>
              );
            }}
          />
        </div>
      </div>
    </div>
  );
};
