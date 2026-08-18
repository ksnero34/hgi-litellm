import React, { PropsWithChildren } from "react";
import { render, RenderOptions } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import I18nProvider from "@/i18n/I18nProvider";
import { NuqsTestingAdapter, OnUrlUpdateFunction } from "nuqs/adapters/testing";

// Create a client for testing
export const testQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      gcTime: Infinity,
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
    },
    mutations: {
      retry: false,
    },
  },
});

interface ProviderOptions {
  searchParams?: string | Record<string, string> | URLSearchParams;
  onUrlUpdate?: OnUrlUpdateFunction;
}

export const renderWithProviders = (ui: React.ReactElement, options?: RenderOptions & ProviderOptions) => {
  const { searchParams, onUrlUpdate, ...renderOptions } = options ?? {};
  const Providers: React.FC<PropsWithChildren> = ({ children }) => (
    <I18nProvider>
      <NuqsTestingAdapter searchParams={searchParams} onUrlUpdate={onUrlUpdate} hasMemory>
        <QueryClientProvider client={testQueryClient}>{children}</QueryClientProvider>
      </NuqsTestingAdapter>
    </I18nProvider>
  );
  return render(ui, { wrapper: Providers, ...renderOptions });
};

export * from "@testing-library/react";
