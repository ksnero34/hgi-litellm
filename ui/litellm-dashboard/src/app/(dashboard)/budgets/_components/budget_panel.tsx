import {
  Button,
  Card,
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
} from "@tremor/react";
import React, { useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { useTranslation } from "react-i18next";
import DeleteResourceModal from "@/components/common_components/DeleteResourceModal";
import TableIconActionButton from "@/components/common_components/IconActionButton/TableIconActionButtons/TableIconActionButton";
import NotificationsManager from "@/components/molecules/notifications_manager";
import { useBudgets, useDeleteBudget, budgetItem } from "@/app/(dashboard)/hooks/budgets/useBudgets";
import { MoneyCell } from "@/components/shared/table_cells";
import BudgetModal from "./budget_modal";
import EditBudgetModal from "./edit_budget_modal";
import { CREATE_END_USER_CURL_COMMAND, CHAT_COMPLETIONS_CURL_COMMAND, OPENAI_SDK_PYTHON_CODE } from "./constants";
import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import { isProxyAdminRole } from "@/utils/roles";

interface BudgetSettingsPageProps {
  accessToken: string | null;
}

const BudgetPanel: React.FC<BudgetSettingsPageProps> = ({ accessToken }) => {
  const { t } = useTranslation();
  const [isCreateModelVisible, setIsCreateModelVisible] = useState(false);
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [selectedBudget, setSelectedBudget] = useState<budgetItem | null>(null);
  const [isDeleteModalVisible, setIsDeleteModalVisible] = useState(false);

  const { userRole } = useAuthorized();
  const canModify = isProxyAdminRole(userRole ?? "");

  const { data: budgetList = [] } = useBudgets();
  const deleteBudget = useDeleteBudget();

  const handleEditCall = async (budget: budgetItem) => {
    if (accessToken == null) {
      return;
    }
    setSelectedBudget(budget);
    setIsEditModalVisible(true);
  };

  const handleDeleteClick = (budget: budgetItem) => {
    setSelectedBudget(budget);
    setIsDeleteModalVisible(true);
  };

  const handleDeleteConfirm = async () => {
    if (!selectedBudget || accessToken == null) {
      return;
    }
    try {
      await deleteBudget.mutateAsync(selectedBudget.budget_id);
      NotificationsManager.success(t("access.budgets.deleted"));
    } catch (error) {
      console.error("Error deleting budget:", error);
      if (typeof NotificationsManager.fromBackend == "function") {
        NotificationsManager.fromBackend(t("access.budgets.deleteError"));
      } else {
        NotificationsManager.info(t("access.budgets.deleteError"));
      }
    } finally {
      setIsDeleteModalVisible(false);
      setSelectedBudget(null);
    }
  };

  return (
    <div className="w-full mx-auto flex-auto overflow-y-auto m-8 p-2">
      {canModify && (
        <Button size="sm" variant="primary" className="mb-2" onClick={() => setIsCreateModelVisible(true)}>
          + {t("access.budgets.create")}
        </Button>
      )}
      <TabGroup>
        <TabList>
          <Tab>{t("access.budgets.tabs.budgets")}</Tab>
          <Tab>{t("access.budgets.tabs.examples")}</Tab>
        </TabList>
        <TabPanels>
          <TabPanel>
            <div className="mt-6">
              <BudgetModal isModalVisible={isCreateModelVisible} setIsModalVisible={setIsCreateModelVisible} />
              {selectedBudget && (
                <EditBudgetModal
                  isModalVisible={isEditModalVisible}
                  setIsModalVisible={setIsEditModalVisible}
                  existingBudget={selectedBudget}
                />
              )}
              <Card>
                <Text>{t("access.budgets.subtitle")}</Text>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>{t("access.budgets.columns.id")}</TableHeaderCell>
                      <TableHeaderCell>{t("access.budgets.columns.maxBudget")}</TableHeaderCell>
                      <TableHeaderCell>{t("access.budgets.columns.tpm")}</TableHeaderCell>
                      <TableHeaderCell>{t("access.budgets.columns.rpm")}</TableHeaderCell>
                    </TableRow>
                  </TableHead>

                  <TableBody>
                    {budgetList
                      .slice()
                      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
                      .map((value: budgetItem) => (
                        <TableRow key={value.budget_id}>
                          <TableCell>{value.budget_id}</TableCell>
                          <TableCell>
                            <MoneyCell
                              value={value.max_budget}
                              decimals={2}
                              showZero
                              emptyText={t("access.common.unlimited")}
                            />
                          </TableCell>
                          <TableCell>{value.tpm_limit ? value.tpm_limit : t("access.common.notAvailable")}</TableCell>
                          <TableCell>{value.rpm_limit ? value.rpm_limit : t("access.common.notAvailable")}</TableCell>
                          {canModify && (
                            <>
                              <TableIconActionButton
                                variant="Edit"
                                tooltipText={t("access.budgets.actions.edit")}
                                onClick={() => handleEditCall(value)}
                                dataTestId="edit-budget-button"
                              />
                              <TableIconActionButton
                                variant="Delete"
                                tooltipText={t("access.budgets.actions.delete")}
                                onClick={() => handleDeleteClick(value)}
                                dataTestId="delete-budget-button"
                              />
                            </>
                          )}
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </Card>
              <DeleteResourceModal
                isOpen={isDeleteModalVisible}
                title={t("access.budgets.deleteTitle")}
                message={t("access.budgets.deleteMessage")}
                resourceInformationTitle={t("access.budgets.deleteInfo")}
                resourceInformation={[
                  { label: t("access.budgets.columns.id"), value: selectedBudget?.budget_id, code: true },
                  { label: t("access.budgets.columns.maxBudget"), value: selectedBudget?.max_budget },
                  { label: t("access.budgets.columns.tpm"), value: selectedBudget?.tpm_limit },
                  { label: t("access.budgets.columns.rpm"), value: selectedBudget?.rpm_limit },
                ]}
                onCancel={() => setIsDeleteModalVisible(false)}
                onOk={handleDeleteConfirm}
                confirmLoading={deleteBudget.isPending}
              />
            </div>
          </TabPanel>
          <TabPanel>
            <div className="mt-6">
              <Text className="text-base">{t("access.budgets.examples.title")}</Text>
              <TabGroup>
                <TabList>
                  <Tab>{t("access.budgets.examples.assign")}</Tab>
                  <Tab>{t("access.budgets.examples.curl")}</Tab>
                  <Tab>{t("access.budgets.examples.sdk")}</Tab>
                </TabList>
                <TabPanels>
                  <TabPanel>
                    <SyntaxHighlighter language="bash">{CREATE_END_USER_CURL_COMMAND}</SyntaxHighlighter>
                  </TabPanel>
                  <TabPanel>
                    <SyntaxHighlighter language="bash">{CHAT_COMPLETIONS_CURL_COMMAND}</SyntaxHighlighter>
                  </TabPanel>
                  <TabPanel>
                    <SyntaxHighlighter language="python">{OPENAI_SDK_PYTHON_CODE}</SyntaxHighlighter>
                  </TabPanel>
                </TabPanels>
              </TabGroup>
            </div>
          </TabPanel>
        </TabPanels>
      </TabGroup>
    </div>
  );
};

export default BudgetPanel;
