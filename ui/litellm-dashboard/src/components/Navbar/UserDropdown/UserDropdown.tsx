import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import { useDisableShowPrompts } from "@/app/(dashboard)/hooks/useDisableShowPrompts";
import { navAccountDisplayName } from "@/components/Navbar/navDisplayName";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/cva.config";
import {
  emitLocalStorageChange,
  getLocalStorageItem,
  removeLocalStorageItem,
  setLocalStorageItem,
} from "@/utils/localStorageUtils";
import { DownOutlined, LogoutOutlined, MailOutlined, SafetyOutlined, UserOutlined } from "@ant-design/icons";
import type { MenuProps } from "antd";
import { Button, Divider, Dropdown, Space, Switch, Tag, Typography } from "antd";
import { ChevronsUpDown } from "lucide-react";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const { Text } = Typography;

function hueFromString(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = seed.charCodeAt(i) + ((h << 5) - h);
  }
  return Math.abs(h) % 360;
}

function initialsFromIdentity(email: string | null, userId: string | null): string {
  const local = email?.split("@")[0]?.trim();
  if (local) {
    const parts = local
      .replace(/[^a-zA-Z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0]!.charAt(0)}${parts[1]!.charAt(0)}`.toUpperCase();
    }
    if (parts.length === 1) {
      const part = parts[0]!;
      return part.length >= 2 ? part.slice(0, 2).toUpperCase() : `${part.charAt(0)}`.toUpperCase();
    }
  }
  if (userId && userId.length >= 2) {
    return userId.slice(0, 2).toUpperCase();
  }
  if (userId && userId.length === 1) {
    return `${userId.toUpperCase()}•`;
  }
  return "?";
}

interface UserDropdownProps {
  onLogout: () => void;
  variant?: "navbar" | "sidebar";
  collapsed?: boolean;
}

const UserDropdown: React.FC<UserDropdownProps> = ({ onLogout, variant = "navbar", collapsed = false }) => {
  const { t } = useTranslation();
  const { userId, userEmail, userRoleLabel: userRole } = useAuthorized();
  const disableShowPrompts = useDisableShowPrompts();
  const [disableShowNewBadge, setDisableShowNewBadge] = useState(false);

  useEffect(() => {
    const storedValue = getLocalStorageItem("disableShowNewBadge");
    setDisableShowNewBadge(storedValue === "true");
  }, []);

  const userItems: MenuProps["items"] = [
    {
      key: "logout",
      label: (
        <Space>
          <LogoutOutlined />
          {t("auth.account.logout")}
        </Space>
      ),
      onClick: onLogout,
    },
  ];

  const emptyValue = t("auth.account.emptyValue");
  const unknownRole = t("auth.account.unknownRole");
  const unknownIdentity = t("auth.account.unknownIdentity");

  const renderUserInfoSection = () => (
    <Space direction="vertical" size="small" style={{ width: "100%", padding: "12px" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Space>
          <MailOutlined />
          <Text type="secondary">{userEmail || emptyValue}</Text>
        </Space>
        <Tag>{t("auth.account.tag")}</Tag>
      </Space>
      <Divider style={{ margin: "8px 0" }} />
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Space>
          <UserOutlined />
          <Text type="secondary">{t("auth.account.userId")}</Text>
        </Space>
        <Text copyable={{ text: userId || "" }} ellipsis style={{ maxWidth: "150px" }} title={userId || emptyValue}>
          {userId || emptyValue}
        </Text>
      </Space>
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Space>
          <SafetyOutlined />
          <Text type="secondary">{t("auth.account.role")}</Text>
        </Space>
        <Text>{userRole}</Text>
      </Space>
      <Divider style={{ margin: "8px 0" }} />
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Text type="secondary">{t("auth.account.hideNew")}</Text>
        <Switch
          size="small"
          checked={disableShowNewBadge}
          onChange={(checked) => {
            setDisableShowNewBadge(checked);
            if (checked) {
              setLocalStorageItem("disableShowNewBadge", "true");
              emitLocalStorageChange("disableShowNewBadge");
            } else {
              removeLocalStorageItem("disableShowNewBadge");
              emitLocalStorageChange("disableShowNewBadge");
            }
          }}
          aria-label={t("auth.account.hideNewAria")}
        />
      </Space>
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Text type="secondary">{t("auth.account.hidePrompts")}</Text>
        <Switch
          size="small"
          checked={disableShowPrompts}
          onChange={(checked) => {
            if (checked) {
              setLocalStorageItem("disableShowPrompts", "true");
              emitLocalStorageChange("disableShowPrompts");
            } else {
              removeLocalStorageItem("disableShowPrompts");
              emitLocalStorageChange("disableShowPrompts");
            }
          }}
          aria-label={t("auth.account.hidePromptsAria")}
        />
      </Space>
    </Space>
  );

  const seed = userEmail || userId || "user";
  const initials = initialsFromIdentity(userEmail, userId);
  const hue = hueFromString(seed);
  const displayName = navAccountDisplayName(userEmail, userId);
  const triggerLabel = t("auth.account.menu", {
    role: userRole ?? unknownRole,
    identity: userEmail || userId || unknownIdentity,
  });

  return (
    <Dropdown
      trigger={["click"]}
      placement={variant === "sidebar" ? "topLeft" : "bottomRight"}
      menu={{ items: userItems }}
      popupRender={(menu) => (
        <div className="rounded-lg bg-white shadow-lg" data-testid="user-dropdown-panel">
          {renderUserInfoSection()}
          <Divider style={{ margin: 0 }} />
          {React.cloneElement(menu as React.ReactElement, {
            style: { boxShadow: "none" },
          })}
        </div>
      )}
    >
      {variant === "sidebar" ? (
        <button
          type="button"
          className={cn(
            "flex w-full items-center rounded-lg border border-transparent transition-colors hover:bg-sidebar-accent",
            collapsed ? "justify-center px-0 py-1" : "gap-2.5 px-2 py-1.5 text-left",
          )}
          aria-label={triggerLabel}
          aria-haspopup="menu"
          title={collapsed ? displayName : undefined}
        >
          <Avatar className="size-[30px] shadow-inner ring-1 ring-black/5" aria-hidden>
            <AvatarFallback className="font-semibold text-white" style={{ backgroundColor: `hsl(${hue} 46% 38%)` }}>
              {initials}
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[13px] font-medium text-sidebar-foreground">{displayName}</span>
                {userRole && <span className="block truncate text-[11px] text-muted-foreground">{userRole}</span>}
              </span>
              <ChevronsUpDown size={16} strokeWidth={1.75} className="shrink-0 text-muted-foreground" aria-hidden />
            </>
          )}
        </button>
      ) : (
        <Button
          type="text"
          className="flex! max-w-[min(200px,34vw)] items-center gap-2 rounded-md! py-0.5! pl-1! pr-2! transition-colors hover:bg-gray-100!"
          aria-label={triggerLabel}
          aria-haspopup="menu"
        >
          <Avatar className="shadow-inner ring-1 ring-black/5" aria-hidden>
            <AvatarFallback className="font-semibold text-white" style={{ backgroundColor: `hsl(${hue} 46% 38%)` }}>
              {initials}
            </AvatarFallback>
          </Avatar>
          <span className="hidden min-w-0 truncate text-left text-sm font-medium leading-none text-gray-900 md:inline">
            {displayName}
          </span>
          <DownOutlined className="hidden shrink-0 text-[10px] text-gray-400 md:inline" aria-hidden />
        </Button>
      )}
    </Dropdown>
  );
};

export default UserDropdown;
