import React from "react";
import { Alert, Button } from "antd";
import { useTranslation } from "react-i18next";

export function OnboardingErrorView() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto w-full max-w-md mt-10">
      <Alert
        type="error"
        message={t("auth.onboarding.errorView.title", { defaultValue: "Failed to load invitation" })}
        description={t("auth.onboarding.errorView.description", {
          defaultValue: "The invitation link may be invalid or expired.",
        })}
        showIcon
      />
      <div className="mt-4">
        <Button href="/ui/login">
          {t("auth.onboarding.errorView.backToLogin", { defaultValue: "Back to Login" })}
        </Button>
      </div>
    </div>
  );
}
