import React, { PropsWithChildren } from "react";
import { render, RenderOptions } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import I18nProvider from "@/i18n/I18nProvider";

// Create a client for testing
const queryClient = new QueryClient({
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

const Providers: React.FC<PropsWithChildren> = ({ children }) => {
  return (
    <I18nProvider>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </I18nProvider>
  );
};

export const renderWithProviders = (ui: React.ReactElement, options?: RenderOptions) =>
  render(ui, { wrapper: Providers, ...options });

export * from "@testing-library/react";
