import React, { useState } from "react";
import { CategoryFilter, PiiEntityList, QuickActions } from "./pii_components";
import { PiiConfigurationProps } from "@/components/guardrails/types";

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

  const handleCustomEntityKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    handleAddCustomEntity();
  };

  return (
    <div className="pii-configuration">
      <div className="flex justify-between items-center mb-5">
        <div className="flex items-center">
          <h4 className="m-0 text-lg font-semibold text-foreground">Configure PII Protection</h4>
        </div>
        <span className="text-muted-foreground">{selectedEntities.length} items selected</span>
      </div>

      <div className="mb-6">
        <div className="mb-5 rounded-lg border border-border bg-muted/40 p-5 shadow-xs">
          <label htmlFor="custom-pii-type" className="block text-sm font-medium text-foreground">
            Custom PII type
          </label>
          <p className="mb-3 text-sm text-muted-foreground">
            Enter the base entity label. Numbered Presidio results such as KORNAME1 and KORNAME2 will use the KORNAME
            policy.
          </p>
          <div className="flex gap-2">
            <input
              id="custom-pii-type"
              type="text"
              value={customEntity}
              onChange={(event) => setCustomEntity(event.target.value)}
              onKeyDown={handleCustomEntityKeyDown}
              placeholder="e.g. KORNAME"
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <button
              type="button"
              onClick={handleAddCustomEntity}
              disabled={!customEntity.trim()}
              className="inline-flex items-center justify-center rounded-md border border-border bg-background px-3 py-2 text-sm font-medium shadow-xs transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
            >
              Add
            </button>
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
