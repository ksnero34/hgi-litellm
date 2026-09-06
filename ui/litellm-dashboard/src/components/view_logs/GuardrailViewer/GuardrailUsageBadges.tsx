import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getSpendString } from "@/utils/dataUtils";

export type AnalysisCacheMetadata = {
  status: "hit" | "partial" | "miss";
  hit_count: number;
  total_count: number;
};

type GuardrailUsageBadgesProps = {
  analysisCache?: AnalysisCacheMetadata;
  textRecords?: number;
  cost?: number;
  includedInSpend?: boolean;
};

export function GuardrailUsageBadges({ analysisCache, textRecords, cost, includedInSpend }: GuardrailUsageBadgesProps) {
  return (
    <>
      <AnalysisCacheBadge cache={analysisCache} />
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

function AnalysisCacheBadge({ cache }: { cache?: AnalysisCacheMetadata }) {
  if (!cache || cache.status === "miss") return null;
  if (cache.hit_count <= 0 || cache.total_count < cache.hit_count) return null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="px-2 py-0.5 bg-info/10 text-info border border-info/20 rounded-sm text-[11px] font-semibold shrink-0" />
          }
        >
          {cache.status === "partial" ? "Partial analysis cache hit" : "Analysis cache hit"}
          {` (${cache.hit_count}/${cache.total_count})`}
        </TooltipTrigger>
        <TooltipContent>
          Reused cached Presidio analysis for {cache.hit_count} of {cache.total_count} text fragments. Policy checks and
          anonymization still run.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
