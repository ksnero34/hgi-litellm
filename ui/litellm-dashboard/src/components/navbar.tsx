import { useHealthReadinessDetails } from "@/app/(dashboard)/hooks/healthReadiness/useHealthReadinessDetails";
import { useWorker } from "@/hooks/useWorker";
import { getProxyBaseUrl } from "@/components/networking";
import { migratedHref } from "@/utils/migratedPages";
import { useTheme } from "@/contexts/ThemeContext";
import { clearTokenCookies } from "@/utils/cookieUtils";
import { clearStoredReturnUrl, getLoginUrl } from "@/utils/returnUrlUtils";
import useProxySettings from "@/app/(dashboard)/hooks/proxySettings/useProxySettings";
import { Badge } from "@/components/ui/badge";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link from "next/link";
import React from "react";
import { useTranslation } from "react-i18next";
import { NotificationsBell } from "./Navbar/NotificationsBell/NotificationsBell";
import UserDropdown from "./Navbar/UserDropdown/UserDropdown";
import ViewSwitcher from "./Navbar/ViewSwitcher";
import WorkerDropdown from "./Navbar/WorkerDropdown/WorkerDropdown";

interface NavbarProps {
  accessToken: string | null;
  isPublicPage: boolean;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

const Navbar: React.FC<NavbarProps> = ({
  accessToken,
  isPublicPage = false,
  sidebarCollapsed = false,
  onToggleSidebar,
}) => {
  const { t } = useTranslation();
  const baseUrl = getProxyBaseUrl();
  const proxySettings = useProxySettings(accessToken);
  const { logoUrl } = useTheme();
  const { data: healthData } = useHealthReadinessDetails(accessToken);
  const version = healthData?.litellm_version;
  const { isControlPlane, selectedWorker } = useWorker();
  const showWorkerSwitch = isControlPlane && selectedWorker !== null;

  const imageUrl = logoUrl || `${baseUrl}/get_image`;

  const handleLogout = () => {
    clearTokenCookies();
    localStorage.removeItem("litellm_selected_worker_id");
    localStorage.removeItem("litellm_worker_url");
    window.location.href = proxySettings.PROXY_LOGOUT_URL || "";
  };

  const handleWorkerSwitch = (workerId: string) => {
    clearTokenCookies();
    clearStoredReturnUrl();
    localStorage.removeItem("litellm_selected_worker_id");
    localStorage.removeItem("litellm_worker_url");
    window.location.href = `${getLoginUrl()}?worker=${encodeURIComponent(workerId)}`;
  };

  return (
    <nav className="sticky top-0 z-10 border-b border-gray-200 bg-white">
      <div className="w-full">
        <div className="flex h-14 items-center px-4">
          <div className="flex shrink-0 items-center">
            {onToggleSidebar && (
              <button
                onClick={onToggleSidebar}
                className="mr-2 flex h-9 w-9 items-center justify-center rounded-md text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
                title={sidebarCollapsed ? t("shell.expandSidebar") : t("shell.collapseSidebar")}
              >
                <span className="text-lg">
                  {sidebarCollapsed ? (
                    <PanelLeftOpen className="size-[18px]" />
                  ) : (
                    <PanelLeftClose className="size-[18px]" />
                  )}
                </span>
              </button>
            )}

            <div className="flex items-center gap-2">
              <Link href={migratedHref("")} className="flex items-center">
                <div className="relative">
                  <div className="flex h-10 max-w-48 items-center justify-center overflow-hidden">
                    <img
                      src={imageUrl}
                      alt={t("app.name")}
                      className="h-auto max-h-full w-auto max-w-full object-contain"
                    />
                  </div>
                </div>
              </Link>
              {version && (
                <Badge variant="outline" className="text-xs font-medium">
                  v{version}
                </Badge>
              )}
            </div>
          </div>

          {!isPublicPage && (
            <div className="ml-4 flex shrink-0 items-center border-l border-gray-200 pl-4">
              <ViewSwitcher />
            </div>
          )}

          <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-4">
            {showWorkerSwitch && (
              <div className="flex shrink-0 items-center">
                <WorkerDropdown onWorkerSwitch={handleWorkerSwitch} />
              </div>
            )}

            {!isPublicPage && (
              <div className="flex shrink-0 items-center border-l border-gray-200 pl-4">
                <div className="flex items-center gap-0.5 rounded-lg bg-gray-50 px-1 py-0 transition-colors hover:bg-gray-100">
                  <NotificationsBell />
                  <span className="mx-0.5 h-6 w-px shrink-0 bg-gray-200" aria-hidden />
                  <UserDropdown onLogout={handleLogout} />
                </div>
              </div>
            )}
          </div>
          {/* Dark mode toggle: keep disabled until the dashboard supports dark styles end-to-end. */}
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
