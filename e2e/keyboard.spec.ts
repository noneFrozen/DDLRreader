import { expect, test } from "@playwright/test";
import { register } from "./helpers.js";

test("completes the full four-step workflow using only keyboard", async ({ page }) => {
  await register(page, "keyboard@example.com");

  // Step 1: Availability
  await page.getByRole("checkbox", { name: "周一" }).press("Space");
  await page.getByLabel("开始时间").fill("18:00");
  await page.getByLabel("结束时间").fill("21:00");
  await page.getByRole("button", { name: "保存可用时间" }).press("Enter");

  // Step 2: Task entry (auto-navigated)
  await page.waitForSelector("text=录入课程任务");

  await page.getByLabel("任务名称").fill("软件工程大作业");
  await page.getByLabel("截止时间").fill("2026-08-20T16:00");
  await page.getByLabel("预计工时（小时）").fill("4");
  await page.getByRole("button", { name: "保存任务" }).press("Enter");
  await page.waitForTimeout(500);

  await page.getByLabel("任务名称").fill("高等数学作业");
  await page.getByLabel("截止时间").fill("2026-08-20T16:00");
  await page.getByLabel("预计工时（小时）").fill("2");
  await page.getByRole("button", { name: "保存任务" }).press("Enter");

  // Step 3: Analysis
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "冲突分析" }).press("Enter");

  await expect(page.getByRole("status")).toContainText("周四前缺少", { timeout: 10000 });

  await page.getByRole("button", { name: "生成尽力计划" }).press("Enter");

  // Confirm dialog
  await page.getByRole("button", { name: "确认生成尽力计划" }).press("Enter");

  await expect(page.getByRole("heading", { name: "本周执行计划" })).toBeVisible({ timeout: 10000 });
});