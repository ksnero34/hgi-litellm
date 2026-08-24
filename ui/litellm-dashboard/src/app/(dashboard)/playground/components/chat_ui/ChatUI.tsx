"use client";

import {
  Bot,
  Code2,
  Database,
  Eraser,
  Image as ImageIcon,
  Info,
  Key,
  Link2,
  Loader2,
  Settings,
  Shield,
  Tags,
  Trash2,
  Volume2,
  Wrench,
  X,
} from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { coy } from "react-syntax-highlighter/dist/esm/styles/prism";
import { v4 as uuidv4 } from "uuid";
import useCan from "@/app/(dashboard)/hooks/useCan";
import GuardrailSelector from "@/components/guardrails/GuardrailSelector";
import PolicySelector from "@/components/policies/PolicySelector";
import MCPToolArgumentsForm, { MCPToolArgumentsFormRef } from "@/components/mcp_tools/MCPToolArgumentsForm";
import { MCPServer } from "@/components/mcp_tools/types";
import { ByokCredentialModal } from "@/components/mcp_tools/ByokCredentialModal";
import NotificationsManager from "@/components/molecules/notifications_manager";
import { callMCPTool, fetchMCPServers, fetchMCPToolsets, listMCPTools } from "@/components/networking";
import { MCPTool, MCPToolset } from "@/components/mcp_tools/types";
import TagSelector from "@/components/tag_management/TagSelector";
import VectorStoreSelector from "@/components/vector_store_management/VectorStoreSelector";
import { makeA2ASendMessageRequest } from "../../llm_calls/a2a_send_message";
import { makeAnthropicMessagesRequest } from "../../llm_calls/anthropic_messages";
import { makeOpenAIAudioSpeechRequest } from "../../llm_calls/audio_speech";
import { makeOpenAIAudioTranscriptionRequest } from "../../llm_calls/audio_transcriptions";
import { makeOpenAIChatCompletionRequest } from "@/components/llm_calls/chat_completion";
import { makeOpenAIEmbeddingsRequest } from "../../llm_calls/embeddings_api";
import { Agent, fetchAvailableAgents } from "../../llm_calls/fetch_agents";
import { fetchAvailableModels, ModelGroup } from "@/components/llm_calls/fetch_models";
import { makeOpenAIImageEditsRequest } from "../../llm_calls/image_edits";
import { makeOpenAIImageGenerationRequest } from "../../llm_calls/image_generation";
import { makeOpenAIResponsesRequest } from "@/components/llm_calls/responses_api";
import { makeInteractionsRequest } from "../../llm_calls/interactions_api";
import AdditionalModelSettings from "./AdditionalModelSettings";
import { OPEN_AI_VOICE_SELECT_OPTIONS, OpenAIVoice } from "./chatConstants";
import ChatComposer, { CodeInterpreterToggle } from "./ChatComposer";
import ChatImageUpload from "./ChatImageUpload";
import { createChatDisplayMessage, createChatMultimodalMessage } from "./ChatImageUtils";
import CodeInterpreterTool from "./CodeInterpreterTool";
import { generateCodeSnippet } from "@/components/chat_ui/CodeSnippets";
import EndpointSelector from "./EndpointSelector";
import { filterModelsForEndpoint, isModelCompatibleWithEndpoint } from "./EndpointUtils";
import FilePreviewCard from "./FilePreviewCard";
import ChatMessageBubble from "./ChatMessageBubble";
import MCPEventsDisplay from "@/components/chat_ui/MCPEventsDisplay";
import { EndpointType, getEndpointType } from "@/components/chat_ui/mode_endpoint_mapping";
import ResponsesImageUpload from "./ResponsesImageUpload";
import { createDisplayMessage, createMultimodalMessage } from "./ResponsesImageUtils";
import SessionManagement from "./SessionManagement";
import RealtimePlayground from "./RealtimePlayground";
import { MessageType } from "@/components/chat_ui/types";
import { useCodeInterpreter } from "../../hooks/useCodeInterpreter";
import { useChatHistory } from "../../hooks/useChatHistory";
import { getSecureItem, setSecureItem } from "@/utils/secureStorage";
import { MultiSelect, type MultiSelectOption } from "@/components/shared/MultiSelect";
import { SearchSelect } from "@/components/shared/SearchSelect";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select as ShadcnSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDebouncedCallback } from "@tanstack/react-pacer/debouncer";
import { useTranslation } from "react-i18next";
import {
  AUDIO_ACCEPT,
  IMAGE_EDIT_ACCEPT,
  validateAudioFile,
  validateChatAttachment,
  validateImageEditFile,
} from "./uploadValidation";

interface ChatUIProps {
  accessToken: string | null;
  token: string | null;
  userRole: string | null;
  userID: string | null;
  disabledPersonalKeyCreation: boolean;
  proxySettings?: {
    PROXY_BASE_URL?: string;
    LITELLM_UI_API_DOC_BASE_URL?: string | null;
  };
  /** When true, hide configuration sidebar and use fixedModel only (e.g. embedded in Agent Builder). */
  simplified?: boolean;
  /** When simplified is true, use this as the model and do not show model selector. */
  fixedModel?: string;
}

const MCP_SUPPORTED_ENDPOINTS = new Set<EndpointType>([
  EndpointType.CHAT,
  EndpointType.RESPONSES,
  EndpointType.MCP,
  EndpointType.ANTHROPIC_MESSAGES,
]);

const CUSTOM_MODEL_DEBOUNCE_WAIT_MS = 500;

