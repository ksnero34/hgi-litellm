import React from "react";
import {
  ArrowLeft,
  ArrowLeftRight,
  Ban,
  Calendar,
  CircleCheck,
  Clock,
  MoreVertical,
  Plus,
  RefreshCw,
  ShieldCheck,
  Timer,
  Trash2,
  User,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import CopyButton from "@/components/shared/CopyButton";
import LabeledField from "../common_components/LabeledField";
import DefaultProxyAdminTag from "../common_components/DefaultProxyAdminTag";
import { useTranslation } from "react-i18next";

export interface KeyInfoData {
  keyName: string;
  keyId: string;
  userId: string;
  userEmail: string;
  userAlias?: string | null;
  createdBy: string;
  createdAt: string;
  lastUpdated: string;
  lastActive: string;
  expires: string;
}

interface KeyInfoHeaderProps {
  data: KeyInfoData;
  onBack?: () => void;
  onCreateNew?: () => void;
  onRegenerate?: () => void;
  onDelete?: () => void;
  onResetSpend?: () => void;
  onToggleBlocked?: () => void;
  isBlocked?: boolean;
  canModifyKey?: boolean;
  backButtonText?: string;
  regenerateDisabled?: boolean;
  regenerateTooltip?: string;
}

function UserField({ userAlias, userEmail, userId }: { userAlias?: string | null; userEmail: string; userId: string }) {
  const { t } = useTranslation();
  const labelEl = (
    <div className="flex items-center gap-1">
      <span className="text-muted-foreground">
        <User className="size-3.5" />
      </span>
      <span className="text-xs uppercase tracking-[0.05em] text-muted-foreground">
        {t("gateway.keyInfoHeader.user")}
      </span>
    </div>
  );

  const isEmpty = !userAlias && !userEmail && !userId;
  if (isEmpty) {
    return (
      <div>
        {labelEl}
        <div>
          <span className="font-semibold">-</span>
        </div>
      </div>
    );
  }

  const isDefaultAdmin = userId === "default_user_id";
  const displayValue = userAlias || userEmail || userId;

  const popoverContent = (
    <div className="flex flex-col gap-2 text-xs min-w-[200px] max-w-[300px]">
      {[
        { label: t("gateway.keyInfoHeader.userAlias"), value: userAlias ?? null },
        { label: t("gateway.keyInfoHeader.userEmail"), value: userEmail || null },
        { label: t("gateway.keyInfoHeader.userId"), value: userId || null },
      ].map(({ label, value }) => (
        <div key={label} className="flex flex-col min-w-0">
          <span className="text-gray-400">{label}</span>
          {value ? (
            <div className="flex min-w-0 items-center gap-1">
              <span className="min-w-0 flex-1 truncate font-mono text-xs" title={value}>
                {value}
              </span>
              <CopyButton
                value={value}
                label={t("gateway.keyInfoHeader.copyField", { field: label })}
                iconClassName="size-3.5"
              />
            </div>
          ) : (
            <span className="font-mono">-</span>
          )}
        </div>
      ))}
    </div>
  );

  if (isDefaultAdmin && !userAlias && !userEmail) {
    return (
      <div>
        {labelEl}
        <div>
          <HoverCard>
            <HoverCardTrigger
              render={
                <span className="cursor-default">
                  <DefaultProxyAdminTag userId={userId} />
                </span>
              }
            />
            <HoverCardContent side="bottom" align="start" className="w-auto">
              {popoverContent}
            </HoverCardContent>
          </HoverCard>
        </div>
      </div>
    );
  }

  return (
    <div>
      {labelEl}
      <div>
        <HoverCard>
          <HoverCardTrigger
            render={<span className="block max-w-[200px] cursor-default truncate font-semibold">{displayValue}</span>}
          />
          <HoverCardContent side="bottom" align="start" className="w-auto">
            {popoverContent}
          </HoverCardContent>
        </HoverCard>
      </div>
    </div>
  );
}

export function KeyInfoHeader({
  data,
  onBack,
  onCreateNew,
  onRegenerate,
  onDelete,
  onResetSpend,
  onToggleBlocked,
  isBlocked = false,
  canModifyKey = true,
  backButtonText,
  regenerateDisabled = false,
  regenerateTooltip,
}: KeyInfoHeaderProps) {
  const { t } = useTranslation();
  const regenerateButton = (
    <span>
      <Button variant="outline" onClick={onRegenerate} disabled={regenerateDisabled}>
        <RefreshCw className="size-3.5" />
        {t("gateway.keyInfoHeader.regenerate")}
      </Button>
    </span>
  );

  return (
    <div>
      {onCreateNew && (
        <div style={{ marginBottom: 16 }}>
          <Button onClick={onCreateNew}>
            <Plus className="size-3.5" />
            {t("gateway.keyInfoHeader.createNew")}
          </Button>
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-3.5" />
          {backButtonText || t("gateway.keyInfoHeader.back")}
        </Button>
      </div>

      <div className="flex items-start justify-between" style={{ marginBottom: 20 }}>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="m-0 flex items-center gap-1 text-2xl font-semibold">
              {data.keyName}
              <CopyButton value={data.keyName} label={t("gateway.keyInfoHeader.copyKeyAlias")} iconClassName="size-4" />
            </h3>
            {isBlocked && (
              <Badge variant="destructive">
                <Ban className="size-3" />
                {t("gateway.keyInfoHeader.blocked")}
              </Badge>
            )}
          </div>
          <div className="flex min-w-0 items-center gap-1">
            <span className="min-w-0 break-words text-muted-foreground">
              {t("gateway.keyInfoHeader.keyId", { id: data.keyId })}
            </span>
            <CopyButton value={data.keyId} label={t("gateway.keyInfoHeader.copyKeyId")} iconClassName="size-3.5" />
          </div>
        </div>
        {canModifyKey && (
          <div className="flex items-center gap-2">
            {regenerateTooltip ? (
              <TooltipProvider delay={300}>
                <Tooltip>
                  <TooltipTrigger render={regenerateButton} />
                  <TooltipContent>{regenerateTooltip}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              regenerateButton
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="outline" size="icon" aria-label={t("gateway.keyInfoHeader.moreActions")} />}
              >
                <MoreVertical className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-auto">
                {onToggleBlocked &&
                  (isBlocked ? (
                    <DropdownMenuItem onClick={onToggleBlocked}>
                      <CircleCheck className="size-3.5" />
                      {t("gateway.keyInfoHeader.unblock")}
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem variant="destructive" onClick={onToggleBlocked}>
                      <Ban className="size-3.5" />
                      {t("gateway.keyInfoHeader.block")}
                    </DropdownMenuItem>
                  ))}
                {onResetSpend && (
                  <DropdownMenuItem variant="destructive" onClick={onResetSpend}>
                    <ArrowLeftRight className="size-3.5" />
                    {t("gateway.keyInfoHeader.resetSpend")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem variant="destructive" onClick={onDelete}>
                  <Trash2 className="size-3.5" />
                  {t("gateway.keyInfoHeader.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      <div className="flex items-stretch gap-10" style={{ marginBottom: 40 }}>
        <div className="flex min-w-0 flex-col gap-4">
          <UserField userAlias={data.userAlias} userEmail={data.userEmail} userId={data.userId} />
          <LabeledField
            label={t("gateway.keyInfoHeader.expires")}
            value={data.expires}
            icon={<Timer className="size-3.5" />}
          />
        </div>

        <Separator orientation="vertical" />

        <div className="flex min-w-0 flex-col gap-4">
          <LabeledField
            label={t("gateway.keyInfoHeader.createdAt")}
            value={data.createdAt}
            icon={<Calendar className="size-3.5" />}
          />
          <LabeledField
            label={t("gateway.keyInfoHeader.createdBy")}
            value={data.createdBy}
            icon={<ShieldCheck className="size-3.5" />}
            truncate
            copyable
            defaultUserIdCheck
          />
        </div>

        <Separator orientation="vertical" />

        <div className="flex min-w-0 flex-col gap-4">
          <LabeledField
            label={t("gateway.keyInfoHeader.lastUpdated")}
            value={data.lastUpdated}
            icon={<Clock className="size-3.5" />}
          />
          <LabeledField
            label={t("gateway.keyInfoHeader.lastActive")}
            value={data.lastActive}
            icon={<Zap className="size-3.5" />}
          />
        </div>
      </div>
    </div>
  );
}
