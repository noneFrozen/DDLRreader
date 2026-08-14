import { readFileSync } from "node:fs";

const requirements = {
  "README.md": ["项目简介", "安装", "运行", "分发", "目录结构", "安全边界", "已知限制"],
  "SPEC_PROCESS.md": ["brainstorming 关键节点", "关键迭代", "冷启动验证", "修订前后"],
  "AGENT_LOG.md": ["时间", "Task", "Superpowers", "人工干预", "commit"],
};

let failed = false;
for (const [file, headings] of Object.entries(requirements)) {
  try {
    const text = readFileSync(file, "utf8");
    for (const heading of headings) {
      if (!text.includes(heading)) {
        console.error(`${file} missing ${heading}`);
        failed = true;
      }
    }
  } catch {
    console.error(`${file} not found`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log("All required documentation present");