import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderWithProviders, screen } from "../../../tests/test-utils";
import KeyLifecycleSettings from "./KeyLifecycleSettings";

vi.mock("antd", () => {
  const Option = ({ children, value }: any) => <option value={value}>{children}</option>;
  const Select = ({ children, value, onChange, placeholder }: any) => (
    <select
      data-testid="select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      data-placeholder={placeholder}
    >
      {children}
    </select>
  );
  Select.Option = Option;
  return {
    Select,
    Tooltip: ({ children, title }: any) => (
      <div data-testid="tooltip" title={title}>
        {children}
      </div>
    ),
    Switch: ({ checked, onChange }: any) => (
      <input type="checkbox" data-testid="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    ),
    Divider: () => <hr data-testid="divider" />,
  };
});

vi.mock("@ant-design/icons", () => ({
  InfoCircleOutlined: () => <span data-testid="info-icon">ℹ</span>,
}));

vi.mock("@tremor/react", () => ({
  TextInput: ({ value, onValueChange, onChange, placeholder, name, className }: any) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (onChange) {
        onChange(e);
      }
      if (onValueChange) {
        onValueChange(e.target.value);
      }
    };
    return (
      <input
        data-testid={name === "duration" ? "duration-input" : "custom-interval-input"}
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        className={className}
      />
    );
  },
}));

