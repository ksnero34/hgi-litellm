import { Text, Title } from "@tremor/react";
import PriceDataReload from "@/components/price_data_reload";
import React from "react";
import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import { useModelCostMap } from "../../hooks/models/useModelCostMap";
import { useTranslation } from "react-i18next";

const PriceDataManagementTab = () => {
  const { accessToken } = useAuthorized();
  const { t } = useTranslation();
  const { refetch: refetchModelCostMap } = useModelCostMap();

  return (
    <div>
      <div className="p-6">
        <div className="mb-6">
          <Title>{t("toolsModels.models.priceDataTitle")}</Title>
          <Text className="text-tremor-content">{t("toolsModels.models.priceDataDescription")}</Text>
        </div>
        <PriceDataReload
          accessToken={accessToken}
          onReloadSuccess={() => {
            refetchModelCostMap();
          }}
          buttonText={t("toolsModels.models.reloadPriceData")}
          size="middle"
          type="primary"
          className="w-full"
        />
      </div>
    </div>
  );
};

export default PriceDataManagementTab;
