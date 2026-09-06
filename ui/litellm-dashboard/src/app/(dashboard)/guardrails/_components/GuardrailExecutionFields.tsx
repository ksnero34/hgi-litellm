import { MultiSelect } from "@/components/shared/MultiSelect";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  asStringArray,
  GuardrailField,
  labelWithHint,
  requiredRule,
  type GuardrailFormControl,
} from "./GuardrailFormField";

const DEFAULT_ON_ITEMS = [
  { label: "Yes", value: true },
  { label: "No", value: false },
];

const modeDescriptions: Record<string, string> = {
  pre_call: "Before LLM Call - Runs before the LLM call and checks the input",
  during_call: "During LLM Call - Runs in parallel with the LLM call, with response held until check completes",
  post_call: "After LLM Call - Runs after the LLM call and checks the output",
  logging_only: "Logging Only - Runs on logging callbacks without changing the request or response",
  pre_mcp_call: "Before MCP Tool Call - Runs before MCP tool execution and validates tool calls",
  during_mcp_call: "During MCP Tool Call - Runs in parallel with MCP tool execution for monitoring",
  post_mcp_call: "After MCP Tool Call - Runs after MCP tool execution and checks the tool result",
};

export function GuardrailExecutionFields({
  control,
  supportedModes,
}: {
  control: GuardrailFormControl;
  supportedModes: string[];
}) {
  return (
    <>
      <GuardrailField control={control} name="default_on" label="Default On">
        {({ id, value, onChange, "aria-invalid": ariaInvalid, "aria-describedby": describedBy }) => (
          <Select
            items={DEFAULT_ON_ITEMS}
            value={typeof value === "boolean" ? value : null}
            onValueChange={(next: boolean | null) => onChange(next)}
          >
            <SelectTrigger id={id} aria-invalid={ariaInvalid} aria-describedby={describedBy} className="w-full">
              <SelectValue placeholder="Select an option" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={true}>Yes</SelectItem>
              <SelectItem value={false}>No</SelectItem>
            </SelectContent>
          </Select>
        )}
      </GuardrailField>

      <GuardrailField
        control={control}
        name="mode"
        label={labelWithHint("Mode", "When the guardrail should run")}
        rules={requiredRule("Please select at least one mode")}
      >
        {({ id, value, onChange }) => (
          <MultiSelect
            id={id}
            options={supportedModes.map((mode) => ({
              label: mode,
              value: mode,
              description: modeDescriptions[mode],
            }))}
            value={asStringArray(value)}
            onValueChange={onChange}
            placeholder="Select modes"
          />
        )}
      </GuardrailField>
    </>
  );
}
