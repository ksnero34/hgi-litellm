import { Tab, TabGroup, TabList, TabPanel, TabPanels } from "@tremor/react";
import React, { useEffect, useState } from "react";

import { Button } from "antd";
import BulkEditUserModal from "./BulkEditUsers";
import { CreateUserButton } from "@/components/CreateUserButton";
import EditUserModal from "./edit_user";
import {
  getPossibleUserRoles,
  getProxyBaseUrl,
  invitationCreateCall,
  userListCall,
  UserListResponse,
  userUpdateUserCall,
} from "@/components/networking";
import OnboardingModal, { InvitationLink } from "@/components/onboarding_link";

import { updateExistingKeys } from "@/utils/dataUtils";
import { isAdminRole, isProxyAdminRole } from "@/utils/roles";
import { useDebouncedState } from "@tanstack/react-pacer/debouncer";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Typography } from "antd";
import DeleteResourceModal from "@/components/common_components/DeleteResourceModal";
import NotificationsManager from "@/components/molecules/notifications_manager";
import { modelAvailableCall, userDeleteCall } from "@/components/networking";
import DefaultUserSettings from "./DefaultUserSettings";
import { columns } from "./view_users/columns";
import { UserDataTable } from "./view_users/table";
import { UserInfo } from "@/components/networking";
import { Skeleton } from "antd";
import { useTranslation } from "react-i18next";

const { Text, Title } = Typography;

interface ViewUserDashboardProps {
  accessToken: string | null;
  token: string | null;
  userRole: string | null;
  userID: string | null;
  teams: any[] | null;
  orgAdminOrgIds?: Array<{ organization_id: string; organization_alias: string }> | null;
}

interface FilterState {
  email: string;
  user_id: string;
  user_role: string;
  sso_user_id: string;
  team: string;
  model: string;
  min_spend: number | null;
  max_spend: number | null;
  sort_by: string;
  sort_order: "asc" | "desc";
}

const DEFAULT_PAGE_SIZE = 25;

const initialFilters: FilterState = {
  email: "",
  user_id: "",
  user_role: "",
  sso_user_id: "",
  team: "",
  model: "",
  min_spend: null,
  max_spend: null,
  sort_by: "created_at",
  sort_order: "desc",
};

