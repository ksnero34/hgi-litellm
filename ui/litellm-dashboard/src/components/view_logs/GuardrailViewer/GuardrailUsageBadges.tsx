import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getSpendString } from "@/utils/dataUtils";

type GuardrailUsageBadgesProps = {
  textRecords?: number;
  cost?: number;
  includedInSpend?: boolean;
};

export function GuardrailUsageBadges({ textRecords, cost, includedInSpend }: GuardrailUsageBadgesProps) {
  return (
    <>
      {textRecords != null && (
        <span className="px-2 py-0.5 bg-muted text-muted-foreground border border-border rounded-sm text-[11px] font-medium shrink-0">
          {textRecords.toLocaleString()} text record{textRecords === 1 ? "" : "s"}
        </span>
      )}

      {cost != null && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="px-2 py-0.5 bg-muted text-muted-foreground border border-border rounded-sm text-[11px] font-semibold shrink-0" />
              }
            >
              {cost === 0 ? "$0.00" : getSpendString(cost, 8)}
            </TooltipTrigger>
            <TooltipContent>
              {includedInSpend === false
                ? "Estimated guardrail cost (reported only; not counted against spend or budgets)"
                : "Guardrail cost"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </>
  );
}
