import React, { useEffect } from "react";
import { TextInput, Accordion, AccordionHeader, AccordionBody } from "@tremor/react";
import { Button as Button2, Modal, Form, InputNumber, Select } from "antd";
import { useUpdateBudget } from "@/app/(dashboard)/hooks/budgets/useBudgets";
import { budgetItem } from "@/app/(dashboard)/hooks/budgets/useBudgets";
import NotificationsManager from "@/components/molecules/notifications_manager";
import { useTranslation } from "react-i18next";

interface EditBudgetModalProps {
  isModalVisible: boolean;
  setIsModalVisible: React.Dispatch<React.SetStateAction<boolean>>;
  existingBudget: budgetItem;
}
const EditBudgetModal: React.FC<EditBudgetModalProps> = ({ isModalVisible, setIsModalVisible, existingBudget }) => {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const updateBudget = useUpdateBudget();

  useEffect(() => {
    form.setFieldsValue(existingBudget);
  }, [existingBudget, form]);

  const handleCancel = () => {
    setIsModalVisible(false);
    form.resetFields();
  };

  const handleUpdate = async (formValues: Record<string, any>) => {
    try {
      NotificationsManager.info(t("access.budgets.form.apiCall"));
      await updateBudget.mutateAsync(formValues);
      NotificationsManager.success(t("access.budgets.form.updateSuccess"));
      form.resetFields();
      setIsModalVisible(false);
    } catch (error) {
      console.error("Error updating the budget:", error);
      NotificationsManager.fromBackend(t("access.budgets.form.updateError", { error: String(error) }));
    }
  };

  return (
    <Modal
      title={t("access.budgets.form.editTitle")}
      open={isModalVisible}
      width={800}
      footer={null}
      onCancel={handleCancel}
    >
      <Form
        form={form}
        onFinish={handleUpdate}
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 16 }}
        labelAlign="left"
        initialValues={existingBudget}
      >
        <Form.Item
          label={t("access.budgets.form.budgetId")}
          name="budget_id"
          help={t("access.budgets.form.budgetIdLocked")}
        >
          <TextInput placeholder="" disabled={true} />
        </Form.Item>
        <Form.Item
          label={t("access.budgets.form.tpm")}
          name="tpm_limit"
          help={t("access.budgets.form.defaultModelLimit")}
        >
          <InputNumber step={1} precision={2} width={200} />
        </Form.Item>
        <Form.Item
          label={t("access.budgets.form.rpm")}
          name="rpm_limit"
          help={t("access.budgets.form.defaultModelLimit")}
        >
          <InputNumber step={1} precision={2} width={200} />
        </Form.Item>

        <Accordion className="mt-20 mb-8">
          <AccordionHeader>
            <b>{t("access.budgets.form.optional")}</b>
          </AccordionHeader>
          <AccordionBody>
            <Form.Item label={t("access.budgets.form.maxBudget")} name="max_budget">
              <InputNumber step={0.01} precision={2} width={200} />
            </Form.Item>
            <Form.Item className="mt-8" label={t("access.budgets.form.resetBudget")} name="budget_duration">
              <Select defaultValue={null} placeholder={t("access.budgets.form.resetPlaceholder")}>
                <Select.Option value="24h">{t("access.budgets.form.daily")}</Select.Option>
                <Select.Option value="7d">{t("access.budgets.form.weekly")}</Select.Option>
                <Select.Option value="30d">{t("access.budgets.form.monthly")}</Select.Option>
              </Select>
            </Form.Item>
          </AccordionBody>
        </Accordion>

        <div style={{ textAlign: "right", marginTop: "10px" }}>
          <Button2 htmlType="submit">{t("access.common.save")}</Button2>
        </div>
      </Form>
    </Modal>
  );
};

export default EditBudgetModal;
