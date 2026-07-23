import React, { useEffect, useState } from "react";
import { Select } from "antd";
import { useTranslation } from "react-i18next";
import { Guardrail } from "./types";
import { getGuardrailsList } from "../networking";

interface GuardrailSelectorProps {
  onChange: (selectedGuardrails: string[]) => void;
  value?: string[];
  className?: string;
  accessToken: string;
  disabled?: boolean;
}

const GuardrailSelector: React.FC<GuardrailSelectorProps> = ({ onChange, value, className, accessToken, disabled }) => {
  const { t } = useTranslation();
  const [guardrails, setGuardrails] = useState<Guardrail[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchGuardrails = async () => {
      if (!accessToken) return;

      setLoading(true);
      try {
        const response = await getGuardrailsList(accessToken);
        if (response.guardrails) {
          setGuardrails(response.guardrails);
        }
      } catch (error) {
        console.error("Error fetching guardrails:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchGuardrails();
  }, [accessToken]);

  const handleGuardrailChange = (selectedValues: string[]) => {
    onChange(selectedValues);
  };

  return (
    <div>
      <Select
        mode="multiple"
        disabled={disabled}
        placeholder={
          disabled ? t("gateway.guardrailSelector.disabledPlaceholder") : t("gateway.guardrailSelector.placeholder")
        }
        onChange={handleGuardrailChange}
        value={value}
        loading={loading}
        className={className}
        allowClear
        options={guardrails.map((guardrail) => {
          return {
            label: `${guardrail.guardrail_name}`,
            value: guardrail.guardrail_name,
          };
        })}
        optionFilterProp="label"
        showSearch
        style={{ width: "100%" }}
      />
    </div>
  );
};

export default GuardrailSelector;
