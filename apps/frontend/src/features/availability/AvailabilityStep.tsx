import { useMemo, useState } from "react";
import type { ApiClient, AvailabilityDefinition, AvailabilityRule } from "../../api/client.js";

const timezones = ["Asia/Shanghai", "Asia/Tokyo", "Europe/London", "America/New_York"];
const weekdays = [
  { weekday: 1, label: "周一" }, { weekday: 2, label: "周二" }, { weekday: 3, label: "周三" },
  { weekday: 4, label: "周四" }, { weekday: 5, label: "周五" }, { weekday: 6, label: "周六" }, { weekday: 7, label: "周日" },
];

function browserTimezone(): string {
  if (typeof globalThis.Intl === "undefined" || typeof globalThis.Intl.DateTimeFormat !== "function") return "Asia/Shanghai";
  try {
    const timezone = globalThis.Intl.DateTimeFormat().resolvedOptions().timeZone;
    return timezones.includes(timezone) ? timezone : "Asia/Shanghai";
  } catch {
    return "Asia/Shanghai";
  }
}

function serverErrors(error: unknown): Record<string, string> {
  const apiError = error as { message?: string; fieldErrors?: Record<string, string> };
  const fieldErrors = apiError.fieldErrors ?? {};
  const messages = Object.values(fieldErrors);
  return { ...fieldErrors, form: messages.length ? messages.join(" ") : apiError.message ?? "保存失败" };
}

type AvailabilityStepProps = {
  api: Pick<ApiClient, "putAvailability">;
  onSaved: (availability: AvailabilityDefinition) => void;
};

export function AvailabilityStep({ api, onSaved }: AvailabilityStepProps) {
  const [timezone, setTimezone] = useState(browserTimezone);
  const [rules, setRules] = useState<AvailabilityRule[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const selectedDays = useMemo(() => new Set(rules.map((rule) => rule.weekday)), [rules]);

  const setDay = (weekday: number, checked: boolean) => {
    setRules((current) => checked
      ? [...current, { id: `weekly-${weekday}`, weekday, startLocalTime: "", endLocalTime: "", timezone }]
      : current.filter((rule) => rule.weekday !== weekday));
  };
  const setRule = (weekday: number, field: "startLocalTime" | "endLocalTime", value: string) => {
    setRules((current) => current.map((rule) => rule.weekday === weekday ? { ...rule, [field]: value } : rule));
  };
  const setTimezoneForRules = (nextTimezone: string) => {
    setTimezone(nextTimezone);
    setRules((current) => current.map((rule) => ({ ...rule, timezone: nextTimezone })));
  };

  const save = async () => {
    const errors: Record<string, string> = {};
    if (!rules.length) errors.rules = "请至少添加一段可用时间";
    rules.forEach((rule) => {
      if (!rule.startLocalTime || !rule.endLocalTime || rule.startLocalTime >= rule.endLocalTime) errors[`rule-${rule.weekday}`] = "开始时间必须早于结束时间";
    });
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;
    const input: AvailabilityDefinition = { timezone, weeklyRules: rules, exceptions: [] };
    setSaving(true);
    try {
      await api.putAvailability(input);
      onSaved(input);
    } catch (error) {
      setFieldErrors(serverErrors(error));
    } finally {
      setSaving(false);
    }
  };

  return <section className="entry-step panel" aria-labelledby="availability-title">
    <p className="section-label">Step 01 / Availability</p><h2 id="availability-title">安排可用时间</h2>
    <p>选择每周可用于完成任务的固定时间段。</p>
    <label className="entry-field">时区<select value={timezone} onChange={(event) => setTimezoneForRules(event.target.value)}>{timezones.map((item) => <option key={item}>{item}</option>)}</select></label>
    <div className="availability-days" aria-describedby={fieldErrors.rules ? "availability-rules-error" : undefined}>
      {weekdays.map(({ weekday, label }) => {
        const rule = rules.find((item) => item.weekday === weekday);
        const errorId = `availability-rule-${weekday}-error`;
        return <div className="availability-day" key={weekday}>
          <label><input type="checkbox" checked={selectedDays.has(weekday)} onChange={(event) => setDay(weekday, event.target.checked)} />{label}</label>
          {rule && <div className="availability-times">
            <label>开始时间<input type="time" value={rule.startLocalTime} aria-describedby={fieldErrors[`rule-${weekday}`] ? errorId : undefined} onChange={(event) => setRule(weekday, "startLocalTime", event.target.value)} /></label>
            <label>结束时间<input type="time" value={rule.endLocalTime} aria-describedby={fieldErrors[`rule-${weekday}`] ? errorId : undefined} onChange={(event) => setRule(weekday, "endLocalTime", event.target.value)} /></label>
            {fieldErrors[`rule-${weekday}`] && <p id={errorId} className="field-error">{fieldErrors[`rule-${weekday}`]}</p>}
          </div>}
        </div>;
      })}
    </div>
    {fieldErrors.rules && <p id="availability-rules-error" className="field-error">{fieldErrors.rules}</p>}
    {fieldErrors.form && <p className="field-error" role="alert">{fieldErrors.form}</p>}
    <button className="entry-submit" type="button" onClick={save} disabled={saving}>{saving ? "保存中…" : "保存可用时间"}</button>
  </section>;
}
