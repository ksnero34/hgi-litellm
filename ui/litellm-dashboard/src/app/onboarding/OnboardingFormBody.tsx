import React from "react";
import { Alert, Button, Card, Form, Input, Typography } from "antd";

type OnboardingFormBodyProps = {
  variant: "signup" | "reset_password";
  userEmail: string;
  isPending: boolean;
  claimError: string | null;
  onSubmit: (values: { password: string }) => void;
};

export function OnboardingFormBody({ variant, userEmail, isPending, claimError, onSubmit }: OnboardingFormBodyProps) {
  const [form] = Form.useForm();

  React.useEffect(() => {
    if (userEmail) form.setFieldValue("user_email", userEmail);
  }, [userEmail, form]);

  return (
    <div className="mx-auto w-full max-w-md mt-10">
      <Card>
        <Typography.Title level={5} className="text-center mb-5">
          LLM Gateway
        </Typography.Title>
        <Typography.Title level={3}>{variant === "reset_password" ? "비밀번호 재설정" : "계정 등록"}</Typography.Title>
        <Typography.Text>
          {variant === "reset_password"
            ? "관리자 화면에 접속할 새 비밀번호를 설정하세요."
            : "관리자 화면에 로그인할 계정을 등록하세요."}
        </Typography.Text>

        <Form
          className="mt-10 mb-5"
          layout="vertical"
          form={form}
          onFinish={(values) => onSubmit({ password: values.password })}
        >
          <Form.Item label="이메일 주소" name="user_email">
            <Input type="email" disabled />
          </Form.Item>

          <Form.Item
            label="비밀번호"
            name="password"
            rules={[{ required: true, message: "비밀번호를 입력하세요" }]}
            help={variant === "reset_password" ? "새 비밀번호를 입력하세요" : "계정에 사용할 비밀번호를 입력하세요"}
          >
            <Input.Password />
          </Form.Item>

          {claimError && <Alert type="error" message={claimError} showIcon className="mb-4" />}

          <div className="mt-10">
            <Button htmlType="submit" loading={isPending}>
              {variant === "reset_password" ? "비밀번호 재설정" : "계정 등록"}
            </Button>
          </div>
        </Form>
      </Card>
    </div>
  );
}