const ChatUI: React.FC<ChatUIProps> = ({
  accessToken,
  token,
  userRole,
  userID,
  disabledPersonalKeyCreation,
  proxySettings,
  simplified = false,
  fixedModel,
}) => {
  const { t } = useTranslation();
  const canViewPolicies = useCan("viewPolicies");
  const [mcpServers, setMCPServers] = useState<MCPServer[]>([]);
  const [mcpToolsets, setMCPToolsets] = useState<MCPToolset[]>([]);
  const [isToolsetsInfoModalVisible, setIsToolsetsInfoModalVisible] = useState(false);
  const [byokModalServer, setByokModalServer] = useState<MCPServer | null>(null);
  const [selectedMCPServers, setSelectedMCPServers] = useState<string[]>(() => {
    const saved = sessionStorage.getItem("selectedMCPServers");
    try {
      return saved ? JSON.parse(saved) : [];
    } catch (error) {
      console.error("Error parsing selectedMCPServers from sessionStorage", error);
      return [];
    }
  });
  const [isLoadingMCPServers, setIsLoadingMCPServers] = useState(false);
  const [serverToolsMap, setServerToolsMap] = useState<Record<string, any[]>>({});
  const [selectedMCPDirectTool, setSelectedMCPDirectTool] = useState<string | undefined>(undefined);
  const mcpToolArgsFormRef = useRef<MCPToolArgumentsFormRef>(null);
  const [mcpServerToolRestrictions, setMCPServerToolRestrictions] = useState<Record<string, string[]>>(() => {
    const saved = sessionStorage.getItem("mcpServerToolRestrictions");
    try {
      return saved ? JSON.parse(saved) : {};
    } catch (error) {
      console.error("Error parsing mcpServerToolRestrictions from sessionStorage", error);
      return {};
    }
  });
  const {
    chatHistory,
    setChatHistory,
    mcpEvents,
    messageTraceId,
    setMessageTraceId,
    responsesSessionId,
    useApiSessionManagement,
    updateTextUI,
    updateReasoningContent,
    updateTimingData,
    updateUsageData,
    updateA2AMetadata,
    updateTotalLatency,
    updateSearchResults,
    handleResponseId,
    handleToggleSessionManagement,
    handleMCPEvent,
    updateImageUI,
    updateEmbeddingsUI,
    updateAudioUI,
    updateChatImageUI,
    clearChatHistory: clearChatHistoryHook,
    clearMCPEvents,
  } = useChatHistory({ simplified });
  // codeql[js/clear-text-storage-of-sensitive-data]
  const [apiKeySource, setApiKeySource] = useState<"session" | "custom">(() => {
    const saved = getSecureItem("apiKeySource");
    if (saved) {
      try {
        return JSON.parse(saved) as "session" | "custom";
      } catch (error) {
        console.error("Error parsing apiKeySource from sessionStorage", error);
      }
    }
    return disabledPersonalKeyCreation ? "custom" : "session";
  });
  const [apiKey, setApiKey] = useState<string>(() => getSecureItem("apiKey") || "");
  const [customProxyBaseUrl, setCustomProxyBaseUrl] = useState<string>(
    () => sessionStorage.getItem("customProxyBaseUrl") || "",
  );
  const [inputMessage, setInputMessage] = useState("");
  const [selectedModel, setSelectedModel] = useState<string | undefined>(simplified ? fixedModel : undefined);
  const [showCustomModelInput, setShowCustomModelInput] = useState<boolean>(false);
  const [modelInfo, setModelInfo] = useState<ModelGroup[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelLoadError, setModelLoadError] = useState(false);
  const [agentInfo, setAgentInfo] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string | undefined>(undefined);
  const debouncedSetSelectedModel = useDebouncedCallback((value: string) => setSelectedModel(value), {
    wait: CUSTOM_MODEL_DEBOUNCE_WAIT_MS,
  });
  const [endpointType, setEndpointType] = useState<string>(
    () => sessionStorage.getItem("endpointType") || EndpointType.CHAT,
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>(() => {
    const saved = sessionStorage.getItem("selectedTags");
    try {
      return saved ? JSON.parse(saved) : [];
    } catch (error) {
      console.error("Error parsing selectedTags from sessionStorage", error);
      return [];
    }
  });
  const [selectedVoice, setSelectedVoice] = useState<OpenAIVoice>(() => {
    const saved = sessionStorage.getItem("selectedVoice");
    if (!saved) return "alloy";
    try {
      return JSON.parse(saved) as OpenAIVoice;
    } catch {
      // If stored value is not valid JSON, treat it as a plain string
      return saved as OpenAIVoice;
    }
  });
  const [selectedVectorStores, setSelectedVectorStores] = useState<string[]>(() => {
    const saved = sessionStorage.getItem("selectedVectorStores");
    try {
      return saved ? JSON.parse(saved) : [];
    } catch (error) {
      console.error("Error parsing selectedVectorStores from sessionStorage", error);
      return [];
    }
  });
  const [selectedGuardrails, setSelectedGuardrails] = useState<string[]>(() => {
    const saved = sessionStorage.getItem("selectedGuardrails");
    try {
      return saved ? JSON.parse(saved) : [];
    } catch (error) {
      console.error("Error parsing selectedGuardrails from sessionStorage", error);
      return [];
    }
  });
  const [selectedPolicies, setSelectedPolicies] = useState<string[]>(() => {
    const saved = sessionStorage.getItem("selectedPolicies");
    try {
      return saved ? JSON.parse(saved) : [];
    } catch (error) {
      console.error("Error parsing selectedPolicies from sessionStorage", error);
      return [];
    }
  });
  const [uploadedImages, setUploadedImages] = useState<File[]>([]);
  const [imagePreviewUrls, setImagePreviewUrls] = useState<string[]>([]);
  const [responsesUploadedImage, setResponsesUploadedImage] = useState<File | null>(null);
  const [responsesImagePreviewUrl, setResponsesImagePreviewUrl] = useState<string | null>(null);
  const [chatUploadedImage, setChatUploadedImage] = useState<File | null>(null);
  const [chatImagePreviewUrl, setChatImagePreviewUrl] = useState<string | null>(null);
  const [uploadedAudio, setUploadedAudio] = useState<File | null>(null);
  const [isGetCodeModalVisible, setIsGetCodeModalVisible] = useState(false);
  const [generatedCode, setGeneratedCode] = useState("");
  const [selectedSdk, setSelectedSdk] = useState<"openai" | "azure">("openai");
  const [temperature, setTemperature] = useState<number>(1.0);
  const [maxTokens, setMaxTokens] = useState<number>(2048);
  const [useAdvancedParams, setUseAdvancedParams] = useState<boolean>(false);
  const [mockTestFallbacks, setMockTestFallbacks] = useState<boolean>(false);
  const [streamingEnabled, setStreamingEnabled] = useState<boolean>(() => {
    if (simplified) return true;
    const saved = sessionStorage.getItem("streamingEnabled");
    return saved === null ? true : saved === "true";
  });

  // Code Interpreter state (using custom hook)
  const codeInterpreter = useCodeInterpreter();

  const chatEndRef = useRef<HTMLDivElement>(null);

  // Fetch MCP servers and toolsets
  const loadMCPServers = async () => {
    const userApiKey = apiKeySource === "session" ? accessToken : apiKey;
    if (!userApiKey) return;

    setIsLoadingMCPServers(true);
    try {
      const [servers, toolsets] = await Promise.all([
        fetchMCPServers(userApiKey),
        fetchMCPToolsets(userApiKey).catch(() => []),
      ]);
      setMCPServers(Array.isArray(servers) ? servers : servers.data || []);
      setMCPToolsets(Array.isArray(toolsets) ? toolsets : []);
    } catch (error) {
      console.error("Error fetching MCP servers:", error);
    } finally {
      setIsLoadingMCPServers(false);
    }
  };

  // When simplified, keep selectedModel and endpointType in sync with fixedModel / chat-only
  useEffect(() => {
    if (simplified && fixedModel) {
      setSelectedModel(fixedModel);
      setEndpointType(EndpointType.CHAT);
    }
  }, [simplified, fixedModel]);

  // Fetch tools for a specific server
  const loadServerTools = async (serverId: string) => {
    const userApiKey = apiKeySource === "session" ? accessToken : apiKey;
    if (!userApiKey || serverToolsMap[serverId]) return;

    try {
      const response = await listMCPTools(userApiKey, serverId);
      setServerToolsMap((prev) => ({
        ...prev,
        [serverId]: response.tools || [],
      }));
    } catch (error) {
      console.error(`Error fetching tools for server ${serverId}:`, error);
    }
  };

  useEffect(() => {
    if (isGetCodeModalVisible) {
      const code = generateCodeSnippet({
        apiKeySource,
        accessToken,
        apiKey,
        inputMessage,
        chatHistory,
        selectedTags,
        selectedVectorStores,
        selectedGuardrails,
        selectedPolicies,
        selectedMCPServers,
        mcpServers,
        mcpServerToolRestrictions,
        endpointType,
        selectedModel,
        selectedSdk,
        selectedVoice,
        proxySettings,
      });
      setGeneratedCode(code);
    }
  }, [
    isGetCodeModalVisible,
    selectedSdk,
    apiKeySource,
    accessToken,
    apiKey,
    inputMessage,
    chatHistory,
    selectedTags,
    selectedVectorStores,
    selectedGuardrails,
    selectedPolicies,
    selectedMCPServers,
    mcpServers,
    mcpServerToolRestrictions,
    endpointType,
    selectedModel,
    proxySettings,
  ]);

  useEffect(() => {
    try {
      setSecureItem("apiKeySource", JSON.stringify(apiKeySource));
      setSecureItem("apiKey", apiKey);
    } catch {
      // Storage full or unavailable — non-critical, skip persisting.
    }
    sessionStorage.setItem("endpointType", endpointType);
    sessionStorage.setItem("selectedTags", JSON.stringify(selectedTags));
    sessionStorage.setItem("selectedVectorStores", JSON.stringify(selectedVectorStores));
    sessionStorage.setItem("selectedGuardrails", JSON.stringify(selectedGuardrails));
    sessionStorage.setItem("selectedPolicies", JSON.stringify(selectedPolicies));
    sessionStorage.setItem("selectedMCPServers", JSON.stringify(selectedMCPServers));
    sessionStorage.setItem("mcpServerToolRestrictions", JSON.stringify(mcpServerToolRestrictions));
    sessionStorage.setItem("selectedVoice", selectedVoice);
    sessionStorage.removeItem("selectedMCPTools"); // Clean up old key

    if (!simplified) {
      sessionStorage.setItem("streamingEnabled", JSON.stringify(streamingEnabled));
      if (selectedModel) {
        sessionStorage.setItem("selectedModel", selectedModel);
      } else {
        sessionStorage.removeItem("selectedModel");
      }
    }
    // Note: codeInterpreterEnabled and selectedContainerId are persisted by useCodeInterpreter hook
  }, [
    simplified,
    apiKeySource,
    apiKey,
    selectedModel,
    endpointType,
    selectedTags,
    selectedVectorStores,
    selectedGuardrails,
    selectedPolicies,
    selectedMCPServers,
    mcpServerToolRestrictions,
    selectedVoice,
    streamingEnabled,
  ]);

  useEffect(() => {
    const userApiKey = apiKeySource === "session" ? accessToken : apiKey.trim();
    if (!userApiKey) {
      setModelInfo([]);
      setModelLoadError(false);
      setIsLoadingModels(false);
      return;
    }

    let cancelled = false;

    const loadModels = async () => {
      setIsLoadingModels(true);
      setModelLoadError(false);
      try {
        const uniqueModels = await fetchAvailableModels(userApiKey);
        if (cancelled) {
          return;
        }

        setModelInfo(uniqueModels);

        setSelectedModel((currentModel) =>
          uniqueModels.some((model) => model.model_group === currentModel) ? currentModel : undefined,
        );
      } catch (error) {
        if (cancelled) {
          return;
        }
        console.error("Error fetching model info:", error);
        setModelInfo([]);
        setModelLoadError(true);
      } finally {
        if (!cancelled) {
          setIsLoadingModels(false);
        }
      }
    };

    if (!simplified) {
      void loadModels();
    }
    void loadMCPServers();

    return () => {
      cancelled = true;
    };
  }, [accessToken, apiKeySource, apiKey, simplified]);

  // Load tools when MCP direct mode has a server (or toolset) selected
  useEffect(() => {
    if (endpointType === EndpointType.MCP && selectedMCPServers.length === 1 && selectedMCPServers[0] !== "__all__") {
      const selected = selectedMCPServers[0];
      if (selected.startsWith("toolset:")) {
        // For a toolset, load tools for each server in it
        const toolsetId = selected.slice("toolset:".length);
        const toolset = mcpToolsets.find((t) => t.toolset_id === toolsetId);
        if (toolset) {
          const uniqueServerIds = [...new Set(toolset.tools.map((t) => t.server_id))];
          uniqueServerIds.forEach((sid) => {
            if (!serverToolsMap[sid]) loadServerTools(sid);
          });
        }
      } else if (!serverToolsMap[selected]) {
        loadServerTools(selected);
      }
    }
  }, [endpointType, selectedMCPServers, serverToolsMap, mcpToolsets]);

  // Fetch agents when A2A endpoint is selected
  useEffect(() => {
    const userApiKey = apiKeySource === "session" ? accessToken : apiKey;
    if (!userApiKey || endpointType !== EndpointType.A2A_AGENTS) {
      return;
    }

    const loadAgents = async () => {
      try {
        const agents = await fetchAvailableAgents(userApiKey, customProxyBaseUrl || undefined);
        setAgentInfo(agents);
        // Clear selection if current agent not in list
        if (selectedAgent && !agents.some((a) => a.agent_name === selectedAgent)) {
          setSelectedAgent(undefined);
        }
      } catch (error) {
        console.error("Error fetching agents:", error);
      }
    };

    loadAgents();
  }, [accessToken, apiKeySource, apiKey, endpointType, customProxyBaseUrl, selectedAgent]);

  useEffect(() => {
    // Scroll to the bottom of the chat whenever chatHistory updates
    if (chatEndRef.current) {
      // Add a small delay to ensure content is rendered
      setTimeout(() => {
        chatEndRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "end", // Keep the scroll position at the end
        });
      }, 100);
    }
  }, [chatHistory]);

  const handleCancelRequest = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsLoading(false);
      NotificationsManager.info(t("playgroundAgents.chat.notifications.requestCancelled"));
    }
  };

  const createBlobPreviewUrl = (file: File): string => {
    const rawPreviewUrl = URL.createObjectURL(file);
    return rawPreviewUrl.startsWith("blob:") ? rawPreviewUrl : "";
  };

  const handleImageFiles = (files: File[]) => {
    let nextCount = uploadedImages.length;
    const accepted: File[] = [];
    const previews: string[] = [];
    for (const file of files) {
      const result = validateImageEditFile(file, nextCount);
      if (!result.ok) {
        NotificationsManager.error(result.error);
        continue;
      }
      accepted.push(file);
      previews.push(createBlobPreviewUrl(file));
      nextCount += 1;
    }
    if (accepted.length === 0) {
      return;
    }
    setUploadedImages((prev) => [...prev, ...accepted]);
    setImagePreviewUrls((prev) => [...prev, ...previews]);
  };

  const handleImageUpload = (file: File): void => {
    handleImageFiles([file]);
  };

  const handleRemoveImage = (index: number) => {
    if (imagePreviewUrls[index]) {
      URL.revokeObjectURL(imagePreviewUrls[index]);
    }
    setUploadedImages((prev) => prev.filter((_, i) => i !== index));
    setImagePreviewUrls((prev) => prev.filter((_, i) => i !== index));
  };

  const handleRemoveAllImages = () => {
    imagePreviewUrls.forEach((url) => {
      URL.revokeObjectURL(url);
    });
    setUploadedImages([]);
    setImagePreviewUrls([]);
  };

  const handleResponsesImageUpload = (file: File): void => {
    const result = validateChatAttachment(file);
    if (!result.ok) {
      NotificationsManager.error(result.error);
      return;
    }
    setResponsesUploadedImage(file);
    setResponsesImagePreviewUrl(createBlobPreviewUrl(file));
  };

  const handleRemoveResponsesImage = () => {
    if (responsesImagePreviewUrl) {
      URL.revokeObjectURL(responsesImagePreviewUrl);
    }
    setResponsesUploadedImage(null);
    setResponsesImagePreviewUrl(null);
  };

  const handleChatImageUpload = (file: File): void => {
    const result = validateChatAttachment(file);
    if (!result.ok) {
      NotificationsManager.error(result.error);
      return;
    }
    setChatUploadedImage(file);
    setChatImagePreviewUrl(createBlobPreviewUrl(file));
  };

  const handleRemoveChatImage = () => {
    if (chatImagePreviewUrl) {
      URL.revokeObjectURL(chatImagePreviewUrl);
    }
    setChatUploadedImage(null);
    setChatImagePreviewUrl(null);
  };

  const handleAudioUpload = (file: File): void => {
    const result = validateAudioFile(file);
    if (!result.ok) {
      NotificationsManager.error(result.error);
      return;
    }
    setUploadedAudio(file);
  };

  const handleEndpointChange = (value: string) => {
    setEndpointType(value);
    setSelectedModel(undefined);
    setSelectedAgent(undefined);
    setShowCustomModelInput(false);
    setSelectedMCPDirectTool(undefined);
    if (value === EndpointType.MCP) {
      setSelectedMCPServers((prev) => (prev.length === 1 && prev[0] !== "__all__" ? prev : []));
    }
    try {
      sessionStorage.removeItem("selectedModel");
      sessionStorage.removeItem("selectedAgent");
    } catch {}
  };

  const handleVoiceChange = (value: OpenAIVoice | null) => {
    if (value == null) {
      return;
    }
    setSelectedVoice(value);
    sessionStorage.setItem("selectedVoice", value);
  };

  const handleAudioFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      handleAudioUpload(file);
    }
    event.target.value = "";
  };

  const mcpServerOptions = useMemo((): MultiSelectOption[] => {
    const options: MultiSelectOption[] = [];
    if (endpointType !== EndpointType.MCP) {
      options.push({
        value: "__all__",
        label: t("playgroundAgents.chat.allMcpServers"),
        description: t("playgroundAgents.chat.allMcpServersHelp"),
      });
    }
    for (const toolset of mcpToolsets) {
      options.push({
        value: `toolset:${toolset.toolset_id}`,
        label: toolset.toolset_name,
        description:
          toolset.description ||
          `${t("playgroundAgents.chat.toolsets")} (${t("playgroundAgents.chat.toolCount", { count: toolset.tools.length })})`,
      });
    }
    for (const server of mcpServers) {
      options.push({
        value: server.server_id,
        label: server.alias || server.server_name || server.server_id,
        description: server.description ?? undefined,
      });
    }
    return options;
  }, [endpointType, mcpToolsets, mcpServers, t]);

  const handleMcpServersChange = (value: string[]) => {
    if (endpointType === EndpointType.MCP) {
      const serverId = value[0];
      setSelectedMCPServers(serverId ? [serverId] : []);
      setSelectedMCPDirectTool(undefined);
      if (serverId && !serverToolsMap[serverId]) {
        loadServerTools(serverId);
      }
      return;
    }

    if (value.includes("__all__")) {
      setSelectedMCPServers(["__all__"]);
      setMCPServerToolRestrictions({});
      return;
    }

    setSelectedMCPServers(value);
    setMCPServerToolRestrictions((prev) => {
      const updated = { ...prev };
      Object.keys(updated).forEach((serverId) => {
        if (!value.includes(serverId)) delete updated[serverId];
      });
      return updated;
    });
    value.forEach((serverId) => {
      if (!serverToolsMap[serverId]) {
        loadServerTools(serverId);
      }
    });
  };

  const handleRemoveAudio = () => {
    setUploadedAudio(null);
  };

  const handleSendMessage = async () => {
    if (inputMessage.trim() === "" && endpointType !== EndpointType.TRANSCRIPTION && endpointType !== EndpointType.MCP)
      return;

    // For image edits, require both image and prompt
    if (endpointType === EndpointType.IMAGE_EDITS && uploadedImages.length === 0) {
      NotificationsManager.fromBackend(t("playgroundAgents.chat.validation.imageRequired"));
      return;
    }

    // For audio transcriptions, require audio file
    if (endpointType === EndpointType.TRANSCRIPTION && !uploadedAudio) {
      NotificationsManager.fromBackend(t("playgroundAgents.chat.validation.audioRequired"));
      return;
    }

    // For A2A agents, require agent selection
    if (endpointType === EndpointType.A2A_AGENTS && !selectedAgent) {
      NotificationsManager.fromBackend(t("playgroundAgents.chat.validation.agentRequired"));
      return;
    }

    // For MCP direct mode, require server and tool selection, and get form values early
    let mcpToolArguments: Record<string, any> = {};
    if (endpointType === EndpointType.MCP) {
      const rawSelected =
        selectedMCPServers.length === 1 && selectedMCPServers[0] !== "__all__" ? selectedMCPServers[0] : null;
      if (!rawSelected) {
        NotificationsManager.fromBackend(t("playgroundAgents.chat.validation.mcpServerRequired"));
        return;
      }
      if (!selectedMCPDirectTool) {
        NotificationsManager.fromBackend(t("playgroundAgents.chat.validation.mcpToolRequired"));
        return;
      }
      // For toolsets, find the tool in the servers that back this toolset
      const toolsetForSelected = rawSelected.startsWith("toolset:")
        ? mcpToolsets.find((t) => t.toolset_id === rawSelected.slice("toolset:".length))
        : null;
      let searchPool: any[] = [];
      if (toolsetForSelected) {
        const uniqueServerIds = [...new Set(toolsetForSelected.tools.map((t) => t.server_id))];
        uniqueServerIds.forEach((sid) => {
          searchPool = searchPool.concat(serverToolsMap[sid] || []);
        });
      } else {
        searchPool = serverToolsMap[rawSelected] || [];
      }
      const mcpTool = searchPool.find((t: any) => t.name === selectedMCPDirectTool);
      if (!mcpTool) {
        NotificationsManager.fromBackend(t("playgroundAgents.chat.validation.toolSchemaLoading"));
        return;
      }
      try {
        mcpToolArguments = (await mcpToolArgsFormRef.current?.getSubmitValues()) ?? {};
      } catch (err) {
        NotificationsManager.fromBackend(
          err instanceof Error ? err.message : t("playgroundAgents.chat.validation.requiredParameters"),
        );
        return;
      }
    }

    // Require model selection for all model-based endpoints (MCP direct mode does not need a model)
    const modelRequiredEndpoints = [
      EndpointType.CHAT,
      EndpointType.IMAGE,
      EndpointType.SPEECH,
      EndpointType.IMAGE_EDITS,
      EndpointType.RESPONSES,
      EndpointType.ANTHROPIC_MESSAGES,
      EndpointType.EMBEDDINGS,
      EndpointType.TRANSCRIPTION,
      EndpointType.INTERACTIONS,
    ];

    if (modelRequiredEndpoints.includes(endpointType as EndpointType) && !selectedModel) {
      NotificationsManager.fromBackend(t("playgroundAgents.chat.validation.modelRequired"));
      return;
    }

    if (!token || !userRole || !userID) {
      return;
    }

    const effectiveApiKey = simplified ? accessToken : apiKeySource === "session" ? accessToken : apiKey;

    if (!effectiveApiKey) {
      NotificationsManager.fromBackend(t("playgroundAgents.chat.validation.apiKeyRequired"));
      return;
    }

    // Create new abort controller for this request
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    // Create message object without model field for API call
    let newUserMessage: { role: string; content: string | any[] };

    // Handle image for responses API
    if (endpointType === EndpointType.RESPONSES && responsesUploadedImage) {
      try {
        newUserMessage = await createMultimodalMessage(inputMessage, responsesUploadedImage);
      } catch (error) {
        NotificationsManager.fromBackend(t("playgroundAgents.chat.errors.imageProcessingFailed"));
        return;
      }
    }
    // Handle image for chat completions API
    else if (endpointType === EndpointType.CHAT && chatUploadedImage) {
      try {
        newUserMessage = await createChatMultimodalMessage(inputMessage, chatUploadedImage);
      } catch (error) {
        NotificationsManager.fromBackend(t("playgroundAgents.chat.errors.imageProcessingFailed"));
        return;
      }
    } else {
      newUserMessage = { role: "user", content: inputMessage };
    }

    // Generate new trace ID for a new conversation or use existing one
    const traceId = messageTraceId || uuidv4();
    if (!messageTraceId) {
      setMessageTraceId(traceId);
    }

    // Update UI with full message object (always display as text for UI)
    let displayMessage: MessageType;
    if (endpointType === EndpointType.RESPONSES && responsesUploadedImage) {
      displayMessage = createDisplayMessage(
        inputMessage,
        true,
        responsesImagePreviewUrl || undefined,
        responsesUploadedImage.name,
      );
    } else if (endpointType === EndpointType.CHAT && chatUploadedImage) {
      displayMessage = createChatDisplayMessage(
        inputMessage,
        true,
        chatImagePreviewUrl || undefined,
        chatUploadedImage.name,
      );
    } else if (endpointType === EndpointType.TRANSCRIPTION && uploadedAudio) {
      // For audio transcription, show the audio file name and optional prompt
      const audioMessage = inputMessage
        ? t("playgroundAgents.chat.transcript.audioWithPrompt", { fileName: uploadedAudio.name, prompt: inputMessage })
        : t("playgroundAgents.chat.transcript.audio", { fileName: uploadedAudio.name });
      displayMessage = createDisplayMessage(audioMessage, false);
    } else if (endpointType === EndpointType.MCP && selectedMCPDirectTool) {
      // For MCP direct mode, show tool name and arguments from form
      const mcpMessage = t("playgroundAgents.chat.transcript.mcpTool", {
        toolName: selectedMCPDirectTool,
        arguments: JSON.stringify(mcpToolArguments, null, 2),
      });
      displayMessage = createDisplayMessage(mcpMessage, false);
    } else {
      displayMessage = createDisplayMessage(inputMessage, false);
    }

    setChatHistory([...chatHistory, displayMessage]);
    clearMCPEvents(); // Clear previous MCP events for new conversation turn
    codeInterpreter.clearResult(); // Clear previous code interpreter results
    setIsLoading(true);

    try {
      if (selectedModel) {
        if (endpointType === EndpointType.CHAT) {
          // Create chat history for API call - strip out model field and isImage field
          // For chat completions, we preserve the multimodal content structure
          const apiChatHistory = [
            ...chatHistory
              .filter((msg) => !msg.isImage && !msg.isAudio)
              .map(({ role, content }) => ({
                role,
                content: typeof content === "string" ? content : "",
              })),
            newUserMessage,
          ];

          const requestProxyBaseUrl =
            simplified && proxySettings
              ? proxySettings.LITELLM_UI_API_DOC_BASE_URL ?? proxySettings.PROXY_BASE_URL ?? undefined
              : customProxyBaseUrl || undefined;
          await makeOpenAIChatCompletionRequest(
            apiChatHistory,
            (chunk, model) => updateTextUI("assistant", chunk, model),
            selectedModel,
            effectiveApiKey,
            selectedTags,
            signal,
            updateReasoningContent,
            updateTimingData,
            updateUsageData,
            traceId,
            selectedVectorStores.length > 0 ? selectedVectorStores : undefined,
            selectedGuardrails.length > 0 ? selectedGuardrails : undefined,
            selectedPolicies.length > 0 ? selectedPolicies : undefined,
            selectedMCPServers,
            updateChatImageUI,
            updateSearchResults,
            useAdvancedParams ? temperature : undefined,
            useAdvancedParams ? maxTokens : undefined,
            updateTotalLatency,
            requestProxyBaseUrl,
            mcpServers,
            mcpServerToolRestrictions,
            handleMCPEvent,
            mockTestFallbacks,
            mcpToolsets,
            streamingEnabled,
          );
        } else if (endpointType === EndpointType.IMAGE) {
          // For image generation
          await makeOpenAIImageGenerationRequest(
            inputMessage,
            (imageUrl, model) => updateImageUI(imageUrl, model),
            selectedModel,
            effectiveApiKey,
            selectedTags,
            signal,
            customProxyBaseUrl || undefined,
          );
        } else if (endpointType === EndpointType.SPEECH) {
          // For audio speech
          await makeOpenAIAudioSpeechRequest(
            inputMessage,
            selectedVoice,
            (audioUrl, model) => updateAudioUI(audioUrl, model),
            selectedModel || "",
            effectiveApiKey,
            selectedTags,
            signal,
            undefined, // responseFormat
            undefined, // speed
            customProxyBaseUrl || undefined,
          );
        } else if (endpointType === EndpointType.IMAGE_EDITS) {
          // For image edits
          if (uploadedImages.length > 0) {
            await makeOpenAIImageEditsRequest(
              uploadedImages.length === 1 ? uploadedImages[0] : uploadedImages,
              inputMessage,
              (imageUrl, model) => updateImageUI(imageUrl, model),
              selectedModel,
              effectiveApiKey,
              selectedTags,
              signal,
              customProxyBaseUrl || undefined,
            );
          }
        } else if (endpointType === EndpointType.RESPONSES) {
          // Create chat history for API call - strip out model field and isImage field
          let apiChatHistory;

          if (useApiSessionManagement && responsesSessionId) {
            // When using API session management with existing session, only send the new message
            apiChatHistory = [newUserMessage];
          } else {
            // When using UI session management or starting new API session, send full history
            apiChatHistory = [
              ...chatHistory
                .filter((msg) => !msg.isImage && !msg.isAudio)
                .map(({ role, content }) => ({ role, content })),
              newUserMessage,
            ];
          }

          await makeOpenAIResponsesRequest(
            apiChatHistory,
            (role, delta, model) => updateTextUI(role, delta, model),
            selectedModel,
            effectiveApiKey,
            selectedTags,
            signal,
            updateReasoningContent,
            updateTimingData,
            updateUsageData,
            traceId,
            selectedVectorStores.length > 0 ? selectedVectorStores : undefined,
            selectedGuardrails.length > 0 ? selectedGuardrails : undefined,
            selectedPolicies.length > 0 ? selectedPolicies : undefined,
            selectedMCPServers, // Pass the selected servers array
            useApiSessionManagement ? responsesSessionId : null, // Only pass session ID if API mode is enabled
            handleResponseId, // Pass callback to capture new response ID
            handleMCPEvent, // Pass MCP event handler
            codeInterpreter.enabled, // Enable Code Interpreter tool
            codeInterpreter.setResult, // Handle code interpreter output
            customProxyBaseUrl || undefined,
            mcpServers,
            mcpServerToolRestrictions,
            mcpToolsets,
            streamingEnabled,
            updateTotalLatency,
          );
        } else if (endpointType === EndpointType.ANTHROPIC_MESSAGES) {
          const apiChatHistory = [
            ...chatHistory
              .filter((msg) => !msg.isImage && !msg.isAudio)
              .map(({ role, content }) => ({ role, content })),
            newUserMessage,
          ];

          await makeAnthropicMessagesRequest(
            apiChatHistory,
            (role, delta, model) => updateTextUI(role, delta, model),
            selectedModel,
            effectiveApiKey,
            selectedTags,
            signal,
            updateReasoningContent,
            updateTimingData,
            updateUsageData,
            traceId,
            selectedVectorStores.length > 0 ? selectedVectorStores : undefined,
            selectedGuardrails.length > 0 ? selectedGuardrails : undefined,
            selectedPolicies.length > 0 ? selectedPolicies : undefined,
            selectedMCPServers,
            customProxyBaseUrl || undefined,
            mcpServers,
            mcpServerToolRestrictions,
            mcpToolsets,
          );
        } else if (endpointType === EndpointType.EMBEDDINGS) {
          await makeOpenAIEmbeddingsRequest(
            inputMessage,
            (embeddings, model) => updateEmbeddingsUI(embeddings, model),
            selectedModel,
            effectiveApiKey,
            selectedTags,
            customProxyBaseUrl || undefined,
          );
        } else if (endpointType === EndpointType.TRANSCRIPTION) {
          // For audio transcriptions
          if (uploadedAudio) {
            await makeOpenAIAudioTranscriptionRequest(
              uploadedAudio,
              (transcription, model) => updateTextUI("assistant", transcription, model),
              selectedModel,
              effectiveApiKey,
              selectedTags,
              signal,
              undefined, // language
              undefined, // prompt
              undefined, // responseFormat
              undefined, // temperature
              customProxyBaseUrl || undefined,
            );
          }
        } else if (endpointType === EndpointType.INTERACTIONS) {
          await makeInteractionsRequest(
            inputMessage,
            (text, model) => updateTextUI("assistant", text, model),
            selectedModel,
            effectiveApiKey,
            selectedTags,
            signal,
            customProxyBaseUrl || undefined,
          );
        }
      }

      // Handle MCP direct tool calls (no chat completions)
      if (endpointType === EndpointType.MCP) {
        const rawSelected =
          selectedMCPServers.length === 1 && selectedMCPServers[0] !== "__all__" ? selectedMCPServers[0] : null;
        // For toolsets, resolve the real server_id from the toolset's tool list
        let resolvedServerId = rawSelected;
        if (rawSelected?.startsWith("toolset:")) {
          const toolsetId = rawSelected.slice("toolset:".length);
          const toolset = mcpToolsets.find((t) => t.toolset_id === toolsetId);
          const toolEntry = toolset?.tools.find((t) => t.tool_name === selectedMCPDirectTool);
          resolvedServerId = toolEntry?.server_id ?? rawSelected;
        }
        if (resolvedServerId && !resolvedServerId.startsWith("toolset:") && selectedMCPDirectTool) {
          const result = await callMCPTool(
            effectiveApiKey,
            resolvedServerId,
            selectedMCPDirectTool,
            mcpToolArguments,
            selectedGuardrails.length > 0 ? { guardrails: selectedGuardrails } : undefined,
          );
          const resultText =
            result?.content?.length > 0
              ? JSON.stringify(
                  result.content.map((c: any) => (c.type === "text" ? c.text : c)).filter(Boolean),
                  null,
                  2,
                )
              : JSON.stringify(result, null, 2);
          updateTextUI("assistant", resultText || t("playgroundAgents.chat.toolExecutedSuccessfully"));
        }
      }

      // Handle A2A agent calls (separate from model-based calls) - use streaming
      if (endpointType === EndpointType.A2A_AGENTS && selectedAgent) {
        await makeA2ASendMessageRequest(
          selectedAgent,
          inputMessage,
          (chunk, model) => updateTextUI("assistant", chunk, model),
          effectiveApiKey,
          signal,
          updateTimingData,
          updateTotalLatency,
          updateA2AMetadata,
          customProxyBaseUrl || undefined,
          selectedGuardrails.length > 0 ? selectedGuardrails : undefined,
        );
      }
    } catch (error) {
      if (signal.aborted) {
      } else {
        console.error("Error fetching response", error);
        updateTextUI("assistant", t("playgroundAgents.chat.errors.fetchResponse", { error: String(error) }));
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
      // Clear image after successful request for image edits
      if (endpointType === EndpointType.IMAGE_EDITS) {
        handleRemoveAllImages();
      }
      // Clear image after successful request for responses API
      if (endpointType === EndpointType.RESPONSES && responsesUploadedImage) {
        handleRemoveResponsesImage();
      }
      // Clear image after successful request for chat completions API
      if (endpointType === EndpointType.CHAT && chatUploadedImage) {
        handleRemoveChatImage();
      }
      // Clear audio after successful request for transcription
      if (endpointType === EndpointType.TRANSCRIPTION && uploadedAudio) {
        handleRemoveAudio();
      }
    }

    setInputMessage("");
  };

  const clearChatHistory = () => {
    clearChatHistoryHook();
    handleRemoveAllImages();
    handleRemoveResponsesImage();
    handleRemoveChatImage();
    handleRemoveAudio();
    NotificationsManager.success(t("playgroundAgents.chat.notifications.historyCleared"));
  };

  const onModelChange = (value: string) => {
    setSelectedModel(value);
    setShowCustomModelInput(value === "custom");

    const model = modelInfo.find((option) => option.model_group === value);
    if (model?.mode && !isModelCompatibleWithEndpoint(model, endpointType as EndpointType)) {
      setEndpointType(getEndpointType(model.mode));
    }
  };

  // Check if the selected model is a chat model
  const isChatModel = () => {
    if (!selectedModel || selectedModel === "custom") {
      return false;
    }
    const model = modelInfo.find((m) => m.model_group === selectedModel);
    if (!model) {
      return false;
    }
    // Check if mode is explicitly "chat" or undefined (which defaults to chat per backend)
    return !model.mode || model.mode === "chat";
  };

  const supportsStreamingToggle = endpointType === EndpointType.CHAT || endpointType === EndpointType.RESPONSES;
  const modelsForEndpoint = useMemo(
    () => filterModelsForEndpoint(modelInfo, endpointType as EndpointType),
    [modelInfo, endpointType],
  );
  let modelEmptyText = t("playgroundAgents.chat.modelEmpty.noModelsForKey");
  if (modelLoadError) {
    modelEmptyText = t("playgroundAgents.chat.modelEmpty.loadFailed");
  } else if (apiKeySource === "custom" && !apiKey.trim()) {
    modelEmptyText = t("playgroundAgents.chat.modelEmpty.enterKey");
  } else if (modelInfo.length > 0 && modelsForEndpoint.length === 0) {
    modelEmptyText = t("playgroundAgents.chat.modelEmpty.noModelsForEndpoint");
  }

  const inputPlaceholder =
    endpointType === EndpointType.CHAT ||
    endpointType === EndpointType.EMBEDDINGS ||
    endpointType === EndpointType.RESPONSES ||
    endpointType === EndpointType.ANTHROPIC_MESSAGES ||
    endpointType === EndpointType.INTERACTIONS
      ? t("playgroundAgents.chat.placeholder.message")
      : endpointType === EndpointType.A2A_AGENTS
        ? t("playgroundAgents.chat.placeholder.a2aMessage")
        : endpointType === EndpointType.IMAGE_EDITS
          ? t("playgroundAgents.chat.placeholder.imageEdit")
          : endpointType === EndpointType.SPEECH
            ? t("playgroundAgents.chat.placeholder.speech")
            : endpointType === EndpointType.TRANSCRIPTION
              ? t("playgroundAgents.chat.placeholder.transcription")
              : t("playgroundAgents.chat.placeholder.imageGeneration");

  const sendDisabled =
    isLoading ||
    (endpointType === EndpointType.MCP
      ? !(selectedMCPServers.length === 1 && selectedMCPServers[0] !== "__all__" && selectedMCPDirectTool)
      : endpointType === EndpointType.TRANSCRIPTION
        ? !uploadedAudio
        : !inputMessage.trim());

  return (
    <div className={`min-h-0 min-w-0 bg-white ${simplified ? "flex h-full w-full flex-col" : "h-full w-full p-3"}`}>
      <div className="flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden rounded-xl bg-white shadow-md ring-1 ring-foreground/10">
        <div className="flex h-full min-h-0 min-w-0 w-full flex-col lg:flex-row">
          {!simplified && (
            <div className="max-h-[42%] w-full shrink-0 overflow-y-auto border-b border-gray-200 bg-gray-50 p-4 lg:max-h-none lg:w-72 lg:border-r lg:border-b-0 xl:w-80">
              <h2 className="mb-6 mt-2 text-xl font-semibold">{t("playgroundAgents.chat.configurations")}</h2>
              <div className="space-y-4">
                <div>
                  <label className="mb-2 flex items-center text-sm font-medium text-gray-700">
                    <Key className="mr-2 size-4" aria-hidden="true" /> {t("playgroundAgents.chat.virtualKeySource")}
                  </label>
                  <ShadcnSelect
                    disabled={disabledPersonalKeyCreation}
                    value={apiKeySource}
                    onValueChange={(value) => {
                      setApiKeySource(value as "session" | "custom");
                    }}
                  >
                    <SelectTrigger
                      className="w-full"
                      size="sm"
                      aria-label={t("playgroundAgents.chat.virtualKeySource")}
                    >
                      <SelectValue>
                        {apiKeySource === "custom"
                          ? t("playgroundAgents.chat.virtualKey")
                          : t("playgroundAgents.chat.currentUiSession")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="session">{t("playgroundAgents.chat.currentUiSession")}</SelectItem>
                      <SelectItem value="custom">{t("playgroundAgents.chat.virtualKey")}</SelectItem>
                    </SelectContent>
                  </ShadcnSelect>
                  {apiKeySource === "custom" && (
                    <div className="relative mt-2">
                      <Key className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        className="h-8 pl-8"
                        placeholder={t("playgroundAgents.chat.enterCustomVirtualKey")}
                        type="password"
                        onChange={(event) => setApiKey(event.target.value)}
                        value={apiKey}
                      />
                    </div>
                  )}
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label className="flex items-center text-sm font-medium text-gray-700">
                      <Settings className="mr-2 size-4" aria-hidden="true" />{" "}
                      {t("playgroundAgents.chat.customProxyBaseUrl")}
                    </label>
                    {proxySettings?.LITELLM_UI_API_DOC_BASE_URL && !customProxyBaseUrl && (
                      <Button
                        type="button"
                        variant="link"
                        size="xs"
                        className="h-auto p-0 text-gray-500 hover:text-gray-700"
                        onClick={() => {
                          setCustomProxyBaseUrl(proxySettings.LITELLM_UI_API_DOC_BASE_URL || "");
                          sessionStorage.setItem("customProxyBaseUrl", proxySettings.LITELLM_UI_API_DOC_BASE_URL || "");
                        }}
                      >
                        <Link2 className="size-3" />
                        {t("playgroundAgents.chat.fill")}
                      </Button>
                    )}
                    {customProxyBaseUrl && (
                      <Button
                        type="button"
                        variant="link"
                        size="xs"
                        className="h-auto p-0 text-gray-500 hover:text-gray-700"
                        onClick={() => {
                          setCustomProxyBaseUrl("");
                          sessionStorage.removeItem("customProxyBaseUrl");
                        }}
                      >
                        <Eraser className="size-3" />
                        {t("playgroundAgents.chat.clear")}
                      </Button>
                    )}
                  </div>
                  <div className="relative">
                    <Wrench className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="h-8 pl-8"
                      placeholder={t("playgroundAgents.chat.customProxyPlaceholder")}
                      value={customProxyBaseUrl}
                      onChange={(event) => {
                        setCustomProxyBaseUrl(event.target.value);
                        sessionStorage.setItem("customProxyBaseUrl", event.target.value);
                      }}
                    />
                  </div>
                  {customProxyBaseUrl && (
                    <p className="mt-1 text-xs text-gray-500">
                      {t("playgroundAgents.chat.apiCallsSentTo", { url: customProxyBaseUrl })}
                    </p>
                  )}
                </div>

                <div>
                  <label className="mb-2 flex items-center text-sm font-medium text-gray-700">
                    <Wrench className="mr-2 size-4" aria-hidden="true" /> {t("playgroundAgents.chat.endpointType")}
                  </label>
                  <EndpointSelector
                    endpointType={endpointType}
                    onEndpointChange={handleEndpointChange}
                    className="mb-4"
                  />

                  {endpointType === EndpointType.SPEECH && (
                    <div className="mb-4">
                      <label className="mb-2 flex items-center text-sm font-medium text-gray-700">
                        <Volume2 className="mr-2 size-4" aria-hidden="true" />
                        {t("playgroundAgents.chat.voice")}
                      </label>
                      <ShadcnSelect value={selectedVoice} onValueChange={handleVoiceChange}>
                        <SelectTrigger className="w-full" size="sm" aria-label={t("playgroundAgents.chat.voice")}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {OPEN_AI_VOICE_SELECT_OPTIONS.map((voice) => (
                            <SelectItem key={voice.value} value={voice.value}>
                              {voice.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </ShadcnSelect>
                    </div>
                  )}

                  <SessionManagement
                    endpointType={endpointType}
                    responsesSessionId={responsesSessionId}
                    useApiSessionManagement={useApiSessionManagement}
                    onToggleSessionManagement={handleToggleSessionManagement}
                  />
                </div>

                {endpointType !== EndpointType.A2A_AGENTS && endpointType !== EndpointType.MCP && (
                  <div>
                    <div className="mb-2 flex items-center justify-between text-sm font-medium text-gray-700">
                      <span className="flex items-center">
                        <Bot className="mr-2 size-4" aria-hidden="true" /> {t("playgroundAgents.chat.selectModel")}
                      </span>
                      {isChatModel() || supportsStreamingToggle ? (
                        <Popover>
                          <PopoverTrigger
                            render={
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                className="text-gray-500 hover:text-gray-700"
                                aria-label={t("playgroundAgents.chat.modelSettings")}
                                data-testid="model-settings-button"
                              />
                            }
                          >
                            <Settings className="size-3.5" />
                          </PopoverTrigger>
                          <PopoverContent side="right" className="w-auto p-0">
                            <div className="border-b border-border px-4 py-2 text-sm font-medium">
                              {t("playgroundAgents.chat.modelSettings")}
                            </div>
                            <AdditionalModelSettings
                              showAdvancedParams={isChatModel()}
                              temperature={temperature}
                              maxTokens={maxTokens}
                              useAdvancedParams={useAdvancedParams}
                              onTemperatureChange={setTemperature}
                              onMaxTokensChange={setMaxTokens}
                              onUseAdvancedParamsChange={setUseAdvancedParams}
                              mockTestFallbacks={mockTestFallbacks}
                              onMockTestFallbacksChange={setMockTestFallbacks}
                              streamingEnabled={streamingEnabled}
                              onStreamingChange={supportsStreamingToggle ? setStreamingEnabled : undefined}
                            />
                          </PopoverContent>
                        </Popover>
                      ) : (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                className="cursor-not-allowed text-gray-300"
                                disabled
                                aria-label={t("playgroundAgents.chat.advancedParamsUnavailable")}
                              />
                            }
                          >
                            <Settings className="size-3.5" />
                          </TooltipTrigger>
                          <TooltipContent>{t("playgroundAgents.chat.advancedParamsUnavailable")}</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                    <SearchSelect
                      value={selectedModel}
                      placeholder={
                        isLoadingModels
                          ? t("playgroundAgents.chat.loadingModels")
                          : t("playgroundAgents.chat.selectModelPlaceholder")
                      }
                      emptyText={modelEmptyText}
                      disabled={isLoadingModels}
                      onValueChange={onModelChange}
                      options={[
                        { value: "custom", label: t("playgroundAgents.chat.enterCustomModel") },
                        ...modelsForEndpoint.map((model) => ({
                          value: model.model_group,
                          label: model.model_group,
                          sublabel: model.mode ? t("playgroundAgents.chat.mode", { mode: model.mode }) : undefined,
                        })),
                      ]}
                    />
                    {showCustomModelInput && (
                      <Input
                        className="mt-2 h-8"
                        placeholder={t("playgroundAgents.chat.enterCustomModelName")}
                        onChange={(event) => debouncedSetSelectedModel(event.target.value)}
                      />
                    )}
                  </div>
                )}

                {endpointType === EndpointType.A2A_AGENTS && (
                  <div>
                    <label className="mb-2 flex items-center text-sm font-medium text-gray-700">
                      <Bot className="mr-2 size-4" aria-hidden="true" /> {t("playgroundAgents.chat.selectAgent")}
                    </label>
                    <SearchSelect
                      value={selectedAgent}
                      placeholder={t("playgroundAgents.chat.selectAgentPlaceholder")}
                      onValueChange={(value) => setSelectedAgent(value)}
                      options={agentInfo.map((agent) => ({
                        value: agent.agent_name,
                        label: agent.agent_name || agent.agent_id,
                        sublabel: agent.agent_card_params?.description,
                      }))}
                    />
                    {agentInfo.length === 0 && (
                      <p className="mt-2 text-xs text-gray-500">{t("playgroundAgents.chat.noAgentsFound")}</p>
                    )}
                  </div>
                )}

                <div>
                  <label className="mb-2 flex items-center text-sm font-medium text-gray-700">
                    <Tags className="mr-2 size-4" aria-hidden="true" /> {t("playgroundAgents.chat.tags")}
                  </label>
                  <TagSelector
                    value={selectedTags}
                    onChange={setSelectedTags}
                    className="mb-4"
                    accessToken={accessToken || ""}
                  />
                </div>

                <div>
                  <div className="mb-2 flex items-center gap-1 text-sm font-medium text-gray-700">
                    <Wrench className="mr-1 size-4" aria-hidden="true" />
                    {endpointType === EndpointType.MCP
                      ? t("playgroundAgents.chat.mcpServer")
                      : t("playgroundAgents.chat.mcpServers")}
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            className="inline-flex"
                            aria-label={t("playgroundAgents.chat.mcpConversationTooltip")}
                            onClick={() => setIsToolsetsInfoModalVisible(true)}
                          />
                        }
                      >
                        <Info className="size-3.5 cursor-pointer text-gray-400" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        {endpointType === EndpointType.MCP
                          ? t("playgroundAgents.chat.mcpDirectTooltip")
                          : t("playgroundAgents.chat.mcpConversationTooltip")}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  {endpointType === EndpointType.MCP ? (
                    <SearchSelect
                      value={
                        selectedMCPServers[0] !== "__all__" && selectedMCPServers.length === 1
                          ? selectedMCPServers[0]
                          : undefined
                      }
                      placeholder={t("playgroundAgents.chat.selectMcpServer")}
                      emptyText={
                        isLoadingMCPServers
                          ? t("playgroundAgents.chat.loading")
                          : t("playgroundAgents.chat.noMcpServers")
                      }
                      disabled={!MCP_SUPPORTED_ENDPOINTS.has(endpointType as EndpointType) || isLoadingMCPServers}
                      onValueChange={(value) => handleMcpServersChange(value ? [value] : [])}
                      options={mcpServerOptions}
                      className="mb-2"
                    />
                  ) : (
                    <MultiSelect
                      value={selectedMCPServers}
                      onValueChange={handleMcpServersChange}
                      placeholder={t("playgroundAgents.chat.selectMcpServers")}
                      emptyText={
                        isLoadingMCPServers
                          ? t("playgroundAgents.chat.loading")
                          : t("playgroundAgents.chat.noMcpServers")
                      }
                      disabled={!MCP_SUPPORTED_ENDPOINTS.has(endpointType as EndpointType)}
                      loading={isLoadingMCPServers}
                      options={mcpServerOptions}
                      className="mb-2"
                    />
                  )}

                  {endpointType === EndpointType.MCP &&
                    selectedMCPServers.length === 1 &&
                    selectedMCPServers[0] !== "__all__" &&
                    (() => {
                      const rawSel = selectedMCPServers[0];
                      const isToolset = rawSel.startsWith("toolset:");
                      let toolOptions: { value: string; label: string }[] = [];
                      if (isToolset) {
                        const toolsetId = rawSel.slice("toolset:".length);
                        const toolset = mcpToolsets.find((t) => t.toolset_id === toolsetId);
                        if (toolset) {
                          toolOptions = toolset.tools.map((t) => ({
                            value: t.tool_name,
                            label: t.tool_name,
                          }));
                        }
                      } else {
                        toolOptions = (serverToolsMap[rawSel] || []).map((tool: { name: string }) => ({
                          value: tool.name,
                          label: tool.name,
                        }));
                      }
                      return (
                        <div className="mt-3">
                          <p className="mb-1 block text-xs text-gray-600">{t("playgroundAgents.chat.selectTool")}</p>
                          <SearchSelect
                            value={selectedMCPDirectTool}
                            placeholder={t("playgroundAgents.chat.selectToolPlaceholder")}
                            onValueChange={(value) => setSelectedMCPDirectTool(value || undefined)}
                            options={toolOptions}
                            className="rounded-md"
                          />
                        </div>
                      );
                    })()}

                  {selectedMCPServers.length > 0 &&
                    !selectedMCPServers.includes("__all__") &&
                    endpointType !== EndpointType.MCP &&
                    MCP_SUPPORTED_ENDPOINTS.has(endpointType as EndpointType) && (
                      <div className="mt-3 space-y-2">
                        {selectedMCPServers.map((serverId) => {
                          const server = mcpServers.find((s) => s.server_id === serverId);
                          const tools = serverToolsMap[serverId] || [];
                          if (tools.length === 0) return null;

                          return (
                            <div key={serverId} className="rounded-sm border p-2">
                              <p className="mb-1 text-xs text-gray-600">
                                {t("playgroundAgents.chat.limitToolsFor", {
                                  server: server?.alias || server?.server_name || serverId,
                                })}
                              </p>
                              <MultiSelect
                                value={mcpServerToolRestrictions[serverId] || []}
                                onValueChange={(selectedTools) => {
                                  setMCPServerToolRestrictions((prev) => ({
                                    ...prev,
                                    [serverId]: selectedTools,
                                  }));
                                }}
                                placeholder={t("playgroundAgents.chat.allToolsDefault")}
                                options={tools.map((tool: { name: string }) => ({
                                  value: tool.name,
                                  label: tool.name,
                                }))}
                              />
                            </div>
                          );
                        })}
                      </div>
                    )}

                  {selectedMCPServers.length > 0 &&
                    !selectedMCPServers.includes("__all__") &&
                    selectedMCPServers.some((serverId) => {
                      const server = mcpServers.find((s) => s.server_id === serverId);
                      return server?.is_byok;
                    }) && (
                      <div className="mt-3 space-y-2">
                        {selectedMCPServers.map((serverId) => {
                          const server = mcpServers.find((s) => s.server_id === serverId);
                          if (!server?.is_byok) return null;
                          const serverName = server.alias || server.server_name || serverId;
                          return (
                            <div
                              key={serverId}
                              className="flex items-center justify-between rounded-sm border border-blue-100 bg-blue-50 p-2"
                            >
                              <p className="text-xs text-blue-700">
                                {t("playgroundAgents.chat.byokRequired", { server: serverName })}
                              </p>
                              {server.has_user_credential ? (
                                <div className="flex items-center gap-2">
                                  <span className="flex items-center gap-1 text-xs font-medium text-green-600">
                                    <Key className="size-3" /> {t("playgroundAgents.chat.connected")}
                                  </span>
                                  <button
                                    type="button"
                                    className="text-xs text-gray-400 underline hover:text-blue-500"
                                    onClick={() => setByokModalServer(server)}
                                  >
                                    {t("playgroundAgents.chat.reconnect")}
                                  </button>
                                </div>
                              ) : (
                                <Button
                                  type="button"
                                  size="xs"
                                  className="rounded-lg bg-blue-500 px-3 py-1 text-xs font-medium text-white hover:bg-blue-600"
                                  onClick={() => setByokModalServer(server)}
                                >
                                  {t("playgroundAgents.chat.connect")}
                                </Button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                </div>

                <div>
                  <div className="mb-2 flex items-center gap-1 text-sm font-medium text-gray-700">
                    <Database className="mr-1 size-4" aria-hidden="true" /> {t("playgroundAgents.chat.vectorStore")}
                    <Tooltip>
                      <TooltipTrigger aria-label={t("playgroundAgents.chat.vectorStoreHelp")}>
                        <Info className="size-3.5 text-gray-400" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        {t("playgroundAgents.chat.vectorStoreHelp")}{" "}
                        <a href="?page=vector-stores" className="text-blue-500 underline">
                          {t("playgroundAgents.chat.here")}
                        </a>
                        .
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <VectorStoreSelector
                    value={selectedVectorStores}
                    onChange={setSelectedVectorStores}
                    className="mb-4"
                    accessToken={accessToken || ""}
                  />
                </div>

                <div>
                  <div className="mb-2 flex items-center gap-1 text-sm font-medium text-gray-700">
                    <Shield className="mr-1 size-4" aria-hidden="true" /> {t("playgroundAgents.chat.guardrails")}
                    <Tooltip>
                      <TooltipTrigger aria-label={t("playgroundAgents.chat.guardrailsHelp")}>
                        <Info className="size-3.5 text-gray-400" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        {t("playgroundAgents.chat.guardrailsHelp")}{" "}
                        <a href="?page=guardrails" className="text-blue-500 underline">
                          {t("playgroundAgents.chat.here")}
                        </a>
                        .
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <GuardrailSelector
                    value={selectedGuardrails}
                    onChange={setSelectedGuardrails}
                    className="mb-4"
                    accessToken={accessToken || ""}
                  />
                </div>

                {canViewPolicies && (
                  <div>
                    <div className="mb-2 flex items-center gap-1 text-sm font-medium text-gray-700">
                      <Shield className="mr-1 size-4" aria-hidden="true" /> {t("playgroundAgents.chat.policies")}
                      <Tooltip>
                        <TooltipTrigger aria-label={t("playgroundAgents.chat.policiesHelp")}>
                          <Info className="size-3.5 text-gray-400" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          {t("playgroundAgents.chat.policiesHelp")}{" "}
                          <a href="?page=policies" className="text-blue-500 underline">
                            {t("playgroundAgents.chat.here")}
                          </a>
                          .
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <PolicySelector
                      value={selectedPolicies}
                      onChange={setSelectedPolicies}
                      className="mb-4"
                      accessToken={accessToken || ""}
                    />
                  </div>
                )}

                {endpointType === EndpointType.RESPONSES && (
                  <div>
                    <CodeInterpreterTool
                      accessToken={apiKeySource === "session" ? accessToken || "" : apiKey}
                      enabled={codeInterpreter.enabled}
                      onEnabledChange={codeInterpreter.setEnabled}
                      selectedContainerId={null}
                      onContainerChange={() => {}}
                      selectedModel={selectedModel || ""}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
            {endpointType === EndpointType.REALTIME ? (
              <RealtimePlayground
                accessToken={apiKeySource === "session" ? accessToken || "" : apiKey}
                selectedModel={selectedModel || ""}
                customProxyBaseUrl={customProxyBaseUrl || undefined}
                selectedGuardrails={selectedGuardrails.length > 0 ? selectedGuardrails : undefined}
              />
            ) : (
              <>
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-gray-200 p-3 sm:p-4">
                  <h2 className="mb-0 text-xl font-semibold">
                    {simplified ? t("playgroundAgents.chat.chat") : t("playgroundAgents.chat.testKey")}
                  </h2>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={clearChatHistory}>
                      <Eraser className="size-3.5" />
                      {t("playgroundAgents.chat.clearChat")}
                    </Button>
                    {!simplified && (
                      <Button type="button" variant="outline" size="sm" onClick={() => setIsGetCodeModalVisible(true)}>
                        <Code2 className="size-3.5" />
                        {t("playgroundAgents.chat.getCode")}
                      </Button>
                    )}
                  </div>
                </div>
                <div className="min-h-0 min-w-0 flex-1 overflow-auto p-3 pb-0 sm:p-4 sm:pb-0">
                  {chatHistory.length === 0 && (
                    <div className="flex h-full flex-col items-center justify-center text-gray-400">
                      <Bot className="mb-4 size-12" aria-hidden="true" />
                      <p className="text-sm">{t("playgroundAgents.chat.emptyState")}</p>
                    </div>
                  )}

                  {chatHistory.map((message, index) => (
                    <div key={index}>
                      <ChatMessageBubble
                        message={message}
                        isLastMessage={index === chatHistory.length - 1}
                        endpointType={endpointType as EndpointType}
                        mcpEvents={mcpEvents}
                        codeInterpreterResult={codeInterpreter.result}
                        accessToken={apiKeySource === "session" ? accessToken || "" : apiKey}
                      />
                    </div>
                  ))}

                  {isLoading &&
                    mcpEvents.length > 0 &&
                    (endpointType === EndpointType.RESPONSES || endpointType === EndpointType.CHAT) &&
                    chatHistory.length > 0 &&
                    chatHistory[chatHistory.length - 1].role === "user" && (
                      <div className="mb-4 text-left">
                        <div
                          className="inline-block max-w-[80%] rounded-lg p-3.5 px-4 shadow-xs"
                          style={{
                            backgroundColor: "#ffffff",
                            border: "1px solid #f0f0f0",
                            textAlign: "left",
                          }}
                        >
                          <div className="mb-1.5 flex items-center gap-2">
                            <div
                              className="mr-1 flex h-6 w-6 items-center justify-center rounded-full"
                              style={{ backgroundColor: "#f5f5f5" }}
                            >
                              <Bot className="size-3 text-gray-600" aria-hidden="true" />
                            </div>
                            <strong className="text-sm capitalize">{t("playgroundAgents.chat.assistant")}</strong>
                          </div>
                          <MCPEventsDisplay events={mcpEvents} />
                        </div>
                      </div>
                    )}

                  {isLoading && (
                    <div className="my-4 flex items-center justify-center">
                      <Loader2
                        className="size-6 animate-spin text-gray-500"
                        aria-label={t("playgroundAgents.chat.loading")}
                      />
                    </div>
                  )}
                  <div ref={chatEndRef} style={{ height: "1px" }} />
                </div>

                <div className="max-h-[50%] shrink-0 overflow-y-auto border-t border-gray-200 bg-white p-3 sm:p-4">
                  {endpointType === EndpointType.IMAGE_EDITS && (
                    <div className="mb-4">
                      {uploadedImages.length === 0 ? (
                        <label
                          className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center hover:border-gray-400"
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => {
                            event.preventDefault();
                            handleImageFiles(Array.from(event.dataTransfer.files));
                          }}
                        >
                          <ImageIcon className="mb-2 size-6 text-gray-500" aria-hidden="true" />
                          <p className="text-sm">{t("playgroundAgents.chat.imageUploadPrompt")}</p>
                          <p className="text-xs text-gray-500">{t("playgroundAgents.chat.imageEditUploadHelp")}</p>
                          <input
                            type="file"
                            accept={IMAGE_EDIT_ACCEPT}
                            multiple
                            className="sr-only"
                            onChange={(event) => {
                              handleImageFiles(Array.from(event.target.files || []));
                              event.target.value = "";
                            }}
                          />
                        </label>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {uploadedImages.map((file, index) => (
                            <div key={index} className="relative inline-block">
                              <img
                                src={(() => {
                                  const url = imagePreviewUrls[index];
                                  if (!url) return "";
                                  try {
                                    const parsed = new URL(url);
                                    return parsed.protocol === "blob:" ? parsed.href : "";
                                  } catch {
                                    return "";
                                  }
                                })()}
                                alt={t("playgroundAgents.chat.uploadPreview", { index: index + 1 })}
                                className="max-h-32 max-w-32 rounded-md border border-gray-200 object-cover"
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="icon-xs"
                                className="absolute top-1 right-1 bg-white text-red-500 hover:bg-red-50"
                                aria-label={t("playgroundAgents.chat.removeFile", { fileName: file.name })}
                                onClick={() => handleRemoveImage(index)}
                              >
                                <X className="size-3" />
                              </Button>
                            </div>
                          ))}
                          <label className="flex h-32 w-32 cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-gray-300 hover:border-gray-400">
                            <ImageIcon className="size-6 text-gray-500" aria-hidden="true" />
                            <p className="mt-1 text-xs text-gray-500">{t("playgroundAgents.chat.addMore")}</p>
                            <input
                              type="file"
                              accept={IMAGE_EDIT_ACCEPT}
                              multiple
                              className="sr-only"
                              onChange={(event) => {
                                handleImageFiles(Array.from(event.target.files || []));
                                event.target.value = "";
                              }}
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  )}

                  {endpointType === EndpointType.TRANSCRIPTION && (
                    <div className="mb-4">
                      {!uploadedAudio ? (
                        <label
                          className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center hover:border-gray-400"
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => {
                            event.preventDefault();
                            const file = event.dataTransfer.files[0];
                            if (file) {
                              handleAudioUpload(file);
                            }
                          }}
                        >
                          <Volume2 className="mb-2 size-6 text-gray-500" aria-hidden="true" />
                          <p className="text-sm">{t("playgroundAgents.chat.audioUploadPrompt")}</p>
                          <p className="text-xs text-gray-500">{t("playgroundAgents.chat.audioUploadHelp")}</p>
                          <input
                            type="file"
                            accept={AUDIO_ACCEPT}
                            className="sr-only"
                            onChange={handleAudioFileInputChange}
                          />
                        </label>
                      ) : (
                        <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                          <div className="flex flex-1 items-center gap-2">
                            <Volume2 className="size-5 text-gray-500" aria-hidden="true" />
                            <span className="text-sm font-medium">{uploadedAudio.name}</span>
                            <span className="text-xs text-gray-500">
                              ({(uploadedAudio.size / 1024 / 1024).toFixed(2)} MB)
                            </span>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            className="text-red-500"
                            onClick={handleRemoveAudio}
                          >
                            <Trash2 className="size-3" />
                            {t("playgroundAgents.chat.remove")}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {endpointType === EndpointType.RESPONSES && responsesUploadedImage && (
                    <FilePreviewCard
                      file={responsesUploadedImage}
                      previewUrl={responsesImagePreviewUrl}
                      onRemove={handleRemoveResponsesImage}
                    />
                  )}

                  {endpointType === EndpointType.CHAT && chatUploadedImage && (
                    <FilePreviewCard
                      file={chatUploadedImage}
                      previewUrl={chatImagePreviewUrl}
                      onRemove={handleRemoveChatImage}
                    />
                  )}

                  {endpointType === EndpointType.RESPONSES && codeInterpreter.enabled && (
                    <div className="mb-2 space-y-2">
                      <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-linear-to-r from-blue-50 to-purple-50 px-3 py-2">
                        <div className="flex items-center gap-2">
                          {isLoading ? (
                            <>
                              <Loader2 className="size-4 animate-spin text-blue-500" aria-hidden="true" />
                              <span className="text-sm font-medium text-blue-700">
                                {t("playgroundAgents.chat.codeInterpreter.running")}
                              </span>
                            </>
                          ) : (
                            <>
                              <Code2 className="size-4 text-blue-500" aria-hidden="true" />
                              <span className="text-sm font-medium text-blue-700">
                                {t("playgroundAgents.chat.codeInterpreter.active")}
                              </span>
                            </>
                          )}
                        </div>
                        <button
                          type="button"
                          className="text-xs text-blue-500 hover:text-blue-700"
                          onClick={() => codeInterpreter.setEnabled(false)}
                        >
                          {t("playgroundAgents.chat.disable")}
                        </button>
                      </div>
                      {!isLoading && (
                        <div className="flex flex-wrap gap-2">
                          {[
                            t("playgroundAgents.chat.prompts.salesChart"),
                            t("playgroundAgents.chat.prompts.gatewayBarChart"),
                            t("playgroundAgents.chat.prompts.pricingLineChart"),
                          ].map((prompt, idx) => (
                            <button
                              key={idx}
                              type="button"
                              className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600"
                              onClick={() => setInputMessage(prompt)} // lgtm[js/xss-through-dom]
                            >
                              {prompt}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <ChatComposer
                    value={inputMessage}
                    onChange={setInputMessage}
                    onSubmit={handleSendMessage}
                    onCancel={handleCancelRequest}
                    placeholder={inputPlaceholder}
                    disabled={isLoading}
                    isLoading={isLoading}
                    submitDisabled={sendDisabled}
                    showSuggestions={chatHistory.length === 0 && !isLoading && endpointType !== EndpointType.MCP}
                    suggestions={
                      endpointType === EndpointType.A2A_AGENTS
                        ? [
                            t("playgroundAgents.chat.prompts.agentHelp"),
                            t("playgroundAgents.chat.prompts.agentIntroduction"),
                            t("playgroundAgents.chat.prompts.agentTasks"),
                          ]
                        : [
                            t("playgroundAgents.chat.prompts.poem"),
                            t("playgroundAgents.chat.prompts.quantumComputing"),
                            t("playgroundAgents.chat.prompts.meetingEmail"),
                          ]
                    }
                    onSuggestionSelect={setInputMessage}
                    tools={
                      <>
                        {endpointType === EndpointType.RESPONSES && !responsesUploadedImage && (
                          <ResponsesImageUpload
                            responsesUploadedImage={responsesUploadedImage}
                            responsesImagePreviewUrl={responsesImagePreviewUrl}
                            onImageUpload={handleResponsesImageUpload}
                            onRemoveImage={handleRemoveResponsesImage}
                          />
                        )}
                        {endpointType === EndpointType.CHAT && !chatUploadedImage && (
                          <ChatImageUpload
                            chatUploadedImage={chatUploadedImage}
                            chatImagePreviewUrl={chatImagePreviewUrl}
                            onImageUpload={handleChatImageUpload}
                            onRemoveImage={handleRemoveChatImage}
                          />
                        )}
                        {endpointType === EndpointType.RESPONSES && (
                          <CodeInterpreterToggle
                            enabled={codeInterpreter.enabled}
                            onToggle={() => {
                              codeInterpreter.toggle();
                              if (!codeInterpreter.enabled) {
                                NotificationsManager.success(
                                  t("playgroundAgents.chat.codeInterpreter.enabledNotification"),
                                );
                              }
                            }}
                          />
                        )}
                      </>
                    }
                    body={
                      endpointType === EndpointType.MCP &&
                      selectedMCPServers.length === 1 &&
                      selectedMCPServers[0] !== "__all__" &&
                      selectedMCPDirectTool
                        ? (() => {
                            const rawSel = selectedMCPServers[0];
                            let toolPool: MCPTool[] = [];
                            if (rawSel.startsWith("toolset:")) {
                              const toolsetId = rawSel.slice("toolset:".length);
                              const toolset = mcpToolsets.find((t) => t.toolset_id === toolsetId);
                              if (toolset) {
                                const uniqueServerIds = [...new Set(toolset.tools.map((t) => t.server_id))];
                                uniqueServerIds.forEach((sid) => {
                                  toolPool = toolPool.concat((serverToolsMap[sid] || []) as MCPTool[]);
                                });
                              }
                            } else {
                              toolPool = (serverToolsMap[rawSel] || []) as MCPTool[];
                            }
                            const mcpTool = toolPool.find((t) => t.name === selectedMCPDirectTool);
                            return mcpTool ? (
                              <MCPToolArgumentsForm ref={mcpToolArgsFormRef} tool={mcpTool} className="space-y-2" />
                            ) : (
                              <div className="flex h-10 items-center justify-center text-sm text-gray-500">
                                {t("playgroundAgents.chat.loadingToolSchema")}
                              </div>
                            );
                          })()
                        : undefined
                    }
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <Dialog open={isGetCodeModalVisible} onOpenChange={setIsGetCodeModalVisible}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("playgroundAgents.chat.generatedCode")}</DialogTitle>
          </DialogHeader>
          <div className="my-2 flex items-end justify-between gap-3">
            <div>
              <p className="mb-1 text-sm font-medium text-gray-700">{t("playgroundAgents.chat.sdkType")}</p>
              <ShadcnSelect value={selectedSdk} onValueChange={(value) => setSelectedSdk(value as "openai" | "azure")}>
                <SelectTrigger className="w-[150px]" size="sm" aria-label={t("playgroundAgents.chat.sdkType")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI SDK</SelectItem>
                  <SelectItem value="azure">Azure SDK</SelectItem>
                </SelectContent>
              </ShadcnSelect>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(generatedCode).then(
                  () => NotificationsManager.success(t("playgroundAgents.chat.notifications.copied")),
                  () => NotificationsManager.error(t("playgroundAgents.chat.notifications.copyFailed")),
                );
              }}
            >
              {t("playgroundAgents.chat.copyToClipboard")}
            </Button>
          </div>
          <SyntaxHighlighter
            language="python"
            style={coy as Record<string, React.CSSProperties>}
            wrapLines={true}
            wrapLongLines={true}
            className="rounded-md"
            customStyle={{
              maxHeight: "60vh",
              overflowY: "auto",
            }}
          >
            {generatedCode}
          </SyntaxHighlighter>
        </DialogContent>
      </Dialog>

      {byokModalServer && (
        <ByokCredentialModal
          server={byokModalServer}
          open={!!byokModalServer}
          onClose={() => setByokModalServer(null)}
          onSuccess={(_serverId) => {
            loadMCPServers();
            setByokModalServer(null);
          }}
        />
      )}

      <Dialog open={isToolsetsInfoModalVisible} onOpenChange={setIsToolsetsInfoModalVisible}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("playgroundAgents.chat.toolsetsInfo.title")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-gray-700">
              <strong>{t("playgroundAgents.chat.toolsets")}</strong>{" "}
              {t("playgroundAgents.chat.toolsetsInfo.description")}
            </p>
            <div>
              <h4 className="mb-2 font-semibold text-gray-800">{t("playgroundAgents.chat.toolsetsInfo.usageTitle")}</h4>
              <ol className="list-inside list-decimal space-y-2 text-gray-700">
                <li>{t("playgroundAgents.chat.toolsetsInfo.stepSelect")}</li>
                <li>{t("playgroundAgents.chat.toolsetsInfo.stepChoose")}</li>
                <li>{t("playgroundAgents.chat.toolsetsInfo.stepParameters")}</li>
                <li>{t("playgroundAgents.chat.toolsetsInfo.stepRouting")}</li>
              </ol>
            </div>
            <div className="rounded-sm border border-purple-200 bg-purple-50 p-3">
              <p className="text-sm text-purple-800">
                <strong>{t("playgroundAgents.chat.toolsetsInfo.exampleLabel")}</strong>{" "}
                {t("playgroundAgents.chat.toolsetsInfo.examplePrefix")} <code>list_repos</code>{" "}
                {t("playgroundAgents.chat.toolsetsInfo.exampleAnd")} <code>get_file</code>{" "}
                {t("playgroundAgents.chat.toolsetsInfo.exampleSuffix")}
              </p>
            </div>
            <div>
              <h4 className="mb-1 font-semibold text-gray-800">
                {t("playgroundAgents.chat.toolsetsInfo.creatingTitle")}
              </h4>
              <p className="text-sm text-gray-600">{t("playgroundAgents.chat.toolsetsInfo.creatingDescription")}</p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsToolsetsInfoModalVisible(false)}>
              {t("playgroundAgents.chat.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ChatUI;
