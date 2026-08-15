import { expect, test } from "@playwright/test";
import { register } from "./helpers.js";

async function enterSampleAvailability(page: import("@playwright/test").Page) {
  await page.getByRole("checkbox", { name: "周一" }).check();
  await page.getByLabel("开始时间").fill("18:00");
  await page.getByLabel("结束时间").fill("21:00");
  await page.getByRole("button", { name: "保存可用时间" }).click();
}

async function enterSampleTask(page: import("@playwright/test").Page, title: string, deadline: string, hours: string) {
  await page.getByLabel("任务名称").fill(title);
  await page.getByLabel("截止时间").fill(deadline);
  await page.getByLabel("预计工时（小时）").fill(hours);
  await page.getByRole("button", { name: "保存任务" }).click();
}

test("shows the stats dashboard and moves a block with the keyboard", async ({ page }) => {
  await register(page, "stats@example.com");
  await enterSampleAvailability(page);
  await enterSampleTask(page, "软件工程大作业", "2026-08-20T16:00", "4");
  await enterSampleTask(page, "高等数学作业", "2026-08-20T16:00", "2");

  await page.getByRole("button", { name: "冲突分析" }).click();
  await expect(page.getByRole("status")).toContainText("周四前缺少", { timeout: 10000 });
  await page.getByRole("button", { name: "生成尽力计划" }).click();
  await page.getByRole("button", { name: "确认生成尽力计划" }).click();
  await expect(page.getByRole("heading", { name: "本周执行计划" })).toBeVisible({ timeout: 10000 });

  await page.getByRole("button", { name: "统计看板" }).click();
  await expect(page.getByRole("heading", { name: "统计看板" })).toBeVisible();
  await expect(page.getByText("活跃任务")).toBeVisible();
});