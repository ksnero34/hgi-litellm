import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ACTION_ITEMS } from "./action_options";
import { NESTED_DIALOG_LAYER } from "./dialog_layering";

interface KeywordModalProps {
  visible: boolean;
  keyword: string;
  action: "BLOCK" | "MASK";
  description: string;
  onKeywordChange: (keyword: string) => void;
  onActionChange: (action: "BLOCK" | "MASK") => void;
  onDescriptionChange: (description: string) => void;
  onAdd: () => void;
  onCancel: () => void;
}

const KeywordModal: React.FC<KeywordModalProps> = ({
  visible,
  keyword,
  action,
  description,
  onKeywordChange,
  onActionChange,
  onDescriptionChange,
  onAdd,
  onCancel,
}) => {
  const { t } = useTranslation();
  const actionItems = ACTION_ITEMS.map((item) => ({
    ...item,
    label: t(item.value === "BLOCK" ? "safety.contentFilter.block" : "safety.contentFilter.mask"),
  }));
  return (
    <Dialog open={visible} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className={`max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[800px] ${NESTED_DIALOG_LAYER}`}>
        <DialogHeader>
          <DialogTitle>{t("safety.contentFilter.addKeywordTitle")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <div>
            <p className="font-semibold">{t("safety.contentFilter.keyword")}</p>
            <Input
              className="mt-2"
              placeholder={t("safety.contentFilter.keywordPlaceholder")}
              value={keyword}
              onChange={(e) => onKeywordChange(e.target.value)}
            />
          </div>

          <div>
            <p className="font-semibold">{t("safety.contentFilter.action")}</p>
            <p className="mt-1 mb-2 text-muted-foreground">{t("safety.contentFilter.keywordActionHelp")}</p>
            <Select
              items={actionItems}
              value={action}
              onValueChange={(value: string | null) => value && onActionChange(value as "BLOCK" | "MASK")}
            >
              <SelectTrigger className="w-full" aria-label={t("safety.contentFilter.action")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {actionItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <p className="font-semibold">{t("safety.contentFilter.descriptionOptional")}</p>
            <Textarea
              className="mt-2 field-sizing-fixed"
              placeholder={t("safety.contentFilter.descriptionPlaceholder")}
              value={description}
              onChange={(e) => onDescriptionChange(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t("safety.contentFilter.cancel")}
          </Button>
          <Button onClick={onAdd}>{t("safety.contentFilter.add")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default KeywordModal;
