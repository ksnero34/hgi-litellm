import { BarChart3, Bot, Building2, Globe, LineChart, ShoppingCart, Tags, User, Users } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { all_admin_roles } from "@/utils/roles";
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
  userRole: string | null;
  canViewTagUsage?: boolean;
  isOrgAdmin?: boolean;
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
    icon: <Globe className="size-4" />,
    adminOnly: true,
  },
  {
    value: "my-usage",
    label: "observabilityExtra.usage.yours",
    description: "observabilityExtra.usage.ownDescription",
    icon: <User className="size-4" />,
  },
  {
    value: "organization",
    label: "observabilityExtra.usage.organization",
    description: "observabilityExtra.usage.allOrganizationsDescription",
    icon: <Building2 className="size-4" />,
    adminOnly: true,
  },
  {
    value: "team",
    label: "observabilityExtra.usage.team",
    description: "observabilityExtra.usage.teamDescription",
    icon: <Users className="size-4" />,
  },
  {
    value: "customer",
    label: "observabilityExtra.usage.customer",
    description: "observabilityExtra.usage.customerDescription",
    icon: <ShoppingCart className="size-4" />,
    adminOnly: true,
  },
  {
    value: "tag",
    label: "observabilityExtra.usage.tag",
    description: "observabilityExtra.usage.tagDescription",
    icon: <Tags className="size-4" />,
    adminOnly: true,
  },
  {
    value: "agent",
    label: "observabilityExtra.usage.agent",
    description: "observabilityExtra.usage.agentDescription",
    icon: <Bot className="size-4" />,
    adminOnly: true,
  },
  {
    value: "user",
    label: "observabilityExtra.usage.user",
    description: "observabilityExtra.usage.userDescription",
    icon: <User className="size-4" />,
    adminOnly: true,
  },
  {
    value: "user-agent-activity",
    label: "observabilityExtra.usage.userAgentActivity",
    description: "observabilityExtra.usage.userAgentDescription",
    icon: <LineChart className="size-4" />,
    adminOnly: true,
  },
];
export const UsageViewSelect: React.FC<UsageViewSelectProps> = ({
  value,
  onChange,
  userRole,
  title,
  description,
  "data-id": dataId,
}) => {
  const { t } = useTranslation();
  const isAdmin = all_admin_roles.includes(userRole ?? "");
  const getFilteredOptions = () => {
    return OPTIONS.filter((option) => {
      if (option.adminOnly && !isAdmin) {
        return false;
      }
      if (option.value === "tag" && !isAdmin) {
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
  const selectedOption = filteredOptions.find((option) => option.value === value);
  return (
    <div className="w-full" data-id={dataId}>
      <div className="flex flex-wrap items-center justify-start gap-4">
        <div className="flex items-stretch gap-2 min-w-0">
          <div className="shrink-0 flex items-center">
            <BarChart3 className="size-8" />
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
            onValueChange={(next: UsageOption | null) => {
              if (next) onChange(next);
            }}
          >
            <SelectTrigger className="w-54 sm:w-64 md:w-72">
              <SelectValue>
                {selectedOption && (
                  <span className="flex items-center gap-2">
                    {selectedOption.icon}
                    <span className="text-sm">{selectedOption.label}</span>
                  </span>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {filteredOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <span className="flex items-center gap-2 py-1">
                    <span className="shrink-0 mt-0.5">{option.icon}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-foreground">{option.label}</span>
                      <span className="block text-xs text-muted-foreground mt-0.5">{option.description}</span>
                    </span>
                    {option.badgeText && <Badge>{option.badgeText}</Badge>}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
};
