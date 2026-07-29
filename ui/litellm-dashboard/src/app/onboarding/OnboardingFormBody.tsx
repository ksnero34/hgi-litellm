import React from "react";
import { Alert, Button, Card, Form, Input, Typography } from "antd";
import { useTranslation } from "react-i18next";

type OnboardingFormBodyProps = {
  variant: "signup" | "reset_password";
  userEmail: string;
  isPending: boolean;
  claimError: string | null;
  onSubmit: (values: { password: string }) => void;
};

export function OnboardingFormBody({ variant, userEmail, isPending, claimError, onSubmit }: OnboardingFormBodyProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm();

  React.useEffect(() => {
    if (userEmail) form.setFieldValue("user_email", userEmail);
  }, [userEmail, form]);

  return (
    <div className="mx-auto w-full max-w-md mt-10">
      <Card>
        <Typography.Title level={5} className="text-center mb-5">
          {t("app.name")}
        </Typography.Title>
        <Typography.Title level={3}>
          {variant === "reset_password" ? t("auth.onboarding.resetPassword.title") : t("auth.onboarding.signup.title")}
        </Typography.Title>
        <Typography.Text>
          {variant === "reset_password"
            ? t("auth.onboarding.resetPassword.subtitle")
            : t("auth.onboarding.signup.subtitle")}
        </Typography.Text>

        <Form
          className="mt-10 mb-5"
          layout="vertical"
          form={form}
          onFinish={(values) => onSubmit({ password: values.password })}
        >
          <Form.Item label={t("auth.onboarding.email.label")} name="user_email">
            <Input type="email" disabled />
          </Form.Item>

          <Form.Item
            label={t("auth.onboarding.password.label")}
            name="password"
            rules={[
              {
                required: true,
                message: t("auth.onboarding.password.required"),
              },
            ]}
            help={
              variant === "reset_password"
                ? t("auth.onboarding.resetPassword.passwordHelp")
                : t("auth.onboarding.signup.passwordHelp")
            }
          >
            <Input.Password />
          </Form.Item>

          {claimError && <Alert type="error" message={claimError} showIcon className="mb-4" />}

          <div className="mt-10">
            <Button htmlType="submit" loading={isPending}>
              {variant === "reset_password"
                ? t("auth.onboarding.resetPassword.submit")
                : t("auth.onboarding.signup.submit")}
            </Button>
          </div>
        </Form>
      </Card>
    </div>
  );
}
