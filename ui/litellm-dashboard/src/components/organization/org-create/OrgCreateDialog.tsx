"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { organizationKeys } from "@/app/(dashboard)/hooks/organizations/useOrganizations";
import { ModelSelect } from "@/components/ModelSelect/ModelSelect";
import MCPServerSelector from "@/components/mcp_server_management/MCPServerSelector";
import NotificationsManager from "@/components/molecules/notifications_manager";
import { FieldGroup } from "@/components/shared/form/field";
import { FormField } from "@/components/shared/form/FormField";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import VectorStoreSelector from "@/components/vector_store_management/VectorStoreSelector";
import { useZodForm } from "@/lib/forms/useZodForm";
import { fetchClient } from "@/lib/http/api";
import { useTranslation } from "react-i18next";

import { getBudgetDurationOptions, NO_RESET } from "../org-settings/OrgSettingsForm";
import { orgSettingsSchema } from "../org-settings/schema";
import { buildOrgCreateBody, emptyOrgFormValues, type OrgCreateBody } from "./mapper";

const defaultCreateOrganization = async (body: OrgCreateBody): Promise<unknown> => {
  const { data } = await fetchClient.POST("/organization/new", { body });
  return data;
};

interface OrgCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accessToken: string;
  createOrganization?: (body: OrgCreateBody) => Promise<unknown>;
}

export const OrgCreateDialog = ({
  open,
  onOpenChange,
  accessToken,
  createOrganization = defaultCreateOrganization,
}: OrgCreateDialogProps) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const form = useZodForm(orgSettingsSchema, { defaultValues: emptyOrgFormValues });
  const budgetDurationOptions = React.useMemo(() => getBudgetDurationOptions(t), [t]);

  const closeAndReset = () => {
    form.reset(emptyOrgFormValues);
    onOpenChange(false);
  };

  const mutation = useMutation({
    mutationFn: (body: OrgCreateBody) => createOrganization(body),
    onSuccess: () => {
      NotificationsManager.success(t("identityAdmin.organization.created"));
      queryClient.invalidateQueries({ queryKey: organizationKeys.all });
      closeAndReset();
    },
    onError: (error: unknown) =>
      NotificationsManager.fromBackend(
        error instanceof Error ? error.message : t("identityAdmin.organization.createFailed"),
      ),
  });

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && mutation.isPending) return;
    if (!nextOpen) {
      form.reset(emptyOrgFormValues);
    }
    onOpenChange(nextOpen);
  };

  const onSubmit = form.handleSubmit((values) => {
    if (mutation.isPending) return;
    mutation.mutate(buildOrgCreateBody(values));
  });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("identityAdmin.organization.create")}</DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <FormField control={form.control} name="organization_alias" label={t("identityAdmin.organization.name")}>
              {({ ref, ...field }) => <Input {...field} ref={ref} />}
            </FormField>

            <FormField control={form.control} name="models" label={t("identityAdmin.organization.models")}>
              {(field) => (
                <ModelSelect
                  value={field.value}
                  onChange={field.onChange}
                  context="organization"
                  options={{ includeSpecialOptions: true, showAllProxyModelsOverride: true }}
                />
              )}
            </FormField>

            <FormField control={form.control} name="max_budget" label={t("identityAdmin.organization.form.maxBudget")}>
              {({ ref, ...field }) => <Input {...field} ref={ref} type="number" step="any" min={0} />}
            </FormField>

            <FormField
              control={form.control}
              name="budget_duration"
              label={t("identityAdmin.organization.form.resetBudget")}
            >
              {({ id, value, onChange, "aria-invalid": ariaInvalid, "aria-describedby": ariaDescribedBy }) => (
                <Select
                  items={budgetDurationOptions}
                  value={value === "" ? NO_RESET : value}
                  onValueChange={(selected) => onChange(selected === NO_RESET ? "" : selected)}
                >
                  <SelectTrigger id={id} aria-invalid={ariaInvalid} aria-describedby={ariaDescribedBy}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {budgetDurationOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>

            <FormField control={form.control} name="tpm_limit" label={t("identityAdmin.organization.form.tpmLimit")}>
              {({ ref, ...field }) => <Input {...field} ref={ref} type="number" step={1} min={0} />}
            </FormField>

            <FormField control={form.control} name="rpm_limit" label={t("identityAdmin.organization.form.rpmLimit")}>
              {({ ref, ...field }) => <Input {...field} ref={ref} type="number" step={1} min={0} />}
            </FormField>

            <FormField
              control={form.control}
              name="vector_stores"
              label={t("identityAdmin.organization.form.allowedVectorStores")}
              description={t("identityAdmin.organization.form.allowedVectorStoresDescription")}
            >
              {(field) => (
                <VectorStoreSelector
                  value={field.value}
                  onChange={field.onChange}
                  accessToken={accessToken}
                  placeholder={t("identityAdmin.organization.form.allowedVectorStoresPlaceholder")}
                />
              )}
            </FormField>

            <FormField
              control={form.control}
              name="mcp"
              label={t("identityAdmin.organization.form.allowedMcpServers")}
              description={t("identityAdmin.organization.form.allowedMcpServersDescription")}
            >
              {(field) => (
                <MCPServerSelector
                  value={field.value}
                  onChange={field.onChange}
                  accessToken={accessToken}
                  placeholder={t("identityAdmin.organization.form.allowedMcpServersPlaceholder")}
                />
              )}
            </FormField>

            <FormField control={form.control} name="metadata" label={t("identityAdmin.createUser.metadata")}>
              {({ ref, ...field }) => <Textarea {...field} ref={ref} rows={4} />}
            </FormField>
          </FieldGroup>

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={mutation.isPending}
            >
              {t("identityAdmin.team.cancel")}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? t("identityAdmin.organization.creating") : t("identityAdmin.organization.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
