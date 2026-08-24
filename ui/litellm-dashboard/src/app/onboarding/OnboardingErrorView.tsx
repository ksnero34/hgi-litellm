import React from "react";
import { CircleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/shared/Alert";
import { buttonVariants } from "@/components/ui/button";
import { getLoginUrl } from "@/utils/returnUrlUtils";
import { useTranslation } from "react-i18next";

export function OnboardingErrorView() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto w-full max-w-md mt-10">
      <Alert variant="error">
        <CircleAlert />
        <AlertTitle>{t("auth.onboarding.errorView.title")}</AlertTitle>
        <AlertDescription>{t("auth.onboarding.errorView.description")}</AlertDescription>
      </Alert>
      <div className="mt-4">
        <a href={getLoginUrl()} className={buttonVariants({ variant: "outline" })}>
          {t("auth.onboarding.errorView.backToLogin")}
        </a>
      </div>
    </div>
  );
}
