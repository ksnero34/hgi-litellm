import { formatDurationMs, getMeasuredOverhead, isValidInterval, type TimingInterval } from "./guardrailTiming";
import React, { useState, useMemo } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import PresidioDetectedEntities from "./PresidioDetectedEntities";
import BedrockGuardrailDetails, {
  BedrockGuardrailResponse,
} from "@/components/view_logs/GuardrailViewer/BedrockGuardrailDetails";
import ContentFilterDetails from "./ContentFilterDetails";
import CompliancePanel from "./CompliancePanel";
import { complianceBadgeClass, OUTCOME_PRECEDENCE } from "./compliance";
import { GuardrailUsageBadges, type AnalysisCacheMetadata } from "./GuardrailUsageBadges";

interface RecognitionMetadata {
  recognizer_name: string;
  recognizer_identifier: string;
}

interface GuardrailEntity {
  end: number;
  score: number;
  start: number;
  entity_type: string;
  analysis_explanation: string | null;
  recognition_metadata: RecognitionMetadata;
}

interface MaskedEntityCount {
  [key: string]: number;
}

interface MatchDetail {
  type: string;
  detection_method?: string;
  action_taken?: string;
  snippet?: string;
  category?: string;
  position?: number;
}

interface GuardrailInputSource {
  type?: string;
  message_index?: number;
  role?: string;
  content_index?: number | null;
  path?: string;
  scope?: string;
}

interface GuardrailInformation {
  duration: number;
  end_time: number;
  start_time: number;
  guardrail_mode: string | string[] | Record<string, unknown> | null;
  guardrail_name: string;
  guardrail_status: string;
  usage_action?: "passed" | "flagged" | "blocked";
  guardrail_response: GuardrailEntity[] | BedrockGuardrailResponse | any;
  masked_entity_count: MaskedEntityCount;
  guardrail_provider?: string;
  guardrail_id?: string;
  policy_template?: string;
  detection_method?: string;
  confidence_score?: number;
  classification?: Record<string, any>;
  match_details?: MatchDetail[];
  patterns_checked?: number;
  alert_recipients?: string[];
  risk_score?: number;
  guardrail_run_id?: string;
  guardrail_event?: string;
  input_source?: GuardrailInputSource;
  guardrail_usage?: Record<string, number>;
  guardrail_cost?: number;
  guardrail_cost_in_spend?: boolean;
  analysis_cache?: AnalysisCacheMetadata;
  shared_analysis?: TimingInterval;
}

interface GuardrailViewerProps {
  data: GuardrailInformation | GuardrailInformation[];
  accessToken?: string | null;
  logEntry?: {
    request_id: string;
    user?: string;
    model?: string;
    startTime?: string;
    endTime?: string;
    metadata?: Record<string, any>;
  };
}

const PROVIDERS_WITH_CUSTOM_RENDERERS = new Set(["presidio", "bedrock", "litellm_content_filter"]);

const resolveMode = (mode: GuardrailInformation["guardrail_mode"]): string | null => {
  if (mode == null) return null;
  if (typeof mode === "string") return mode;
  if (Array.isArray(mode)) {
    const first = mode[0];
    return typeof first === "string" ? first : null;
  }
  if (typeof mode === "object" && "default" in mode) {
    const def = mode.default;
    if (typeof def === "string") return def;
    if (Array.isArray(def)) {
      const first = def[0];
      return typeof first === "string" ? first : null;
    }
  }
  return null;
};

const modeMatches = (mode: GuardrailInformation["guardrail_mode"], target: string): boolean => {
  if (mode == null) return false;
  if (typeof mode === "string") return mode === target;
  if (Array.isArray(mode)) return mode.includes(target);
  if (typeof mode === "object" && "default" in mode) {
    const def = mode.default;
    if (typeof def === "string") return def === target;
    if (Array.isArray(def)) return def.some((x) => typeof x === "string" && x === target);
  }
  return false;
};

const formatMode = (mode: GuardrailInformation["guardrail_mode"]): string => {
  const s = resolveMode(mode);
  if (s == null || s === "") return "—";
  return s.replace(/_/g, "-").toUpperCase();
};

