import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { ApiClient, User } from "../../api/client.js";

type AuthGateProps = {
  api: Pick<ApiClient, "me" | "login" | "register" | "logout">;
  onUserChange?: (user: User | null) => void;
  children: ReactNode;
};

export function AuthGate({ api, onUserChange, children }: AuthGateProps) {
  const [user, setUser] = useState<User | null>(null);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    void api.me()
      .then((result) => { if (!mounted) return; setUser(result.user); onUserChange?.(result.user); })
      .catch(() => { if (!mounted) return; setUser(null); onUserChange?.(null); })
      .finally(() => { if (mounted) setChecking(false); });
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const submit = useCallback(async (email: string, password: string) => {
    setBusy(true);
    setError("");
    try {
      const result = mode === "login" ? await api.login({ email, password }) : await api.register({ email, password });
      setUser(result.user);
      onUserChange?.(result.user);
    } catch (reason) {
      const failure = reason as Error & { fieldErrors?: Record<string, string> };
      setError(failure.fieldErrors ? Object.values(failure.fieldErrors).join("；") : failure.message);
    } finally { setBusy(false); }
  }, [api, mode, onUserChange]);

  if (checking) {
    return <section className="auth-gate panel" aria-busy="true"><p className="section-label">DDL Radar</p><p>正在加载…</p></section>;
  }
  if (user) return <>{children}</>;

  return (
    <section className="auth-gate panel" aria-labelledby="auth-title">
      <p className="section-label">Deadline / Organic planner</p>
      <h2 id="auth-title">{mode === "login" ? "登录" : "注册"}</h2>
      <p>{mode === "login" ? "登录后继续安排你的截止日期。" : "创建账号开始规划你的任务。"}</p>
      {error && <p className="field-error" role="alert">{error}</p>}
      <form
        className="auth-form"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void submit(String(data.get("email") ?? ""), String(data.get("password") ?? ""));
        }}
      >
        <label className="entry-field">邮箱<input name="email" type="email" autoComplete="email" required /></label>
        <label className="entry-field">密码<input name="password" type="password" minLength={8} autoComplete={mode === "login" ? "current-password" : "new-password"} required /></label>
        <button type="submit" className="entry-submit" disabled={busy}>{busy ? "提交中…" : mode === "login" ? "登录" : "注册"}</button>
      </form>
      <button type="button" className="auth-switch" onClick={() => { setError(""); setMode((m) => (m === "login" ? "register" : "login")); }}>
        {mode === "login" ? "还没有账号？去注册" : "已有账号？去登录"}
      </button>
    </section>
  );
}
