import useTeams from "@/app/(dashboard)/hooks/useTeams";
import { BarChart, DonutChart } from "@/components/shared/charts";
import { MoneyCell } from "@/components/shared/table_cells";
import { Card as ShadcnCard, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumberWithCommas } from "@/utils/dataUtils";
import {
  Card,
  Col,
  DateRangePickerValue,
  Grid,
  Subtitle,
  Tab,
  TabGroup,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TabList,
  TabPanel,
  TabPanels,
  Text,
  Title,
} from "@tremor/react";
import { ExportOutlined, LoadingOutlined } from "@ant-design/icons";
import { Alert, Button, Select } from "antd";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityMetrics, processActivityData } from "@/components/activity_metrics";
import { UsageExportHeader } from "@/components/EntityUsageExport";
import type { EntityType } from "@/components/EntityUsageExport/types";
import {
  agentDailyActivityCall,
  customerDailyActivityCall,
  organizationDailyActivityCall,
  tagDailyActivityCall,
  teamDailyActivityCall,
  userDailyActivityCall,
} from "@/components/networking";
import { getProviderLogoAndName } from "@/components/provider_info_helpers";
import { usePaginatedDailyActivity } from "../../hooks/usePaginatedDailyActivity";
import {
  BreakdownMetrics,
  DailyData,
  EntityMetricWithMetadata,
  KeyMetricWithMetadata,
  TagUsage,
} from "@/components/UsagePage/types";
import { valueFormatterSpend } from "@/components/UsagePage/utils/value_formatters";
import EndpointUsage from "../EndpointUsage/EndpointUsage";
import TopKeyView from "@/components/UsagePage/components/EntityUsage/TopKeyView";
import TopModelView from "./TopModelView";
import { all_admin_roles } from "@/utils/roles";

interface EntityMetrics {
  metrics: {
    spend: number;
    prompt_tokens: number;
    completion_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
    total_tokens: number;
    successful_requests: number;
    failed_requests: number;
    api_requests: number;
  };
  metadata: Record<string, any>;
}

type ExtendedDailyData = DailyData & {
  breakdown: BreakdownMetrics;
};

interface EntitySpendData {
  results: ExtendedDailyData[];
  metadata: {
    total_spend: number;
    total_api_requests: number;
    total_successful_requests: number;
    total_failed_requests: number;
    total_tokens: number;
  };
}

export interface EntityList {
  label: string;
  value: string;
}

interface EntityUsageProps {
  accessToken: string | null;
  entityType: EntityType;
  entityId?: string | null;
  userID: string | null;
  userRole: string | null;
  entityList: EntityList[] | null;
  premiumUser: boolean;
  dateValue: DateRangePickerValue;
}

const ENTITY_FETCH_FNS: Record<EntityType, (...args: any[]) => Promise<any>> = {
  tag: tagDailyActivityCall,
  team: teamDailyActivityCall,
  organization: organizationDailyActivityCall,
  customer: customerDailyActivityCall,
  agent: agentDailyActivityCall,
  user: userDailyActivityCall,
};