const INPUT_SCOPE_LABELS: Record<string, string> = {
  system_prompt: "SYSTEM PROMPT",
  conversation_history: "HISTORY",
  current_user_prompt: "CURRENT USER PROMPT",
  current_user_context: "CURRENT USER CONTEXT",
  environment_context: "ENVIRONMENT CONTEXT",
  tool_result: "TOOL RESULT",
  other: "OTHER INPUT",
};

const getInputSourceLabel = (source?: GuardrailInputSource): string | null => {
  if (!source) return null;
  const scopeLabel = source.scope
    ? INPUT_SCOPE_LABELS[source.scope] ?? source.scope.replace(/_/g, " ").toUpperCase()
    : null;
  if (scopeLabel) {
    if (source.scope === "conversation_history" && source.role) {
      return `${scopeLabel} · ${source.role.toUpperCase()}`;
    }
    return scopeLabel;
  }
  const parts = [
    source.role?.toUpperCase(),
    source.message_index != null ? `Message ${source.message_index + 1}` : source.type,
    source.content_index != null ? `Content ${source.content_index + 1}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : source.path ?? null;
};

const getTotalMasked = (entry: GuardrailInformation): number => {
  return Object.values(entry.masked_entity_count || {}).reduce(
    (sum, count) => sum + (typeof count === "number" ? count : 0),
    0,
  );
};

const isEntrySuccess = (entry: GuardrailInformation): boolean =>
  (entry.guardrail_status ?? "").toLowerCase() === "success";

const hasExecutionError = (entry: GuardrailInformation): boolean => /fail|error/i.test(entry.guardrail_status ?? "");

type GuardrailAction = "passed" | "flagged" | "blocked";
type ComplianceOutcome = GuardrailAction | "observed";

const getEntryAction = (entry: GuardrailInformation): GuardrailAction => {
  if (entry.usage_action) return entry.usage_action;
  const status = (entry.guardrail_status ?? "").toLowerCase();
  if (status.includes("intervened") || status.includes("block")) return "blocked";
  if (status.includes("fail") || status.includes("error")) return "flagged";
  return "passed";
};

const isLoggingOnlyEntry = (entry: GuardrailInformation): boolean =>
  modeMatches(entry.guardrail_event ?? entry.guardrail_mode, "logging_only");

const getComplianceOutcome = (entry: GuardrailInformation): ComplianceOutcome => {
  const action = getEntryAction(entry);
  return action === "flagged" && isLoggingOnlyEntry(entry) ? "observed" : action;
};

const getRiskColor = (score: number): string => {
  if (score <= 3) return "text-success bg-success/10 border-success/20";
  if (score <= 6) return "text-warning bg-warning/10 border-warning/20";
  return "text-destructive bg-destructive/10 border-destructive/20";
};

const getRiskScore = (entry: GuardrailInformation): number | null => {
  if (!isEntrySuccess(entry)) return null;

  // Prefer backend-computed score
  if (entry.risk_score != null) return entry.risk_score;

  // Fallback: compute from available data
  const totalMasked = getTotalMasked(entry);
  const patternsChecked = entry.patterns_checked ?? 0;
  const confidence = entry.confidence_score ?? 0;

  if (patternsChecked === 0 && confidence === 0) return 0;

  const matchRatio = patternsChecked > 0 ? totalMasked / patternsChecked : 0;
  let score = matchRatio * 7 + confidence * 3;
  if (totalMasked > 0 && score < 2) score = 2;
  return Math.min(10, Math.round(score * 10) / 10);
};

const getDisplayName = (entry: GuardrailInformation): string => entry.policy_template || entry.guardrail_name;

const ShieldIcon = () => (
  <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
    <circle cx="20" cy="20" r="20" fill="#EEF2FF" />
    <path
      d="M20 10l8 4v6c0 5.25-3.4 10.15-8 11.5C15.4 30.15 12 25.25 12 20v-6l8-4z"
      stroke="#6366F1"
      strokeWidth="1.5"
      fill="none"
    />
    <path
      d="M16 20l3 3 5-6"
      stroke="#6366F1"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </svg>
);

const outcomeIconStyle = {
  passed: { color: "text-success bg-success/10", path: "M7 11l3 3 5-6", label: "Passed" },
  flagged: { color: "text-warning bg-warning/10", path: "M11 6v6m0 3v.01", label: "Flagged" },
  blocked: { color: "text-destructive bg-destructive/10", path: "M8 8l6 6M14 8l-6 6", label: "Blocked" },
  observed: { color: "text-purple-700 bg-purple-100", path: "M11 10v6m0-10v.01", label: "Observed" },
};

const OutcomeIcon = ({ outcome, executionError }: { outcome: ComplianceOutcome; executionError?: boolean }) => {
  const style = outcomeIconStyle[outcome];
  const label = executionError && outcome !== "blocked" ? `${style.label}: guardrail execution error` : style.label;
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 22 22"
      fill="none"
      className={`rounded-full ${style.color}`}
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      <circle cx="11" cy="11" r="10" stroke="currentColor" strokeWidth="1.5" />
      <path d={style.path} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

const PlayCircleIcon = () => (
  <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
    <circle cx="11" cy="11" r="10" stroke="#3B82F6" strokeWidth="1.5" fill="#EFF6FF" />
    <path d="M9 7.5l6 3.5-6 3.5V7.5z" fill="#3B82F6" />
  </svg>
);

const GrayDotIcon = () => (
  <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
    <circle cx="11" cy="11" r="5" fill="#9CA3AF" />
  </svg>
);

const ChevronIcon = ({ expanded }: { expanded: boolean }) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    className={`transition-transform ${expanded ? "rotate-180" : ""}`}
  >
    <path d="M6 8l4 4 4-4" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const DownloadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path
      d="M8 2v8m0 0l-3-3m3 3l3-3M3 12h10"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const MatchDetailsTable = ({ matchDetails }: { matchDetails: MatchDetail[] }) => {
  if (!matchDetails || matchDetails.length === 0) return null;

  return (
    <div className="mt-3">
      <h5 className="text-sm font-medium mb-2 text-foreground">Match Details ({matchDetails.length})</h5>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="pb-2 pr-4 font-medium">Type</th>
              <th className="pb-2 pr-4 font-medium">Method</th>
              <th className="pb-2 pr-4 font-medium">Action</th>
              <th className="pb-2 font-medium">Detail</th>
            </tr>
          </thead>
          <tbody>
            {matchDetails.map((match, idx) => (
              <tr key={idx} className="border-b border-border">
                <td className="py-2 pr-4">{match.type}</td>
                <td className="py-2 pr-4">
                  <span className="px-2 py-0.5 bg-muted text-foreground rounded-sm text-xs">
                    {match.detection_method ?? "-"}
                  </span>
                </td>
                <td className="py-2 pr-4">
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium ${
                      match.action_taken === "BLOCK" ? "bg-destructive/15 text-destructive" : "bg-info/10 text-info"
                    }`}
                  >
                    {match.action_taken ?? "-"}
                  </span>
                </td>
                <td className="py-2 font-mono text-xs text-muted-foreground break-all">
                  {match.category ? `[${match.category}] ` : ""}
                  {match.snippet ?? "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const GenericGuardrailResponse = ({ response }: { response: any }) => {
  const [showRaw, setShowRaw] = useState(false);
  return (
    <div className="mt-3">
      <div className="border rounded-lg overflow-hidden">
        <div
          className="flex items-center justify-between p-3 bg-muted cursor-pointer hover:bg-accent"
          onClick={() => setShowRaw(!showRaw)}
        >
          <div className="flex items-center">
            <ChevronIcon expanded={showRaw} />
            <h5 className="font-medium text-sm ml-1">Raw Guardrail Response</h5>
          </div>
        </div>
        {showRaw && (
          <div className="p-3 border-t bg-card">
            <pre className="bg-muted rounded-sm p-3 text-xs overflow-x-auto">{JSON.stringify(response, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  );
};

interface TimelineEntry {
  type: "request" | "guardrail" | "analysis" | "llm" | "response";
  label: string;
  offsetMs?: number;
  status?: string;
  duration?: string;
  executionError?: boolean;
  outcome?: ComplianceOutcome;
}

const RequestLifecycle = ({
  entries,
  logEntry,
}: {
  entries: GuardrailInformation[];
  logEntry?: GuardrailViewerProps["logEntry"];
}) => {
  const timeline = useMemo<TimelineEntry[]>(() => {
    if (entries.length === 0) return [];
    const sorted = [...entries].sort((a, b) => a.end_time - b.end_time);
    const requestStart = Date.parse(logEntry?.startTime ?? "") / 1000;
    const requestEnd = Date.parse(logEntry?.endTime ?? "") / 1000;
    const hasRequestStart = Number.isFinite(requestStart);
    const validIntervals = entries.flatMap((entry) => [entry, entry.shared_analysis]).filter(isValidInterval);
    const baseTime = hasRequestStart ? requestStart : Math.min(...validIntervals.map((entry) => entry.start_time));
    const responseFloor = Math.max(
      baseTime,
      ...sorted
        .filter((entry) => !isLoggingOnlyEntry(entry))
        .filter(isValidInterval)
        .map((entry) => entry.end_time),
    );
    const offset = (time: number) =>
      Number.isFinite(time) && time >= baseTime ? Math.round((time - baseTime) * 1000) : undefined;
    const guardrailItems = (stage: string, label: string): TimelineEntry[] => {
      const stageEntries = sorted.filter((entry) => modeMatches(entry.guardrail_event ?? entry.guardrail_mode, stage));
      const shared = new Map<string, TimelineEntry>();
      const checks: TimelineEntry[] = stageEntries.map((entry) => {
        const outcome = getComplianceOutcome(entry);
        const interval = entry.shared_analysis;
        if (isValidInterval(interval)) {
          const key = JSON.stringify([
            entry.guardrail_run_id,
            entry.guardrail_name,
            interval.start_time,
            interval.end_time,
          ]);
          const analysisItem: TimelineEntry = {
            type: "analysis",
            label: `Shared analysis: ${getDisplayName(entry)}`,
            offsetMs: offset(interval.end_time),
            duration: formatDurationMs(interval.end_time - interval.start_time),
          };
          shared.set(key, analysisItem);
        }
        return {
          type: "guardrail",
          label: `${label}: ${getDisplayName(entry)}`,
          offsetMs: isValidInterval(entry) ? offset(entry.end_time) : undefined,
          status: outcome.toUpperCase(),
          outcome,
          executionError: hasExecutionError(entry),
        };
      });
      return [...shared.values(), ...checks].sort(
        (left, right) => (left.offsetMs ?? Infinity) - (right.offsetMs ?? Infinity),
      );
    };
    return [
      { type: "request", label: "Request received", offsetMs: hasRequestStart ? 0 : undefined },
      ...guardrailItems("pre_call", "Pre-call guardrail"),
      { type: "llm", label: "LLM call" },
      ...guardrailItems("during_call", "During-call guardrail"),
      ...guardrailItems("post_call", "Post-call guardrail"),
      {
        type: "response",
        label: "Response returned",
        offsetMs: requestEnd >= responseFloor ? offset(requestEnd) : undefined,
      },
      ...guardrailItems("logging_only", "Logging-only audit"),
    ] satisfies TimelineEntry[];
  }, [entries, logEntry?.startTime, logEntry?.endTime]);

  return (
    <div>
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Request Lifecycle</h4>
      <div className="relative">
        {timeline.map((item, idx) => (
          <div key={idx} className="flex items-start gap-3 relative">
            <div className="flex flex-col items-center">
              <div className="shrink-0">
                {item.type === "request" || item.type === "response" || item.type === "analysis" ? (
                  <GrayDotIcon />
                ) : item.type === "llm" ? (
                  <PlayCircleIcon />
                ) : item.outcome ? (
                  <OutcomeIcon outcome={item.outcome} executionError={item.executionError} />
                ) : null}
              </div>
              {idx < timeline.length - 1 && <div className="w-0.5 bg-border grow" style={{ minHeight: "24px" }} />}
            </div>
            <div className="pb-4 flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-sm ${item.type === "llm" ? "text-info font-medium" : "text-foreground"}`}>
                  {item.label}
                </span>
                {item.duration && <span className="text-xs text-muted-foreground">{item.duration}</span>}
                {item.status && (
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                      item.outcome ? complianceBadgeClass[item.outcome] : ""
                    }`}
                  >
                    {item.status}
                  </span>
                )}
                {item.offsetMs != null && (
                  <span className="text-xs text-muted-foreground font-mono ml-auto shrink-0">T+{item.offsetMs}ms</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const EvaluationCard = ({ entry }: { entry: GuardrailInformation }) => {
  const [expanded, setExpanded] = useState(false);
  const success = isEntrySuccess(entry);
  const totalMasked = getTotalMasked(entry);
  const displayName = getDisplayName(entry);
  const durationStr = formatDurationMs(entry.duration);
  const modeStr = formatMode(entry.guardrail_event ?? entry.guardrail_mode);
  const riskScore = getRiskScore(entry);
  const complianceOutcome = getComplianceOutcome(entry);
  const inputSourceLabel = getInputSourceLabel(entry.input_source);
  const textRecords = entry.guardrail_usage?.["text_records"];

  const guardrailProvider = entry.guardrail_provider ?? "presidio";
  const guardrailResponse = entry.guardrail_response;
  const presidioEntities = Array.isArray(guardrailResponse) ? guardrailResponse : [];
  const bedrockResponse =
    guardrailProvider === "bedrock" &&
    guardrailResponse !== null &&
    typeof guardrailResponse === "object" &&
    !Array.isArray(guardrailResponse)
      ? (guardrailResponse as BedrockGuardrailResponse)
      : undefined;

  // Match count string: "X/Y matched" or "X matched"
  const matchCountStr =
    entry.patterns_checked != null
      ? `${totalMasked}/${entry.patterns_checked} matched`
      : totalMasked > 0
        ? `${totalMasked} matched`
        : null;

  return (
    <div className="border border-border rounded-lg bg-card">
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-accent transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="shrink-0">
          <OutcomeIcon outcome={complianceOutcome} executionError={hasExecutionError(entry)} />
        </div>
        <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
          <span className="font-semibold text-foreground text-sm truncate">{displayName}</span>

          <span className="px-2 py-0.5 border border-info/20 bg-info/10 text-info rounded-sm text-[11px] font-semibold uppercase shrink-0">
            {modeStr}
          </span>

          <span
            className={`px-2 py-0.5 rounded text-[11px] font-semibold uppercase shrink-0 ${complianceBadgeClass[complianceOutcome]}`}
          >
            {complianceOutcome.toUpperCase()}
          </span>

          {matchCountStr && (
            <span
              className={`px-2 py-0.5 rounded text-[11px] font-medium shrink-0 ${
                totalMasked === 0
                  ? "bg-success/10 text-success border border-success/20"
                  : "bg-warning/10 text-warning border border-warning/20"
              }`}
            >
              {matchCountStr}
            </span>
          )}

          {entry.confidence_score != null && (
            <span className="px-2 py-0.5 bg-muted text-muted-foreground border border-border rounded-sm text-[11px] font-medium shrink-0">
              {(entry.confidence_score * 100).toFixed(0)}% conf
            </span>
          )}

          {riskScore != null && success && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span
                      className={`px-2 py-0.5 border rounded-sm text-[11px] font-semibold shrink-0 ${getRiskColor(riskScore)}`}
                    />
                  }
                >
                  Risk {riskScore}/10
                </TooltipTrigger>
                <TooltipContent>{`Risk score: ${riskScore}/10`}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          <GuardrailUsageBadges
            analysisCache={entry.analysis_cache}
            textRecords={textRecords}
            cost={entry.guardrail_cost}
            includedInSpend={entry.guardrail_cost_in_spend}
          />
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-sm text-muted-foreground font-mono">
            {isValidInterval(entry.shared_analysis) ? `Individual check: ${durationStr}` : durationStr}
          </span>
          {entry.detection_method && (
            <span className="px-2 py-0.5 bg-muted text-muted-foreground border border-border rounded-sm text-[11px] font-medium">
              {entry.detection_method.split(",")[0].trim()}
            </span>
          )}
          {inputSourceLabel && (
            <span className="px-2 py-0.5 bg-muted text-muted-foreground border border-border rounded-sm text-[11px] font-medium">
              {inputSourceLabel}
            </span>
          )}
          <ChevronIcon expanded={expanded} />
        </div>
      </div>
      {expanded && (
        <div className="border-t border-border px-4 py-3">
          {entry.classification && (
            <div className="mb-3 bg-muted rounded-lg p-3 space-y-1">
              <h5 className="text-sm font-medium text-foreground mb-2">Classification</h5>
              {entry.classification.category && (
                <div className="flex text-sm">
                  <span className="font-medium w-1/3 text-muted-foreground">Category:</span>
                  <span>{entry.classification.category}</span>
                </div>
              )}
              {entry.classification.article_reference && (
                <div className="flex text-sm">
                  <span className="font-medium w-1/3 text-muted-foreground">Reference:</span>
                  <span className="font-mono">{entry.classification.article_reference}</span>
                </div>
              )}
              {entry.classification.confidence != null && (
                <div className="flex text-sm">
                  <span className="font-medium w-1/3 text-muted-foreground">Confidence:</span>
                  <span>{(entry.classification.confidence * 100).toFixed(0)}%</span>
                </div>
              )}
              {entry.classification.reason && (
                <div className="flex text-sm">
                  <span className="font-medium w-1/3 text-muted-foreground">Reason:</span>
                  <span>{entry.classification.reason}</span>
                </div>
              )}
            </div>
          )}

          {(entry.guardrail_run_id || inputSourceLabel) && (
            <div className="mb-3 bg-muted rounded-lg p-3 space-y-1">
              {entry.guardrail_run_id && (
                <div className="flex text-sm">
                  <span className="font-medium w-1/3 text-muted-foreground">Run ID:</span>
                  <span className="font-mono break-all">{entry.guardrail_run_id}</span>
                </div>
              )}
              {inputSourceLabel && (
                <div className="flex text-sm">
                  <span className="font-medium w-1/3 text-muted-foreground">Input Source:</span>
                  <span>{inputSourceLabel}</span>
                </div>
              )}
              {entry.input_source?.path && (
                <div className="flex text-sm">
                  <span className="font-medium w-1/3 text-muted-foreground">Path:</span>
                  <span className="font-mono break-all">{entry.input_source.path}</span>
                </div>
              )}
            </div>
          )}
          {entry.match_details && entry.match_details.length > 0 && (
            <MatchDetailsTable matchDetails={entry.match_details} />
          )}
          {totalMasked > 0 && (
            <div className="mt-3">
              <h5 className="text-sm font-medium text-foreground mb-2">Masked Entities</h5>
              <div className="flex flex-wrap gap-2">
                {Object.entries(entry.masked_entity_count || {}).map(([entityType, count]) => (
                  <span key={entityType} className="px-2 py-1 bg-info/10 text-info rounded-sm text-xs font-medium">
                    {entityType}: {count}
                  </span>
                ))}
              </div>
            </div>
          )}
          {guardrailProvider === "presidio" && presidioEntities.length > 0 && (
            <div className="mt-3">
              <PresidioDetectedEntities entities={presidioEntities} />
            </div>
          )}
          {guardrailProvider === "bedrock" && bedrockResponse && (
            <div className="mt-3">
              <BedrockGuardrailDetails response={bedrockResponse} />
            </div>
          )}
          {guardrailProvider === "litellm_content_filter" && guardrailResponse && (
            <div className="mt-3">
              <ContentFilterDetails response={guardrailResponse} />
            </div>
          )}
          {guardrailProvider && !PROVIDERS_WITH_CUSTOM_RENDERERS.has(guardrailProvider) && guardrailResponse && (
            <GenericGuardrailResponse response={guardrailResponse} />
          )}
        </div>
      )}
    </div>
  );
};

const GuardrailViewer = ({ data, accessToken, logEntry }: GuardrailViewerProps) => {
  const guardrailEntries = useMemo(() => {
    return Array.isArray(data)
      ? data.filter((entry): entry is GuardrailInformation => Boolean(entry))
      : data
        ? [data]
        : [];
  }, [data]);

  const outcomesByRun = useMemo(() => {
    const outcomes = new Map<string, ComplianceOutcome>();
    guardrailEntries.forEach((entry, index) => {
      const runKey = entry.guardrail_run_id || `entry-${index}`;
      const outcome = getComplianceOutcome(entry);
      const previous = outcomes.get(runKey);
      if (!previous || OUTCOME_PRECEDENCE[outcome] > OUTCOME_PRECEDENCE[previous]) {
        outcomes.set(runKey, outcome);
      }
    });
    return outcomes;
  }, [guardrailEntries]);
  const inputSourceCount = useMemo(() => {
    const sources = new Set<string>();
    guardrailEntries.forEach((entry, index) => {
      if (!entry.input_source) return;
      const source = entry.input_source;
      sources.add(
        source.path ||
          JSON.stringify([source.scope, source.type, source.message_index, source.role, source.content_index]) ||
          `entry-${index}`,
      );
    });
    return sources.size;
  }, [guardrailEntries]);
  const outcomeCounts = Array.from(outcomesByRun.values()).reduce<Record<ComplianceOutcome, number>>(
    (counts, outcome) => {
      counts[outcome] += 1;
      return counts;
    },
    { passed: 0, flagged: 0, blocked: 0, observed: 0 },
  );
  const evaluatedCount = outcomesByRun.size;
  const allPassed = outcomeCounts.passed === evaluatedCount;

  const totalOverhead = useMemo(() => getMeasuredOverhead(guardrailEntries), [guardrailEntries]);

  if (guardrailEntries.length === 0) {
    return null;
  }

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(guardrailEntries, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `guardrail-compliance-log-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-card rounded-xl border border-border shadow-xs w-full max-w-full overflow-hidden mb-6">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-4">
          <ShieldIcon />
          <div>
            <h3 className="text-lg font-semibold text-foreground">Guardrails &amp; Policy Compliance</h3>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-sm text-muted-foreground">
                {evaluatedCount} guardrail{evaluatedCount !== 1 ? "s" : ""} evaluated
              </span>
              {inputSourceCount > 0 && (
                <>
                  <span className="text-muted-foreground">|</span>
                  <span className="text-sm text-muted-foreground">
                    {inputSourceCount} input{inputSourceCount !== 1 ? "s" : ""} scanned
                  </span>
                </>
              )}
              <span className="text-muted-foreground">|</span>
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                  allPassed
                    ? "bg-success/10 text-success border border-success/20"
                    : "bg-destructive/10 text-destructive border border-destructive/20"
                }`}
              >
                {allPassed ? (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path
                      d="M3 6l2.5 2.5L9 4"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : null}
                {outcomeCounts.passed} Passed
              </span>
              {(["flagged", "blocked", "observed"] as const).map((outcome) =>
                outcomeCounts[outcome] > 0 ? (
                  <span
                    key={outcome}
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${complianceBadgeClass[outcome]}`}
                  >
                    {outcomeCounts[outcome]} {outcome.charAt(0).toUpperCase() + outcome.slice(1)}
                  </span>
                ) : null,
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-sm font-medium text-foreground">
              {totalOverhead == null
                ? "Measured guardrail time unavailable"
                : `Measured guardrail time: ${formatDurationMs(totalOverhead)}`}
            </div>
          </div>

          <button
            onClick={handleExport}
            className="inline-flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium text-foreground bg-card hover:bg-accent transition-colors"
          >
            <DownloadIcon />
            Export Compliance Log
          </button>
        </div>
      </div>
      {accessToken && logEntry && (
        <div className="px-6 py-4 border-b border-border">
          <CompliancePanel accessToken={accessToken} logEntry={logEntry} />
        </div>
      )}
      <div className="flex flex-col">
        <div className="border-b border-border px-6 py-5">
          <RequestLifecycle entries={guardrailEntries} logEntry={logEntry} />
        </div>
        <div className="px-6 py-5">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">
            Evaluation Details
          </h4>
          <div className="space-y-3">
            {guardrailEntries.map((entry, index) => (
              <EvaluationCard key={`${entry.guardrail_name ?? "guardrail"}-${index}`} entry={entry} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default GuardrailViewer;
