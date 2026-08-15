import { expect, test } from "@playwright/test";
import { register } from "./helpers.js";

test("registers, plans, and logs out", async ({ page }) => {
  await register(page, "auth@example.com");

  await page.getByRole("checkbox", { name: "周一" }).check();
  await page.getByLabel("开始时间").fill("18:00");
  await page.getByLabel("结束时间").fill("21:00");
  await page.getByRole("button", { name: "保存可用时间" }).click();

  await expect(page.getByRole("button", { name: "登出" })).toBeVisible();
  await page.getByRole("button", { name: "登出" }).click();

  await expect(page.getByRole("heading", { name: "登录" })).toBeVisible({ timeout: 10000 });
});

test("rejects a login with a wrong password", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /去注册/ }).click();
  await page.getByLabel("邮箱").fill("login@example.com");
  await page.getByLabel("密码").fill("password123");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "周一" })).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "登出" }).click();
  await expect(page.getByRole("heading", { name: "登录" })).toBeVisible();

  await page.getByLabel("邮箱").fill("login@example.com");
  await page.getByLabel("密码").fill("wrong-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("邮箱或密码错误");
});