const EntityUsage: React.FC<EntityUsageProps> = ({
  accessToken,
  entityType,
  entityId,
  entityList,
  dateValue,
  userRole,
}) => {
  const { t } = useTranslation();
  const { teams } = useTeams();
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [topKeysLimit, setTopKeysLimit] = useState<number>(5);
  const [topModelsLimit, setTopModelsLimit] = useState<number>(5);
  const [topAgentsLimit, setTopAgentsLimit] = useState<number>(5);

  const startTime = useMemo(() => (dateValue.from ? new Date(dateValue.from) : null), [dateValue.from]);
  const endTime = useMemo(() => (dateValue.to ? new Date(dateValue.to) : null), [dateValue.to]);

  const entityFilterArg = useMemo(() => {
    if (entityType === "user") return selectedTags.length > 0 ? selectedTags[0] : null;
    return selectedTags.length > 0 ? selectedTags : null;
  }, [entityType, selectedTags]);

  const fetchFn = ENTITY_FETCH_FNS[entityType];
  const enabled = !!accessToken && !!startTime && !!endTime && (entityType !== "team" || selectedTags.length > 0);
  const isAdmin = all_admin_roles.includes(userRole || "");

  const {
    data: spendDataRaw,
    isFetchingMore,
    progress,
    cancelled,
    cancel,
    error,
    retry,
  } = usePaginatedDailyActivity({
    fetchFn,
    args: [accessToken, startTime, endTime, entityFilterArg],
    enabled,
  });

  const spendData = spendDataRaw as unknown as EntitySpendData;

  const {
    data: agentSpendDataRaw,
    isFetchingMore: agentIsFetchingMore,
    progress: agentProgress,
    cancelled: agentCancelled,
    cancel: agentCancel,
    error: agentError,
    retry: agentRetry,
  } = usePaginatedDailyActivity({
    fetchFn: agentDailyActivityCall,
    args: [accessToken, startTime, endTime, null],
    enabled: enabled && entityType === "team" && isAdmin,
  });

  const agentSpendData = agentSpendDataRaw as unknown as EntitySpendData;

  const modelMetrics = processActivityData(spendData, "models", teams || []);
  const keyMetrics = processActivityData(spendData, "api_keys", teams || []);
  const agentMetrics = entityType === "team" ? processActivityData(agentSpendData, "entities", teams || []) : {};

  const getTopModels = () => {
    const modelSpend: { [key: string]: any } = {};
    spendData.results.forEach((day) => {
      Object.entries(day.breakdown.models || {}).forEach(([model, metrics]) => {
        if (!modelSpend[model]) {
          modelSpend[model] = {
            spend: 0,
            requests: 0,
            successful_requests: 0,
            failed_requests: 0,
            tokens: 0,
          };
        }
        try {
          modelSpend[model].spend += metrics.metrics.spend;
        } catch (e) {
          console.error(`Error adding spend for ${model}: ${e}, got metrics: ${JSON.stringify(metrics)}`);
        }
        modelSpend[model].requests += metrics.metrics.api_requests;
        modelSpend[model].successful_requests += metrics.metrics.successful_requests;
        modelSpend[model].failed_requests += metrics.metrics.failed_requests;
        modelSpend[model].tokens += metrics.metrics.total_tokens;
      });
    });

    return Object.entries(modelSpend)
      .map(([model, metrics]) => ({
        key: model,
        ...metrics,
      }))
      .sort((a, b) => b.spend - a.spend)
      .slice(0, topModelsLimit);
  };

  const getTopAgents = () => {
    const agentSpend: { [key: string]: any } = {};
    agentSpendData.results.forEach((day) => {
      Object.entries(day.breakdown.entities || {}).forEach(([agentId, data]) => {
        if (!agentSpend[agentId]) {
          agentSpend[agentId] = {
            spend: 0,
            requests: 0,
            successful_requests: 0,
            failed_requests: 0,
            tokens: 0,
            agent_name: (data.metadata as any)?.agent_name || agentId,
          };
        }
        agentSpend[agentId].spend += data.metrics.spend;
        agentSpend[agentId].requests += data.metrics.api_requests;
        agentSpend[agentId].successful_requests += data.metrics.successful_requests;
        agentSpend[agentId].failed_requests += data.metrics.failed_requests;
        agentSpend[agentId].tokens += data.metrics.total_tokens;
      });
    });

    return Object.entries(agentSpend)
      .map(([agentId, metrics]) => ({
        key: metrics.agent_name,
        ...metrics,
      }))
      .sort((a, b) => b.spend - a.spend)
      .slice(0, topAgentsLimit);
  };

  const getTopAPIKeys = () => {
    const keySpend: { [key: string]: KeyMetricWithMetadata } = {};
    spendData.results.forEach((day) => {
      const { breakdown } = day;
      const { entities } = breakdown;
      const tagDictionary = Object.keys(entities).reduce((acc: { [key: string]: TagUsage[] }, entity) => {
        const { api_key_breakdown } = entities[entity];
        Object.keys(api_key_breakdown).forEach((key) => {
          const tagUsage = { tag: entity, usage: api_key_breakdown[key].metrics.spend };
          if (acc[key]) {
            acc[key].push(tagUsage);
          } else {
            acc[key] = [tagUsage];
          }
        });
        return acc;
      }, {});
      Object.entries(day.breakdown.api_keys || {}).forEach(([key, metrics]) => {
        if (!keySpend[key]) {
          keySpend[key] = {
            metrics: {
              spend: 0,
              prompt_tokens: 0,
              completion_tokens: 0,
              total_tokens: 0,
              api_requests: 0,
              successful_requests: 0,
              failed_requests: 0,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
            metadata: {
              key_alias: metrics.metadata.key_alias,
              team_id: metrics.metadata.team_id || null,
              tags: tagDictionary[key] || [],
            },
          };
        }
        keySpend[key].metrics.spend += metrics.metrics.spend;
        keySpend[key].metrics.prompt_tokens += metrics.metrics.prompt_tokens;
        keySpend[key].metrics.completion_tokens += metrics.metrics.completion_tokens;
        keySpend[key].metrics.total_tokens += metrics.metrics.total_tokens;
        keySpend[key].metrics.api_requests += metrics.metrics.api_requests;
        keySpend[key].metrics.successful_requests += metrics.metrics.successful_requests;
        keySpend[key].metrics.failed_requests += metrics.metrics.failed_requests;
        keySpend[key].metrics.cache_read_input_tokens += metrics.metrics.cache_read_input_tokens || 0;
        keySpend[key].metrics.cache_creation_input_tokens += metrics.metrics.cache_creation_input_tokens || 0;
      });
    });

    return Object.entries(keySpend)
      .map(([api_key, metrics]) => ({
        api_key,
        key_alias: metrics.metadata.key_alias || "-", // Using truncated key as alias
        tags: metrics.metadata.tags || "-",
        spend: metrics.metrics.spend,
      }))
      .sort((a, b) => b.spend - a.spend)
      .slice(0, topKeysLimit);
  };

  const getProviderSpend = () => {
    const providerSpend: { [key: string]: any } = {};
    spendData.results.forEach((day) => {
      Object.entries(day.breakdown.providers || {}).forEach(([provider, metrics]) => {
        if (!providerSpend[provider]) {
          providerSpend[provider] = {
            provider,
            spend: 0,
            requests: 0,
            successful_requests: 0,
            failed_requests: 0,
            tokens: 0,
          };
        }
        try {
          providerSpend[provider].spend += metrics.metrics.spend;
          providerSpend[provider].requests += metrics.metrics.api_requests;
          providerSpend[provider].successful_requests += metrics.metrics.successful_requests;
          providerSpend[provider].failed_requests += metrics.metrics.failed_requests;
          providerSpend[provider].tokens += metrics.metrics.total_tokens;
        } catch (e) {
          console.error(`Error processing provider ${provider}: ${e}`);
        }
      });
    });

    return Object.values(providerSpend)
      .filter((provider) => provider.spend > 0)
      .sort((a, b) => b.spend - a.spend);
  };

  const getAllTags = () => {
    if (entityList) {
      return entityList;
    }
  };

  const getEntityLabel = (entity: string, metadata?: Record<string, any>): string => {
    if (entityList) {
      const entityItem = entityList.find((item) => item.value === entity);
      if (entityItem) {
        return entityItem.label;
      }
    }
    // Fallback to team_alias for backward compatibility
    if (metadata?.team_alias) {
      return metadata.team_alias;
    }
    // Resolve user_id to email/alias so the Spend Per User chart never shows a raw UUID
    // when an email is on file (the entityList is paginated and may miss spenders)
    if (metadata?.user_email) {
      return metadata.user_email;
    }
    if (metadata?.user_alias) {
      return metadata.user_alias;
    }
    return entity;
  };

  const filterDataByTags = (data: EntityMetricWithMetadata[]) => {
    if (selectedTags.length === 0) return data;
    return data.filter((item) => selectedTags.includes(item.metadata.id));
  };

  const getEntityBreakdown = () => {
    const entitySpend: { [key: string]: EntityMetricWithMetadata } = {};
    spendData.results.forEach((day) => {
      Object.entries(day.breakdown.entities || {}).forEach(([entity, data]) => {
        if (!entitySpend[entity]) {
          entitySpend[entity] = {
            metrics: {
              spend: 0,
              prompt_tokens: 0,
              completion_tokens: 0,
              total_tokens: 0,
              api_requests: 0,
              successful_requests: 0,
              failed_requests: 0,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
            metadata: {
              alias: getEntityLabel(entity, data.metadata as any),
              id: entity,
            },
          };
        }
        entitySpend[entity].metrics.spend += data.metrics.spend;
        entitySpend[entity].metrics.api_requests += data.metrics.api_requests;
        entitySpend[entity].metrics.successful_requests += data.metrics.successful_requests;
        entitySpend[entity].metrics.failed_requests += data.metrics.failed_requests;
        entitySpend[entity].metrics.total_tokens += data.metrics.total_tokens;
      });
    });

    const result = Object.values(entitySpend).sort((a, b) => b.metrics.spend - a.metrics.spend);

    return filterDataByTags(result);
  };

  const getProcessedEntityBreakdownForChart = () => {
    const data = getEntityBreakdown();
    const topEntities = data.slice(0, 5);
    return topEntities.map((e) => ({
      ...e,
      metadata: {
        ...e.metadata,
        alias_display:
          e.metadata.alias && e.metadata.alias.length > 15 ? `${e.metadata.alias.slice(0, 15)}...` : e.metadata.alias,
      },
    }));
  };

  const getFilterLabel = (entityType: string) => t("observability.usage.filter_by_entity", { entityType });

  const getFilterPlaceholder = (entityType: string) => t("observability.usage.select_entity_to_filter", { entityType });

  const capitalizedEntityLabel = t(`observability.usage.entity.${entityType}`);

  return (
    <div style={{ width: "100%" }} className="relative">
      {isFetchingMore && (
        <Alert
          banner
          type="warning"
          className="mb-2"
          message={
            <div className="flex items-center justify-between">
              <span>
                <LoadingOutlined spin className="mr-2" />
                {t("observability.usage.fetching_spend_data", {
                  current: progress.currentPage,
                  total: progress.totalPages,
                })}{" "}
                <a href={window.location.href} target="_blank" rel="noopener noreferrer">
                  {t("observability.usage.open_new_tab")} <ExportOutlined />
                </a>
                .
              </span>
              <Button type="primary" danger onClick={cancel}>
                {t("observability.usage.stop")}
              </Button>
            </div>
          }
        />
      )}
      {cancelled && (
        <Alert
          banner
          type="info"
          className="mb-2"
          message={
            <span>
              {t("observability.usage.showing_partial_data", {
                current: progress.currentPage,
                total: progress.totalPages,
              })}
            </span>
          }
        />
      )}
      {error && (
        <Alert
          banner
          type="error"
          className="mb-2"
          message={t("observability.usage.load_failed")}
          description={error.message}
          action={<Button onClick={retry}>{t("observability.usage.retry")}</Button>}
        />
      )}
      {agentIsFetchingMore && entityType === "team" && (
        <Alert
          banner
          type="warning"
          className="mb-2"
          message={
            <div className="flex items-center justify-between">
              <span>
                <LoadingOutlined spin className="mr-2" />
                {t("observability.usage.fetching_agent_data", {
                  current: agentProgress.currentPage,
                  total: agentProgress.totalPages,
                })}{" "}
                <a href={window.location.href} target="_blank" rel="noopener noreferrer">
                  {t("observability.usage.open_new_tab")} <ExportOutlined />
                </a>
                .
              </span>
              <Button type="primary" danger onClick={agentCancel}>
                {t("observability.usage.stop")}
              </Button>
            </div>
          }
        />
      )}
      {agentCancelled && entityType === "team" && (
        <Alert
          banner
          type="info"
          className="mb-2"
          message={
            <span>
              {t("observability.usage.showing_partial_agent_data", {
                current: agentProgress.currentPage,
                total: agentProgress.totalPages,
              })}
            </span>
          }
        />
      )}
      {agentError && entityType === "team" && isAdmin && (
        <Alert
          banner
          type="error"
          className="mb-2"
          message={t("observability.usage.agent_load_failed")}
          description={agentError.message}
          action={<Button onClick={agentRetry}>{t("observability.usage.retry")}</Button>}
        />
      )}
      {entityType === "team" && (
        <div className="mb-4">
          <Text className="mb-2">{t("observability.usage.filter_by_team")}</Text>
          <Select
            mode="multiple"
            value={selectedTags}
            onChange={setSelectedTags}
            options={entityList ?? []}
            placeholder={t("observability.usage.select_team")}
            className="w-full"
          />
          {selectedTags.length === 0 && (
            <Text className="mt-2 text-gray-500">{t("observability.usage.team_required")}</Text>
          )}
        </div>
      )}
      <UsageExportHeader
        dateValue={dateValue}
        entityType={entityType}
        spendData={spendData}
        showFilters={entityType !== "team" && entityList !== null && entityList.length > 0}
        filterLabel={getFilterLabel(entityType)}
        filterPlaceholder={getFilterPlaceholder(entityType)}
        selectedFilters={selectedTags}
        onFiltersChange={setSelectedTags}
        filterOptions={getAllTags() || undefined}
        filterMode={entityType === "user" ? "single" : "multiple"}
        teams={teams || []}
      />
      <TabGroup>
        <TabList variant="solid" className="mt-1">
          <Tab>{t("observability.usage.cost_tab")}</Tab>
          <Tab>
            {entityType === "agent"
              ? t("observability.usage.request_token_consumption_tab")
              : t("observability.usage.model_activity_tab")}
          </Tab>
          {entityType === "team" && isAdmin ? <Tab>{t("observability.usage.agent_activity_tab")}</Tab> : <></>}
          <Tab>{t("observability.usage.key_activity_tab")}</Tab>
          <Tab>{t("observability.usage.endpoint_activity_tab")}</Tab>
        </TabList>
        <TabPanels>
          <TabPanel>
            <Grid numItems={2} className="gap-2 w-full">
              {/* Total Spend Card */}
              <Col numColSpan={2}>
                <Card>
                  <Title>
                    {t("observability.usage.entity_spend_overview", { entityLabel: capitalizedEntityLabel })}
                  </Title>
                  <Grid numItems={5} className="gap-4 mt-4">
                    <Card>
                      <Title>{t("observability.usage.total_spend_label")}</Title>
                      <Text className="text-2xl font-bold mt-2">
                        ${formatNumberWithCommas(spendData.metadata.total_spend, 2)}
                      </Text>
                    </Card>
                    <Card>
                      <Title>{t("observability.usage.total_requests_label")}</Title>
                      <Text className="text-2xl font-bold mt-2">
                        {spendData.metadata.total_api_requests.toLocaleString()}
                      </Text>
                    </Card>
                    <Card>
                      <Title>{t("observability.usage.successful_requests_label")}</Title>
                      <Text className="text-2xl font-bold mt-2 text-green-600">
                        {spendData.metadata.total_successful_requests.toLocaleString()}
                      </Text>
                    </Card>
                    <Card>
                      <Title>{t("observability.usage.failed_requests_label")}</Title>
                      <Text className="text-2xl font-bold mt-2 text-red-600">
                        {spendData.metadata.total_failed_requests.toLocaleString()}
                      </Text>
                    </Card>
                    <Card>
                      <Title>{t("observability.usage.total_tokens_label")}</Title>
                      <Text className="text-2xl font-bold mt-2">
                        {spendData.metadata.total_tokens.toLocaleString()}
                      </Text>
                    </Card>
                  </Grid>
                </Card>
              </Col>

              {/* Daily Spend Chart */}
              <Col numColSpan={2}>
                <ShadcnCard>
                  <CardHeader>
                    <CardTitle className="text-base font-semibold">{t("observability.usage.daily_spend")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <BarChart
                      data={[...spendData.results].sort(
                        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
                      )}
                      index="date"
                      categories={["metrics.spend"]}
                      colors={["cyan"]}
                      valueFormatter={valueFormatterSpend}
                      yAxisWidth={100}
                      showLegend={false}
                      customTooltip={({ payload, active }) => {
                        if (!active || !payload?.[0]) return null;
                        const data = payload[0].payload;
                        const entityCount = Object.keys(data.breakdown.entities || {}).length;
                        return (
                          <div className="bg-white p-4 shadow-lg rounded-lg border">
                            <p className="font-bold">{data.date}</p>
                            <p className="text-cyan-500">
                              {t("observability.usage.daily_total_spend", {
                                amount: `$${formatNumberWithCommas(data.metrics.spend, 2)}`,
                              })}
                            </p>
                            <p className="text-gray-600">
                              {t("observability.usage.daily_total_requests", { count: data.metrics.api_requests })}
                            </p>
                            <p className="text-gray-600">
                              {t("observability.usage.daily_successful", { count: data.metrics.successful_requests })}
                            </p>
                            <p className="text-gray-600">
                              {t("observability.usage.daily_failed", { count: data.metrics.failed_requests })}
                            </p>
                            <p className="text-gray-600">
                              {t("observability.usage.daily_total_tokens", { count: data.metrics.total_tokens })}
                            </p>
                            <p className="text-gray-600">
                              {t("observability.usage.daily_total_entities", {
                                entityLabel: capitalizedEntityLabel,
                                count: entityCount,
                              })}
                            </p>
                            <div className="mt-2 border-t pt-2">
                              <p className="font-semibold">
                                {t("observability.usage.daily_spend_by_entity", {
                                  entityLabel: capitalizedEntityLabel,
                                })}
                              </p>
                              {Object.entries(data.breakdown.entities || {})
                                .sort(([, a], [, b]) => {
                                  const spendA = (a as EntityMetrics).metrics.spend;
                                  const spendB = (b as EntityMetrics).metrics.spend;
                                  return spendB - spendA;
                                })
                                .slice(0, 5)
                                .map(([entity, entityData]) => {
                                  const metrics = entityData as EntityMetrics;
                                  return (
                                    <p key={entity} className="text-sm text-gray-600">
                                      {getEntityLabel(entity, metrics.metadata)}: $
                                      {formatNumberWithCommas(metrics.metrics.spend, 2)}
                                    </p>
                                  );
                                })}
                              {entityCount > 5 && (
                                <p className="text-sm text-gray-500 italic">
                                  {t("observability.usage.daily_more_entities", { count: entityCount - 5 })}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      }}
                    />
                  </CardContent>
                </ShadcnCard>
              </Col>

              {/* Entity Breakdown Section */}
              <Col numColSpan={2}>
                <Card>
                  <div className="flex flex-col space-y-4">
                    <div className="flex flex-col space-y-2">
                      <Title>
                        {t("observability.usage.spend_per_entity", { entityLabel: capitalizedEntityLabel })}
                      </Title>
                      <Subtitle className="text-xs">
                        {t("observability.usage.showing_top_by_spend", { count: 5 })}
                      </Subtitle>
                      <div className="flex items-center text-sm text-gray-500">
                        <span>
                          {t("observability.usage.get_started_tracking_cost", { entityLabel: capitalizedEntityLabel })}{" "}
                        </span>
                        <a
                          href="https://docs.litellm.ai/docs/proxy/enterprise#spend-tracking"
                          className="text-blue-500 hover:text-blue-700 ml-1"
                        >
                          {t("observability.usage.here")}
                        </a>
                      </div>
                    </div>
                    <Grid numItems={2} className="gap-6">
                      <Col numColSpan={1}>
                        <BarChart
                          className="mt-4 h-52"
                          data={getProcessedEntityBreakdownForChart()}
                          index="metadata.alias_display"
                          categories={["metrics.spend"]}
                          colors={["cyan"]}
                          valueFormatter={valueFormatterSpend}
                          layout="vertical"
                          showLegend={false}
                          yAxisWidth={150}
                          customTooltip={({ payload, active }) => {
                            if (!active || !payload?.[0]) return null;
                            const data = payload[0].payload;
                            return (
                              <div className="bg-white p-4 shadow-lg rounded-lg border">
                                <p className="font-bold">{data.metadata.alias}</p>
                                <p className="text-cyan-500">
                                  {t("observability.top_keys.spend")} ${formatNumberWithCommas(data.metrics.spend, 4)}
                                </p>
                                <p className="text-gray-600">
                                  {t("observability.usage.requests_label")}:{" "}
                                  {data.metrics.api_requests.toLocaleString()}
                                </p>
                                <p className="text-green-600">
                                  {t("observability.usage.successful")}:{" "}
                                  {data.metrics.successful_requests.toLocaleString()}
                                </p>
                                <p className="text-red-600">
                                  {t("observability.usage.failed")}: {data.metrics.failed_requests.toLocaleString()}
                                </p>
                                <p className="text-gray-600">
                                  {t("observability.usage.tokens")}: {data.metrics.total_tokens.toLocaleString()}
                                </p>
                              </div>
                            );
                          }}
                        />
                      </Col>
                      <Col numColSpan={1}>
                        <div className="h-52 overflow-y-auto">
                          <Table>
                            <TableHead>
                              <TableRow>
                                <TableHeaderCell>{capitalizedEntityLabel}</TableHeaderCell>
                                <TableHeaderCell>{t("observability.usage.spend")}</TableHeaderCell>
                                <TableHeaderCell className="text-green-600">
                                  {t("observability.usage.successful")}
                                </TableHeaderCell>
                                <TableHeaderCell className="text-red-600">
                                  {t("observability.usage.failed")}
                                </TableHeaderCell>
                                <TableHeaderCell>{t("observability.usage.tokens")}</TableHeaderCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {getEntityBreakdown()
                                .filter((entity) => entity.metrics.spend > 0)
                                .map((entity) => (
                                  <TableRow key={entity.metadata.id}>
                                    <TableCell>{entity.metadata.alias}</TableCell>
                                    <TableCell>
                                      <MoneyCell value={entity.metrics.spend} decimals={4} />
                                    </TableCell>
                                    <TableCell className="text-green-600">
                                      {entity.metrics.successful_requests.toLocaleString()}
                                    </TableCell>
                                    <TableCell className="text-red-600">
                                      {entity.metrics.failed_requests.toLocaleString()}
                                    </TableCell>
                                    <TableCell>{entity.metrics.total_tokens.toLocaleString()}</TableCell>
                                  </TableRow>
                                ))}
                            </TableBody>
                          </Table>
                        </div>
                      </Col>
                    </Grid>
                  </div>
                </Card>
              </Col>

              {/* Top API Keys */}
              <Col numColSpan={1}>
                <Card>
                  <Title>{t("observability.usage.top_virtual_keys")}</Title>
                  <TopKeyView
                    topKeys={getTopAPIKeys()}
                    teams={null}
                    showTags={entityType === "tag"}
                    topKeysLimit={topKeysLimit}
                    setTopKeysLimit={setTopKeysLimit}
                  />
                </Card>
              </Col>

              {/* Top Models */}
              <Col numColSpan={1}>
                <Card>
                  <Title>
                    {entityType === "agent" ? t("observability.usage.top_agents") : t("observability.usage.top_models")}
                  </Title>
                  <TopModelView
                    topModels={getTopModels()}
                    topModelsLimit={topModelsLimit}
                    setTopModelsLimit={setTopModelsLimit}
                  />
                </Card>
              </Col>

              {/* Top Agents - only for team entity type */}
              {entityType === "team" && isAdmin && (
                <Col numColSpan={2}>
                  <Card>
                    <Title>{t("observability.usage.top_agents_driving_spend")}</Title>
                    <TopModelView
                      topModels={getTopAgents()}
                      topModelsLimit={topAgentsLimit}
                      setTopModelsLimit={setTopAgentsLimit}
                    />
                  </Card>
                </Col>
              )}

              {/* Spend by Provider */}
              <Col numColSpan={2}>
                <Card>
                  <div className="flex flex-col space-y-4">
                    <Title>{t("observability.usage.provider_usage")}</Title>
                    <Grid numItems={2}>
                      <Col numColSpan={1}>
                        <DonutChart
                          className="mt-4 h-40"
                          data={getProviderSpend()}
                          index="provider"
                          category="spend"
                          valueFormatter={(value) => `$${formatNumberWithCommas(value, 2)}`}
                          colors={["cyan", "blue", "indigo", "violet", "purple"]}
                          showLabel
                          startAngle={90}
                          endAngle={-270}
                        />
                      </Col>
                      <Col numColSpan={1}>
                        <Table>
                          <TableHead>
                            <TableRow>
                              <TableHeaderCell>{t("observability.usage.provider")}</TableHeaderCell>
                              <TableHeaderCell>{t("observability.usage.spend")}</TableHeaderCell>
                              <TableHeaderCell className="text-green-600">
                                {t("observability.usage.successful")}
                              </TableHeaderCell>
                              <TableHeaderCell className="text-red-600">
                                {t("observability.usage.failed")}
                              </TableHeaderCell>
                              <TableHeaderCell>{t("observability.usage.tokens")}</TableHeaderCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {getProviderSpend().map((provider) => (
                              <TableRow key={provider.provider}>
                                <TableCell>
                                  <div className="flex items-center space-x-2">
                                    {provider.provider && (
                                      <img
                                        src={getProviderLogoAndName(provider.provider).logo}
                                        alt={`${provider.provider} logo`}
                                        className="w-4 h-4"
                                        onError={(e) => {
                                          const target = e.target as HTMLImageElement;
                                          const parent = target.parentElement;
                                          if (parent) {
                                            const fallbackDiv = document.createElement("div");
                                            fallbackDiv.className =
                                              "w-4 h-4 rounded-full bg-gray-200 flex items-center justify-center text-xs";
                                            fallbackDiv.textContent = provider.provider?.charAt(0) || "-";
                                            parent.replaceChild(fallbackDiv, target);
                                          }
                                        }}
                                      />
                                    )}
                                    <span>{provider.provider}</span>
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <MoneyCell value={provider.spend} decimals={2} />
                                </TableCell>
                                <TableCell className="text-green-600">
                                  {provider.successful_requests.toLocaleString()}
                                </TableCell>
                                <TableCell className="text-red-600">
                                  {provider.failed_requests.toLocaleString()}
                                </TableCell>
                                <TableCell>{provider.tokens.toLocaleString()}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </Col>
                    </Grid>
                  </div>
                </Card>
              </Col>
            </Grid>
          </TabPanel>
          <TabPanel>
            <ActivityMetrics modelMetrics={modelMetrics} hidePromptCachingMetrics={entityType === "agent"} />
          </TabPanel>
          {entityType === "team" && isAdmin ? (
            <TabPanel>
              <ActivityMetrics modelMetrics={agentMetrics} />
            </TabPanel>
          ) : (
            <></>
          )}
          <TabPanel>
            <ActivityMetrics modelMetrics={keyMetrics} hidePromptCachingMetrics={entityType === "agent"} />
          </TabPanel>
          <TabPanel>
            <EndpointUsage userSpendData={spendData} />
          </TabPanel>
        </TabPanels>
      </TabGroup>
    </div>
  );
};

export default EntityUsage;