const ViewUserDashboard: React.FC<ViewUserDashboardProps> = ({
  accessToken,
  token,
  userRole,
  userID,
  teams,
  orgAdminOrgIds,
}) => {
  const { t } = useTranslation();
  const isProxyAdmin = userRole ? isProxyAdminRole(userRole) : false;
  const queryClient = useQueryClient();
  const [currentPage, setCurrentPage] = useState(1);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserInfo | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeletingUser, setIsDeletingUser] = useState(false);
  const [userToDelete, setUserToDelete] = useState<UserInfo | null>(null);
  const [activeTab, setActiveTab] = useState("users");
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [debouncedFilters, setDebouncedFilters, debouncer] = useDebouncedState(filters, { wait: 300 });
  const [isInvitationLinkModalVisible, setIsInvitationLinkModalVisible] = useState(false);
  const [invitationLinkData, setInvitationLinkData] = useState<InvitationLink | null>(null);
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [selectedUsers, setSelectedUsers] = useState<UserInfo[]>([]);
  const [isBulkEditModalVisible, setIsBulkEditModalVisible] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [userModels, setUserModels] = useState<string[]>([]);

  const handleDelete = (user: UserInfo) => {
    setUserToDelete(user);
    setIsDeleteModalOpen(true);
  };

  useEffect(() => {
    return () => {
      debouncer.cancel();
    };
  }, [debouncer]);

  useEffect(() => {
    setBaseUrl(getProxyBaseUrl());
  }, []);

  // Fetch available models for bulk edit
  useEffect(() => {
    const fetchUserModels = async () => {
      try {
        if (!userID || !userRole || !accessToken) {
          return;
        }

        const model_available = await modelAvailableCall(accessToken, userID, userRole);
        let available_model_names = model_available["data"].map((element: { id: string }) => element.id);
        setUserModels(available_model_names);
      } catch (error) {
        console.error("Error fetching user models:", error);
      }
    };

    fetchUserModels();
  }, [accessToken, userID, userRole]);

  const updateFilters = (update: Partial<FilterState>) => {
    setFilters((previousFilters) => {
      const newFilters = { ...previousFilters, ...update };
      setDebouncedFilters(newFilters);
      return newFilters;
    });
  };

  const handleSortChange = (sortBy: string, sortOrder: "asc" | "desc") => {
    updateFilters({ sort_by: sortBy, sort_order: sortOrder });
  };

  const handleResetPassword = async (userId: string) => {
    if (!accessToken) {
      NotificationsManager.fromBackend(t("identityAdmin.users.tokenMissing"));
      return;
    }
    try {
      NotificationsManager.success(t("identityAdmin.users.generatingReset"));
      const data = await invitationCreateCall(accessToken, userId);
      setInvitationLinkData(data);
      setIsInvitationLinkModalVisible(true);
    } catch (error) {
      NotificationsManager.fromBackend(t("identityAdmin.users.resetFailed"));
    }
  };

  const confirmDelete = async () => {
    if (userToDelete && accessToken) {
      try {
        setIsDeletingUser(true);
        await userDeleteCall(accessToken, [userToDelete.user_id]);

        // Update the user list after deletion
        queryClient.setQueriesData<UserListResponse>({ queryKey: ["userList"] }, (previousData) => {
          if (previousData === undefined) return previousData;
          const updatedUsers = previousData.users.filter((user) => user.user_id !== userToDelete.user_id);
          return { ...previousData, users: updatedUsers };
        });

        NotificationsManager.success(t("identityAdmin.users.deleted"));
      } catch (error) {
        console.error("Error deleting user:", error);
        NotificationsManager.fromBackend(t("identityAdmin.users.deleteFailed"));
      } finally {
        setIsDeleteModalOpen(false);
        setUserToDelete(null);
        setIsDeletingUser(false);
      }
    }
  };

  const cancelDelete = () => {
    setIsDeleteModalOpen(false);
    setUserToDelete(null);
  };

  const handleEditCancel = async () => {
    setSelectedUser(null);
    setEditModalVisible(false);
  };

  const handleEditSubmit = async (editedUser: any) => {
    if (!accessToken || !token || !userRole || !userID) {
      return;
    }

    try {
      const response = await userUpdateUserCall(accessToken, editedUser, null);
      queryClient.setQueriesData<UserListResponse>({ queryKey: ["userList"] }, (previousData) => {
        if (previousData === undefined) return previousData;
        const updatedUsers = previousData.users.map((user) => {
          if (user.user_id === response.data.user_id) {
            return updateExistingKeys(user, response.data);
          }
          return user;
        });

        return { ...previousData, users: updatedUsers };
      });

      NotificationsManager.success(t("identityAdmin.users.updated", { userId: editedUser.user_id }));
    } catch (error) {
      console.error("There was an error updating the user", error);
    }
    setSelectedUser(null);
    setEditModalVisible(false);
    // Close the modal
  };

  const handlePageChange = async (newPage: number) => {
    setCurrentPage(newPage);
  };

  const handleToggleSelectionMode = () => {
    setSelectionMode(!selectionMode);
    setSelectedUsers([]);
  };

  const handleSelectionChange = (users: UserInfo[]) => {
    setSelectedUsers(users);
  };

  const handleBulkEdit = () => {
    if (selectedUsers.length === 0) {
      NotificationsManager.fromBackend(t("identityAdmin.users.selectToEdit"));
      return;
    }

    setIsBulkEditModalVisible(true);
  };

  const handleBulkEditSuccess = () => {
    // Refresh the user list
    queryClient.invalidateQueries({ queryKey: ["userList"] });
    setSelectedUsers([]);
    setSelectionMode(false);
  };

  const userListQuery = useQuery({
    queryKey: ["userList", { debouncedFilter: debouncedFilters, currentPage, orgAdminOrgIds }],
    queryFn: async () => {
      if (!accessToken) throw new Error("Access token required");

      return await userListCall(
        accessToken,
        debouncedFilters.user_id ? [debouncedFilters.user_id] : null,
        currentPage,
        DEFAULT_PAGE_SIZE,
        debouncedFilters.email || null,
        debouncedFilters.user_role || null,
        debouncedFilters.team || null,
        debouncedFilters.sso_user_id || null,
        debouncedFilters.sort_by,
        debouncedFilters.sort_order,
        orgAdminOrgIds ? orgAdminOrgIds.map((o) => o.organization_id) : null,
      );
    },
    enabled: Boolean(accessToken && token && userRole && userID),
    placeholderData: (previousData) => previousData,
  });
  const userListResponse = userListQuery.data;

  const userRolesQuery = useQuery<Record<string, Record<string, string>>>({
    queryKey: ["userRoles"],
    initialData: () => ({}),
    queryFn: async () => {
      if (!accessToken) throw new Error("Access token required");
      return await getPossibleUserRoles(accessToken);
    },
    enabled: Boolean(accessToken && token && userRole && userID),
  });
  const possibleUIRoles = userRolesQuery.data;

  const tableColumns = columns(
    possibleUIRoles,
    (user) => {
      setSelectedUser(user);
      setEditModalVisible(true);
    },
    handleDelete,
    handleResetPassword,
    () => {}, // placeholder function, will be overridden in UserDataTable
  );

  return (
    <div className="w-full p-8 overflow-hidden">
      <div className="flex items-center justify-between mb-4">
        <div className="flex space-x-3">
          {userListQuery.isLoading ? (
            <>
              <Skeleton.Button active size="default" shape="default" style={{ width: 110, height: 36 }} />
              <Skeleton.Button active size="default" shape="default" style={{ width: 145, height: 36 }} />
              <Skeleton.Button active size="default" shape="default" style={{ width: 110, height: 36 }} />
            </>
          ) : userID && accessToken ? (
            <>
              {isProxyAdmin && (
                <CreateUserButton
                  userID={userID}
                  accessToken={accessToken}
                  teams={teams}
                  possibleUIRoles={possibleUIRoles}
                />
              )}

              {isProxyAdmin && (
                <Button
                  onClick={handleToggleSelectionMode}
                  type={selectionMode ? "primary" : "default"}
                  className="flex items-center"
                >
                  {selectionMode ? t("identityAdmin.users.cancelSelection") : t("identityAdmin.users.select")}
                </Button>
              )}

              {isProxyAdmin && selectionMode && (
                <Button
                  type="primary"
                  onClick={handleBulkEdit}
                  disabled={selectedUsers.length === 0}
                  className="flex items-center"
                >
                  {t("identityAdmin.users.bulkEdit", { count: selectedUsers.length })}
                </Button>
              )}
            </>
          ) : null}
        </div>
      </div>

      {isProxyAdmin ? (
        <TabGroup defaultIndex={0} onIndexChange={(index) => setActiveTab(index === 0 ? "users" : "settings")}>
          <TabList className="mb-4">
            <Tab>{t("identityAdmin.users.title")}</Tab>
            <Tab>{t("identityAdmin.users.defaultSettings")}</Tab>
          </TabList>

          <TabPanels>
            <TabPanel>
              <UserDataTable
                data={userListQuery.data?.users || []}
                columns={tableColumns}
                isLoading={userListQuery.isLoading}
                accessToken={accessToken}
                userRole={userRole}
                onSortChange={handleSortChange}
                currentSort={{
                  sortBy: filters.sort_by,
                  sortOrder: filters.sort_order,
                }}
                possibleUIRoles={possibleUIRoles}
                handleEdit={(user) => {
                  setSelectedUser(user);
                  setEditModalVisible(true);
                }}
                handleDelete={handleDelete}
                handleResetPassword={handleResetPassword}
                enableSelection={selectionMode}
                selectedUsers={selectedUsers}
                onSelectionChange={handleSelectionChange}
                filters={filters}
                updateFilters={updateFilters}
                initialFilters={initialFilters}
                teams={teams}
                userListResponse={userListResponse}
                currentPage={currentPage}
                handlePageChange={handlePageChange}
              />
            </TabPanel>

            <TabPanel>
              {!userID || !userRole || !accessToken ? (
                <div className="flex justify-center items-center h-64">
                  <Skeleton active paragraph={{ rows: 4 }} />
                </div>
              ) : (
                <DefaultUserSettings
                  accessToken={accessToken}
                  possibleUIRoles={possibleUIRoles}
                  userID={userID}
                  userRole={userRole}
                />
              )}
            </TabPanel>
          </TabPanels>
        </TabGroup>
      ) : (
        <UserDataTable
          data={userListQuery.data?.users || []}
          columns={tableColumns}
          isLoading={userListQuery.isLoading}
          accessToken={accessToken}
          userRole={userRole}
          onSortChange={handleSortChange}
          currentSort={{
            sortBy: filters.sort_by,
            sortOrder: filters.sort_order,
          }}
          possibleUIRoles={possibleUIRoles}
          handleEdit={(user) => {
            setSelectedUser(user);
            setEditModalVisible(true);
          }}
          handleDelete={handleDelete}
          handleResetPassword={handleResetPassword}
          enableSelection={false}
          selectedUsers={[]}
          onSelectionChange={handleSelectionChange}
          filters={filters}
          updateFilters={updateFilters}
          initialFilters={initialFilters}
          teams={teams}
          userListResponse={userListResponse}
          currentPage={currentPage}
          handlePageChange={handlePageChange}
        />
      )}

      {/* Existing Modals */}
      <EditUserModal
        visible={editModalVisible}
        possibleUIRoles={possibleUIRoles}
        onCancel={handleEditCancel}
        user={selectedUser}
        onSubmit={handleEditSubmit}
      />

      <DeleteResourceModal
        isOpen={isDeleteModalOpen}
        title={t("identityAdmin.users.deleteTitle")}
        message={t("identityAdmin.users.deleteMessage")}
        resourceInformationTitle={t("identityAdmin.users.info")}
        resourceInformation={[
          { label: t("identityAdmin.users.email"), value: userToDelete?.user_email },
          { label: t("identityAdmin.users.userId"), value: userToDelete?.user_id, code: true },
          {
            label: t("identityAdmin.users.globalRole"),
            value:
              (userToDelete && possibleUIRoles?.[userToDelete.user_role]?.ui_label) || userToDelete?.user_role || "-",
          },
          { label: t("identityAdmin.users.totalSpend"), value: userToDelete?.spend?.toFixed(2) },
        ]}
        onCancel={cancelDelete}
        onOk={confirmDelete}
        confirmLoading={isDeletingUser}
      />

      <OnboardingModal
        isInvitationLinkModalVisible={isInvitationLinkModalVisible}
        setIsInvitationLinkModalVisible={setIsInvitationLinkModalVisible}
        baseUrl={baseUrl || ""}
        invitationLinkData={invitationLinkData}
        modalType="resetPassword"
      />

      <BulkEditUserModal
        open={isBulkEditModalVisible}
        onCancel={() => setIsBulkEditModalVisible(false)}
        selectedUsers={selectedUsers}
        possibleUIRoles={possibleUIRoles}
        accessToken={accessToken}
        onSuccess={handleBulkEditSuccess}
        teams={teams}
        userRole={userRole}
        userModels={userModels}
        allowAllUsers={userRole ? isAdminRole(userRole) : false}
      />
    </div>
  );
};

export default ViewUserDashboard;
