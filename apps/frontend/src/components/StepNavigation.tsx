type StepNavigationProps = {
  currentStep: number;
  onStepChange: (step: number) => void;
};

const steps = ["可用时间", "任务录入", "冲突分析", "生成计划"];

export function StepNavigation({ currentStep, onStepChange }: StepNavigationProps) {
  return (
    <nav className="step-navigation panel" aria-label="规划步骤">
      <p className="section-label">Flow</p>
      <div className="step-navigation__list">
        {steps.map((label, index) => {
          const step = index + 1;
          const unavailable = step > currentStep;
          return (
            <button
              key={label}
              className="step-navigation__button"
              type="button"
              aria-current={step === currentStep ? "step" : undefined}
              disabled={unavailable}
              onClick={() => onStepChange(step)}
            >
              <span className="step-navigation__number" aria-hidden="true">{String(step).padStart(2, "0")}</span>
              {label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
