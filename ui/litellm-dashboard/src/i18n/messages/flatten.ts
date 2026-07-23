import type { MessageCatalog } from "./types";

type NestedMessageCatalog = {
  [key: string]: string | NestedMessageCatalog;
};

export function flattenMessages(namespace: string, messages: NestedMessageCatalog): MessageCatalog {
  const flattened: MessageCatalog = {};

  const visit = (prefix: string, value: string | NestedMessageCatalog) => {
    if (typeof value === "string") {
      flattened[prefix] = value;
      return;
    }

    Object.entries(value).forEach(([key, child]) => {
      visit(`${prefix}.${key}`, child);
    });
  };

  visit(namespace, messages);
  return flattened;
}
