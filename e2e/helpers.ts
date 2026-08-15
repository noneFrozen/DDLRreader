import { expect, type Page } from "@playwright/test";

export async function register(page: Page, email: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: /去注册/ }).click();
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill("password123");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "周一" })).toBeVisible({ timeout: 10000 });
}
