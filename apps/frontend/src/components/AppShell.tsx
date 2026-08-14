import type { ReactNode } from "react";

type AppShellProps = {
  header: ReactNode;
  flow: ReactNode;
  children: ReactNode;
  aside: ReactNode;
};

export function AppShell({ header, flow, children, aside }: AppShellProps) {
  return (
    <div className="app-shell">
      <header className="app-shell__header">{header}</header>
      <div className="app-shell__layout">
        <section className="app-shell__flow" aria-label="流程导航">{flow}</section>
        <main className="app-shell__workspace">{children}</main>
        <aside className="app-shell__aside" aria-label="任务与摘要">{aside}</aside>
      </div>
    </div>
  );
}
