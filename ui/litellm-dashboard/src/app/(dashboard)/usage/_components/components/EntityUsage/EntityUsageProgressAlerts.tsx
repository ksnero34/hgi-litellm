import { ExternalLink, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/shared/Alert";
import { Button } from "@/components/ui/button";

interface ProgressState {
  currentPage: number;
  totalPages: number;
}

interface EntityUsageProgressAlertsProps {
  isFetchingMore: boolean;
  progress: ProgressState;
  cancelled: boolean;
  cancel: () => void;
  showAgentBreakdown: boolean;
  agentIsFetchingMore: boolean;
  agentProgress: ProgressState;
  agentCancelled: boolean;
  agentCancel: () => void;
}

const EntityUsageProgressAlerts: React.FC<EntityUsageProgressAlertsProps> = ({
  isFetchingMore,
  progress,
  cancelled,
  cancel,
  showAgentBreakdown,
  agentIsFetchingMore,
  agentProgress,
  agentCancelled,
  agentCancel,
}) => {
  const { t } = useTranslation();

  return (
    <>
      {isFetchingMore && (
        <Alert variant="warning" className="mb-2">
          <AlertDescription className="flex items-center justify-between text-inherit">
            <span>
              <Loader2 className="mr-2 inline size-4 animate-spin align-text-bottom" />
              {t("observability.usage.fetching_spend_data", {
                current: progress.currentPage,
                total: progress.totalPages,
              })}{" "}
              <a href={window.location.href} target="_blank" rel="noopener noreferrer">
                {t("observability.usage.open_new_tab")} <ExternalLink className="inline size-3.5 align-text-bottom" />
              </a>
              .
            </span>
            <Button variant="destructive" onClick={cancel}>
              {t("observability.usage.stop")}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {cancelled && (
        <Alert variant="info" className="mb-2">
          <AlertDescription className="text-inherit">
            {t("observability.usage.showing_partial_data", {
              current: progress.currentPage,
              total: progress.totalPages,
            })}
          </AlertDescription>
        </Alert>
      )}
      {agentIsFetchingMore && showAgentBreakdown && (
        <Alert variant="warning" className="mb-2">
          <AlertDescription className="flex items-center justify-between text-inherit">
            <span>
              <Loader2 className="mr-2 inline size-4 animate-spin align-text-bottom" />
              {t("observability.usage.fetching_agent_data", {
                current: agentProgress.currentPage,
                total: agentProgress.totalPages,
              })}{" "}
              <a href={window.location.href} target="_blank" rel="noopener noreferrer">
                {t("observability.usage.open_new_tab")} <ExternalLink className="inline size-3.5 align-text-bottom" />
              </a>
              .
            </span>
            <Button variant="destructive" onClick={agentCancel}>
              {t("observability.usage.stop")}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {agentCancelled && showAgentBreakdown && (
        <Alert variant="info" className="mb-2">
          <AlertDescription className="text-inherit">
            {t("observability.usage.showing_partial_agent_data", {
              current: agentProgress.currentPage,
              total: agentProgress.totalPages,
            })}
          </AlertDescription>
        </Alert>
      )}
    </>
  );
};

export default EntityUsageProgressAlerts;