describe("KeyLifecycleSettings", () => {
  const mockForm = {
    getFieldValue: vi.fn(),
    setFieldValue: vi.fn(),
    setFieldsValue: vi.fn(),
  };

  const defaultProps = {
    form: mockForm,
    autoRotationEnabled: false,
    onAutoRotationChange: vi.fn(),
    rotationInterval: "",
    onRotationIntervalChange: vi.fn(),
    isCreateMode: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockForm.getFieldValue.mockReturnValue("");
  });

  it("should render without crashing", () => {
    renderWithProviders(<KeyLifecycleSettings {...defaultProps} />);

    expect(screen.getByText("키 만료 설정")).toBeInTheDocument();
    expect(screen.getByText("자동 키 회전 설정")).toBeInTheDocument();
  });

  describe("Key Expiry Settings", () => {
    it("should render expiry input field", () => {
      renderWithProviders(<KeyLifecycleSettings {...defaultProps} />);

      expect(screen.getByText("키 만료")).toBeInTheDocument();
      expect(screen.getByTestId("duration-input")).toBeInTheDocument();
    });

    it("should show correct placeholder in create mode", () => {
      renderWithProviders(<KeyLifecycleSettings {...defaultProps} isCreateMode={true} />);

      const input = screen.getByTestId("duration-input");
      expect(input).toHaveAttribute("placeholder", "예: 30d, 만료하지 않으려면 비워 두기");
    });

    it("should show correct placeholder in edit mode", () => {
      renderWithProviders(<KeyLifecycleSettings {...defaultProps} isCreateMode={false} />);

      const input = screen.getByTestId("duration-input");
      expect(input).toHaveAttribute("placeholder", "예: 30d");
    });

    it("should show correct tooltip in create mode", () => {
      renderWithProviders(<KeyLifecycleSettings {...defaultProps} isCreateMode={true} />);

      const tooltips = screen.getAllByTestId("tooltip");
      const expiryTooltip = tooltips.find((tooltip) =>
        tooltip.getAttribute("title")?.includes("현재 값을 유지하려면 비워 두세요"),
      );
      expect(expiryTooltip).toBeInTheDocument();
      expect(expiryTooltip).toHaveAttribute(
        "title",
        "키 만료 시점을 설정합니다. 형식: 30s(초), 30m(분), 30h(시간), 30d(일). 현재 값을 유지하려면 비워 두세요.",
      );
    });

    it("should show correct tooltip in edit mode", () => {
      renderWithProviders(<KeyLifecycleSettings {...defaultProps} isCreateMode={false} />);

      const tooltips = screen.getAllByTestId("tooltip");
      const expiryTooltip = tooltips.find((tooltip) =>
        tooltip.getAttribute("title")?.includes("현재 값을 유지하려면 비워 두세요"),
      );
      expect(expiryTooltip).toBeInTheDocument();
      expect(expiryTooltip).toHaveAttribute(
        "title",
        "키 만료 시점을 설정합니다. 형식: 30s(초), 30m(분), 30h(시간), 30d(일). 현재 값을 유지하려면 비워 두세요.",
      );
    });

    it("should initialize with form value if present", () => {
      mockForm.getFieldValue.mockReturnValue("30d");
      renderWithProviders(<KeyLifecycleSettings {...defaultProps} />);

      const input = screen.getByTestId("duration-input") as HTMLInputElement;
      expect(input.value).toBe("30d");
    });

    it("should update form using setFieldValue when duration changes", async () => {
      const user = userEvent.setup();
      renderWithProviders(<KeyLifecycleSettings {...defaultProps} />);

      const input = screen.getByTestId("duration-input");
      await user.type(input, "60d");

      expect(mockForm.setFieldValue).toHaveBeenCalledWith("duration", "60d");
    });

    it("should update form using setFieldsValue when setFieldValue is not available", async () => {
      const user = userEvent.setup();
      const formWithoutSetFieldValue = {
        getFieldValue: vi.fn().mockReturnValue(""),
        setFieldsValue: vi.fn(),
      };
      renderWithProviders(<KeyLifecycleSettings {...defaultProps} form={formWithoutSetFieldValue} />);

      const input = screen.getByTestId("duration-input");
      await user.type(input, "90d");

      expect(formWithoutSetFieldValue.setFieldsValue).toHaveBeenCalledWith({ duration: "90d" });
    });
  });

  describe("Auto-Rotation Settings", () => {
    it("should render auto-rotation switch", () => {
      renderWithProviders(<KeyLifecycleSettings {...defaultProps} />);

      expect(screen.getByText("자동 키 회전 사용")).toBeInTheDocument();
      expect(screen.getByTestId("switch")).toBeInTheDocument();
    });

    it("should show switch as unchecked when autoRotationEnabled is false", () => {
      renderWithProviders(<KeyLifecycleSettings {...defaultProps} autoRotationEnabled={false} />);

      const switchElement = screen.getByTestId("switch") as HTMLInputElement;
      expect(switchElement.checked).toBe(false);
    });

    it("should show switch as checked when autoRotationEnabled is true", () => {
      renderWithProviders(<KeyLifecycleSettings {...defaultProps} autoRotationEnabled={true} />);

      const switchElement = screen.getByTestId("switch") as HTMLInputElement;
      expect(switchElement.checked).toBe(true);
    });

    it("should call onAutoRotationChange when switch is toggled", async () => {
      const user = userEvent.setup();
      const onAutoRotationChange = vi.fn();
      renderWithProviders(<KeyLifecycleSettings {...defaultProps} onAutoRotationChange={onAutoRotationChange} />);

      const switchElement = screen.getByTestId("switch");
      await user.click(switchElement);

      expect(onAutoRotationChange).toHaveBeenCalledWith(true);
    });

    it("should not show rotation interval section when auto-rotation is disabled", () => {
      renderWithProviders(<KeyLifecycleSettings {...defaultProps} autoRotationEnabled={false} />);

      expect(screen.queryByText("회전 주기")).not.toBeInTheDocument();
      expect(screen.queryByTestId("select")).not.toBeInTheDocument();
    });

    it("should show rotation interval section when auto-rotation is enabled", () => {
      renderWithProviders(<KeyLifecycleSettings {...defaultProps} autoRotationEnabled={true} rotationInterval="30d" />);

      expect(screen.getByText("회전 주기")).toBeInTheDocument();
      expect(screen.getByTestId("select")).toBeInTheDocument();
    });

    it("should show all predefined interval options", () => {
      renderWithProviders(<KeyLifecycleSettings {...defaultProps} autoRotationEnabled={true} rotationInterval="30d" />);

      expect(screen.getByText("7일")).toBeInTheDocument();
      expect(screen.getByText("30일")).toBeInTheDocument();
      expect(screen.getByText("90일")).toBeInTheDocument();
      expect(screen.getByText("180일")).toBeInTheDocument();
      expect(screen.getByText("365일")).toBeInTheDocument();
      expect(screen.getByText("직접 입력")).toBeInTheDocument();
    });

    it("should display current rotation interval in select", () => {
      renderWithProviders(<KeyLifecycleSettings {...defaultProps} autoRotationEnabled={true} rotationInterval="90d" />);

      const select = screen.getByTestId("select") as HTMLSelectElement;
      expect(select.value).toBe("90d");
    });

    it("should call onRotationIntervalChange when predefined interval is selected", async () => {
      const user = userEvent.setup();
      const onRotationIntervalChange = vi.fn();
      renderWithProviders(
        <KeyLifecycleSettings
          {...defaultProps}
          autoRotationEnabled={true}
          rotationInterval="7d"
          onRotationIntervalChange={onRotationIntervalChange}
        />,
      );

      const select = screen.getByTestId("select");
      await user.selectOptions(select, "30d");

      expect(onRotationIntervalChange).toHaveBeenCalledWith("30d");
    });

    it("should show custom input when custom option is selected", async () => {
      const user = userEvent.setup();
      renderWithProviders(<KeyLifecycleSettings {...defaultProps} autoRotationEnabled={true} rotationInterval="30d" />);

      const select = screen.getByTestId("select");
      await user.selectOptions(select, "custom");

      expect(screen.getByTestId("custom-interval-input")).toBeInTheDocument();
      expect(screen.getByText("지원 형식: 초(s), 분(m), 시간(h), 일(d)")).toBeInTheDocument();
    });

    it("should hide custom input when predefined interval is selected after custom", async () => {
      const user = userEvent.setup();
      const onRotationIntervalChange = vi.fn();
      renderWithProviders(
        <KeyLifecycleSettings
          {...defaultProps}
          autoRotationEnabled={true}
          rotationInterval="custom-value"
          onRotationIntervalChange={onRotationIntervalChange}
        />,
      );

      const select = screen.getByTestId("select");
      await user.selectOptions(select, "7d");

      expect(screen.queryByTestId("custom-interval-input")).not.toBeInTheDocument();
      expect(onRotationIntervalChange).toHaveBeenCalledWith("7d");
    });

    it("should call onRotationIntervalChange when custom interval is entered", async () => {
      const user = userEvent.setup();
      const onRotationIntervalChange = vi.fn();
      renderWithProviders(
        <KeyLifecycleSettings
          {...defaultProps}
          autoRotationEnabled={true}
          rotationInterval=""
          onRotationIntervalChange={onRotationIntervalChange}
        />,
      );

      const select = screen.getByTestId("select");
      await user.selectOptions(select, "custom");

      const customInput = screen.getByTestId("custom-interval-input");
      await user.type(customInput, "14d");

      expect(onRotationIntervalChange).toHaveBeenCalledWith("14d");
    });

    it("should show info message when auto-rotation is enabled", () => {
      renderWithProviders(<KeyLifecycleSettings {...defaultProps} autoRotationEnabled={true} />);

      expect(
        screen.getByText(
          "키가 회전되면 새 키가 발급됩니다. 기존 키는 기본 72시간의 유예 기간이 끝난 뒤 비활성화됩니다.",
        ),
      ).toBeInTheDocument();
    });

    it("should not show info message when auto-rotation is disabled", () => {
      renderWithProviders(<KeyLifecycleSettings {...defaultProps} autoRotationEnabled={false} />);

      expect(
        screen.queryByText(
          "키가 회전되면 새 키가 발급됩니다. 기존 키는 기본 72시간의 유예 기간이 끝난 뒤 비활성화됩니다.",
        ),
      ).not.toBeInTheDocument();
    });

    it("should initialize with custom interval input visible when custom interval is provided", () => {
      renderWithProviders(<KeyLifecycleSettings {...defaultProps} autoRotationEnabled={true} rotationInterval="14d" />);

      expect(screen.getByTestId("custom-interval-input")).toBeInTheDocument();
      const customInput = screen.getByTestId("custom-interval-input") as HTMLInputElement;
      expect(customInput.value).toBe("14d");
    });

    it("should show custom option selected when custom interval is provided", () => {
      renderWithProviders(<KeyLifecycleSettings {...defaultProps} autoRotationEnabled={true} rotationInterval="14d" />);

      const select = screen.getByTestId("select") as HTMLSelectElement;
      expect(select.value).toBe("custom");
    });

    it("should not call onRotationIntervalChange when selecting custom option", async () => {
      const user = userEvent.setup();
      const onRotationIntervalChange = vi.fn();
      renderWithProviders(
        <KeyLifecycleSettings
          {...defaultProps}
          autoRotationEnabled={true}
          rotationInterval="30d"
          onRotationIntervalChange={onRotationIntervalChange}
        />,
      );

      const select = screen.getByTestId("select");
      await user.selectOptions(select, "custom");

      expect(onRotationIntervalChange).not.toHaveBeenCalled();
    });
  });
});
