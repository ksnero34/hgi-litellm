import { Button, Input, Typography } from "antd";
import React, { useState } from "react";
import { CategoryFilter, PiiEntityList, QuickActions } from "./pii_components";
import { PiiConfigurationProps } from "@/components/guardrails/types";

const { Title, Text } = Typography;

/**
 * A reusable component for rendering PII entity selection and action configuration
 * Used in both add and edit guardrail forms
 */
const PiiConfiguration: React.FC<PiiConfigurationProps> = ({
  entities,
  actions,
  selectedEntities,
  selectedActions,
  onEntitySelect,
  onActionSelect,
  entityCategories = [],
}) => {
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [customEntity, setCustomEntity] = useState("");
  const allEntities = Array.from(new Set([...entities, ...selectedEntities]));
  const customEntities = selectedEntities.filter((entity) => !entities.includes(entity));
  const allEntityCategories =
    customEntities.length === 0
      ? entityCategories
      : [...entityCategories, { category: "Custom", entities: customEntities }];

  const entityToCategoryMap = new Map<string, string>();
  allEntityCategories.forEach((category) => {
    category.entities.forEach((entity) => {
      entityToCategoryMap.set(entity, category.category);
    });
  });

  const filteredEntities = allEntities.filter((entity) => {
    return selectedCategories.length === 0 || selectedCategories.includes(entityToCategoryMap.get(entity) || "");
  });

  const handleSelectAll = (action: string) => {
    allEntities.forEach((entity) => {
      if (!selectedEntities.includes(entity)) {
        onEntitySelect(entity);
      }
      onActionSelect(entity, action);
    });
  };

  const handleUnselectAll = () => {
    selectedEntities.forEach((entity) => {
      onEntitySelect(entity);
    });
  };

  const handleAddCustomEntity = () => {
    const entity = customEntity.trim();
    if (!entity) return;
    if (!selectedEntities.includes(entity)) {
      onEntitySelect(entity);
      onActionSelect(entity, "MASK");
    }
    setCustomEntity("");
  };

  return (
    <div className="pii-configuration">
      <div className="flex justify-between items-center mb-5">
        <div className="flex items-center">
          <Title level={4} className="m-0! font-semibold text-gray-800">
            Configure PII Protection
          </Title>
        </div>
        <Text className="text-gray-500">{selectedEntities.length} items selected</Text>
      </div>

      <div className="mb-6">
        <div className="mb-5 rounded-lg border border-gray-200 bg-gray-50 p-4">
          <Text strong className="block text-gray-700">
            Custom PII type
          </Text>
          <Text type="secondary" className="mb-3 block">
            Enter the base entity label. Numbered Presidio results such as KORNAME1 and KORNAME2 will use the KORNAME
            policy.
          </Text>
          <div className="flex gap-2">
            <Input
              value={customEntity}
              onChange={(event) => setCustomEntity(event.target.value)}
              onPressEnter={(event) => {
                event.preventDefault();
                handleAddCustomEntity();
              }}
              placeholder="e.g. KORNAME"
              aria-label="Custom PII type"
            />
            <Button type="primary" onClick={handleAddCustomEntity} disabled={!customEntity.trim()}>
              Add
            </Button>
          </div>
        </div>

        <CategoryFilter
          categories={allEntityCategories}
          selectedCategories={selectedCategories}
          onChange={setSelectedCategories}
        />

        <QuickActions
          onSelectAll={handleSelectAll}
          onUnselectAll={handleUnselectAll}
          hasSelectedEntities={selectedEntities.length > 0}
        />
      </div>

      <PiiEntityList
        entities={filteredEntities}
        selectedEntities={selectedEntities}
        selectedActions={selectedActions}
        actions={actions}
        onEntitySelect={onEntitySelect}
        onActionSelect={onActionSelect}
        entityToCategoryMap={entityToCategoryMap}
      />
    </div>
  );
};

export default PiiConfiguration;
