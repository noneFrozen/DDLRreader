import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthGate } from "../src/features/auth/AuthGate.js";

const user = { id: "u1", email: "a@example.com", createdAt: "2026-08-14T00:00:00.000Z", updatedAt: "2026-08-14T00:00:00.000Z" };

describe("AuthGate", () => {
  afterEach(cleanup);

  it("shows the login form when unauthenticated and reveals the app after login", async () => {
    const api = {
      me: vi.fn().mockRejectedValue(new Error("未登录")),
      login: vi.fn().mockResolvedValue({ user }),
      register: vi.fn(),
      logout: vi.fn(),
    };
    render(<AuthGate api={api}>主应用</AuthGate>);

    await waitFor(() => expect(screen.getByRole("heading", { name: "登录" })).toBeVisible());
    expect(screen.queryByText("主应用")).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("邮箱"), "a@example.com");
    await userEvent.type(screen.getByLabelText("密码"), "password123");
    await userEvent.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => expect(api.login).toHaveBeenCalledWith({ email: "a@example.com", password: "password123" }));
    await waitFor(() => expect(screen.getByText("主应用")).toBeVisible());
  });

  it("renders children immediately when already authenticated", async () => {
    const api = { me: vi.fn().mockResolvedValue({ user }), login: vi.fn(), register: vi.fn(), logout: vi.fn() };
    render(<AuthGate api={api}>主应用</AuthGate>);
    await waitFor(() => expect(screen.getByText("主应用")).toBeVisible());
  });
});
