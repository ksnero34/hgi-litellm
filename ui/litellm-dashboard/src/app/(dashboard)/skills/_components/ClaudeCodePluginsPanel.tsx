import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@tremor/react";
import { Modal } from "antd";
import { getClaudeCodePluginsList, deleteClaudeCodePlugin } from "@/components/networking";
import AddPluginForm from "./add_plugin_form";
import PluginTable from "./plugin_table";
import SkillDetail from "@/components/claude_code_plugins/skill_detail";
import { isAdminRole } from "@/utils/roles";
import NotificationsManager from "@/components/molecules/notifications_manager";
import { Plugin, ListPluginsResponse } from "@/components/claude_code_plugins/types";

interface ClaudeCodePluginsPanelProps {
  accessToken: string | null;
  userRole?: string;
}

const ClaudeCodePluginsPanel: React.FC<ClaudeCodePluginsPanelProps> = ({ accessToken, userRole }) => {
  const { t } = useTranslation();
  const [pluginsList, setPluginsList] = useState<Plugin[]>([]);
  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [pluginToDelete, setPluginToDelete] = useState<{
    name: string;
    displayName: string;
  } | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<Plugin | null>(null);

  const isAdmin = userRole ? isAdminRole(userRole) : false;

  const fetchPlugins = async () => {
    if (!accessToken) return;

    setIsLoading(true);
    try {
      const response: ListPluginsResponse = await getClaudeCodePluginsList(accessToken, false);
      setPluginsList(response.plugins);
    } catch (error) {
      console.error("Error fetching skills:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPlugins();
  }, [accessToken]);

  const handleDeleteClick = (pluginName: string, displayName: string) => {
    setPluginToDelete({ name: pluginName, displayName });
  };

  const handleDeleteConfirm = async () => {
    if (!pluginToDelete || !accessToken) return;

    setIsDeleting(true);
    try {
      await deleteClaudeCodePlugin(accessToken, pluginToDelete.name);
      NotificationsManager.success(t("hubSkills.skills.deleteSuccess", { name: pluginToDelete.displayName }));
      fetchPlugins();
    } catch (error) {
      console.error("Error deleting skill:", error);
      NotificationsManager.error(t("hubSkills.skills.deleteError"));
    } finally {
      setIsDeleting(false);
      setPluginToDelete(null);
    }
  };

  return (
    <div className="w-full mx-auto flex-auto overflow-y-auto m-8 p-2">
      {selectedSkill ? (
        <SkillDetail
          skill={selectedSkill}
          onBack={() => setSelectedSkill(null)}
          isAdmin={isAdmin}
          accessToken={accessToken}
          onPublishClick={fetchPlugins}
        />
      ) : (
        <>
          <div className="flex flex-col gap-2 mb-4">
            <h1 className="text-2xl font-bold">{t("hubSkills.skills.title")}</h1>
            <p className="text-sm text-gray-600">
              {t("hubSkills.skills.subtitle")}{" "}
              <code className="bg-gray-100 px-1 rounded-sm">/claude-code/marketplace.json</code>.
            </p>
            <div className="mt-2 flex gap-2">
              <Button onClick={() => setIsAddModalVisible(true)} disabled={!accessToken || !isAdmin}>
                + {t("hubSkills.skills.add")}
              </Button>
            </div>
          </div>

          <PluginTable
            pluginsList={pluginsList}
            isLoading={isLoading}
            onDeleteClick={handleDeleteClick}
            accessToken={accessToken}
            isAdmin={isAdmin}
            onPluginClick={(id) => {
              const skill = pluginsList.find((p) => p.id === id);
              if (skill) setSelectedSkill(skill);
            }}
          />
        </>
      )}

      <AddPluginForm
        visible={isAddModalVisible}
        onClose={() => setIsAddModalVisible(false)}
        accessToken={accessToken}
        onSuccess={fetchPlugins}
      />

      {pluginToDelete && (
        <Modal
          title={t("hubSkills.skills.deleteTitle")}
          open={pluginToDelete !== null}
          onOk={handleDeleteConfirm}
          onCancel={() => setPluginToDelete(null)}
          confirmLoading={isDeleting}
          okText={t("hubSkills.common.delete")}
          okButtonProps={{ danger: true }}
        >
          <p>{t("hubSkills.skills.deleteConfirm", { name: pluginToDelete.displayName })}</p>
          <p>{t("hubSkills.skills.deleteWarning")}</p>
        </Modal>
      )}
    </div>
  );
};

export default ClaudeCodePluginsPanel;
