import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SearchOutlined } from "@ant-design/icons";
import { SortingState } from "@tanstack/react-table";
import { Input, Select } from "antd";
import { Inbox } from "lucide-react";
import { Plugin } from "@/components/claude_code_plugins/types";
import { DataTable } from "@/components/shared/DataTable";
import { getSkillHubTableColumns } from "@/components/AIHub/SkillHubTableColumns";
import SkillDetail from "@/components/claude_code_plugins/skill_detail";

interface SkillHubDashboardProps {
  skills: Plugin[];
  isLoading: boolean;
  isAdmin?: boolean;
  accessToken?: string | null;
  publicPage?: boolean;
  onPublishSuccess?: () => void;
}

function SkillsEmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1 py-6">
      <div className="mb-1 flex size-10 items-center justify-center rounded-lg bg-muted">
        <Inbox className="size-5 text-muted-foreground" />
      </div>
      <div className="text-sm font-medium text-foreground">{filtered ? "No matching skills" : "No skills yet"}</div>
      <div className="text-sm text-muted-foreground">
        {filtered
          ? "Adjust the search or domain filter to see more skills."
          : "Skills added here will appear for developers."}
      </div>
    </div>
  );
}

const SkillHubDashboard: React.FC<SkillHubDashboardProps> = ({
  skills,
  isLoading,
  isAdmin,
  accessToken,
  publicPage = false,
  onPublishSuccess,
}) => {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [domainFilter, setDomainFilter] = useState<string | undefined>(undefined);
  const [selectedSkill, setSelectedSkill] = useState<Plugin | null>(null);
  const [sorting, setSorting] = useState<SortingState>([{ id: "name", desc: false }]);

  // Derived stats
  const totalSkills = skills.length;
  const domains = useMemo(() => [...new Set(skills.map((s) => s.domain).filter(Boolean))], [skills]);
  const namespaces = useMemo(() => [...new Set(skills.map((s) => s.namespace).filter(Boolean))], [skills]);

  // Filtered table data
  const filteredSkills = useMemo(() => {
    let result = skills;
    if (domainFilter) {
      result = result.filter((s) => (s.domain || "General") === domainFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description?.toLowerCase().includes(q) ||
          s.domain?.toLowerCase().includes(q) ||
          s.namespace?.toLowerCase().includes(q) ||
          s.keywords?.some((k) => k.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [skills, search, domainFilter]);

  const columns = useMemo(() => getSkillHubTableColumns({ onSkillClick: setSelectedSkill }), []);

  const hasActiveFilter = search.trim().length > 0 || domainFilter != null;

  if (selectedSkill) {
    return (
      <SkillDetail
        skill={selectedSkill}
        onBack={() => setSelectedSkill(null)}
        isAdmin={isAdmin}
        accessToken={accessToken}
        onPublishClick={onPublishSuccess}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        <div className="border border-gray-200 rounded-lg p-4">
          <div className="text-xs text-gray-500 mb-1">{t("hubSkills.dashboard.total")}</div>
          <div className="text-2xl font-semibold text-gray-900">{totalSkills}</div>
        </div>
        <div className="border border-gray-200 rounded-lg p-4">
          <div className="text-xs text-gray-500 mb-1">{t("hubSkills.dashboard.namespaces")}</div>
          <div className="text-2xl font-semibold text-gray-900">{namespaces.length}</div>
        </div>
        <div className="border border-gray-200 rounded-lg p-4">
          <div className="text-xs text-gray-500 mb-1">{t("hubSkills.dashboard.domains")}</div>
          <div className="text-2xl font-semibold text-gray-900">{domains.length}</div>
        </div>
      </div>

      {/* Search + filters + table */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">
            {t(publicPage ? "hubSkills.dashboard.allPublic" : "hubSkills.dashboard.all")}
          </h3>
          <div className="flex items-center gap-2">
            <Select
              placeholder={t("hubSkills.dashboard.allDomains")}
              allowClear
              value={domainFilter}
              onChange={(val) => setDomainFilter(val)}
              style={{ width: 160 }}
              options={domains.map((d) => ({ label: d, value: d }))}
            />
            <Input
              prefix={<SearchOutlined className="text-gray-400" />}
              placeholder={t("hubSkills.dashboard.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 280 }}
              allowClear
            />
          </div>
        </div>
        <DataTable
          data={filteredSkills}
          columns={columns}
          getRowId={(skill, index) => skill.id || String(index)}
          sortingMode="client"
          sorting={sorting}
          onSortingChange={setSorting}
          isLoading={isLoading}
          loadingMessage="Loading skills…"
          noDataMessage={<SkillsEmptyState filtered={hasActiveFilter} />}
          size="compact"
        />
        <div className="mt-3 text-center">
          <p className="text-sm text-gray-500">
            {t("hubSkills.dashboard.showing", { visible: filteredSkills.length, total: totalSkills })}
          </p>
        </div>
      </div>
    </div>
  );
};

export default SkillHubDashboard;
