"use client";

import { Code2 } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import CodeBlock from "@/components/CodeBlock";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { formatStrategyLabel } from "./strategy";
import type { RoutingGroup } from "./types";

const ROUTING_STRATEGY_LABEL_KEYS: Record<string, string> = {
  "simple-shuffle": "observabilityExtra.routingGroups.strategy.simpleShuffle",
  "least-busy": "observabilityExtra.routingGroups.strategy.leastBusy",
  "usage-based-routing": "observabilityExtra.routingGroups.strategy.usageBased",
  "latency-based-routing": "observabilityExtra.routingGroups.strategy.latencyBased",
};

interface RoutingGroupUsagePanelProps {
  group: RoutingGroup;
  baseUrl: string;
}

const exampleModel = (group: RoutingGroup): string => group.models[0] ?? "<your-model>";

const buildCurlSnippet = (group: RoutingGroup, baseUrl: string): string =>
  `curl -X POST '${baseUrl}/v1/chat/completions' \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer $LITELLM_API_KEY' \\
  -d '{
    "model": "${exampleModel(group)}",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`;

const buildPythonSnippet = (group: RoutingGroup, baseUrl: string): string =>
  `from openai import OpenAI

client = OpenAI(
    api_key="$LITELLM_API_KEY",
    base_url="${baseUrl}",
)

response = client.chat.completions.create(
    model="${exampleModel(group)}",
    messages=[{"role": "user", "content": "Hello!"}],
)

print(response)`;

const buildJsSnippet = (group: RoutingGroup, baseUrl: string): string =>
  `import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.LITELLM_API_KEY,
  baseURL: "${baseUrl}",
});

const response = await client.chat.completions.create({
  model: "${exampleModel(group)}",
  messages: [{ role: "user", content: "Hello!" }],
});

console.log(response);`;

export function RoutingGroupUsagePanel({ group, baseUrl }: RoutingGroupUsagePanelProps) {
  const { t } = useTranslation();
  const strategyLabel = ROUTING_STRATEGY_LABEL_KEYS[group.routing_strategy]
    ? t(ROUTING_STRATEGY_LABEL_KEYS[group.routing_strategy]!)
    : formatStrategyLabel(group.routing_strategy);
  const snippetTabs = [
    {
      value: "curl",
      label: t("observabilityExtra.routingGroups.tabs.curl"),
      language: "bash",
      build: buildCurlSnippet,
    },
    {
      value: "python",
      label: t("observabilityExtra.routingGroups.tabs.python"),
      language: "python",
      build: buildPythonSnippet,
    },
    {
      value: "javascript",
      label: t("observabilityExtra.routingGroups.tabs.javascript"),
      language: "javascript",
      build: buildJsSnippet,
    },
  ] as const;

  return (
    <div className="border-y bg-muted/40 px-4 py-4">
      <div className="mb-2 flex items-center gap-2">
        <Code2 className="size-4 text-primary" />
        <span className="text-sm font-medium text-foreground">
          {t("observabilityExtra.routingGroups.usage.howItWorks")}
        </span>
      </div>
      <p className="mb-3 text-sm text-muted-foreground">
        {t("observabilityExtra.routingGroups.usage.descriptionPrefix")}{" "}
        <span className="font-medium text-foreground">{strategyLabel}</span>{" "}
        {t("observabilityExtra.routingGroups.usage.descriptionSuffix")}
      </p>
      <Tabs defaultValue="curl">
        <TabsList variant="line" className="h-auto w-full justify-start rounded-none border-b p-0">
          {snippetTabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="flex-none rounded-none px-4 py-2">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {snippetTabs.map((tab) => (
          <TabsContent key={tab.value} value={tab.value} className="pt-3">
            <CodeBlock language={tab.language} code={tab.build(group, baseUrl)} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
