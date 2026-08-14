const BASE = "http://127.0.0.1:3000";
let failed = false;

async function check(path, assertions) {
  try {
    const response = await fetch(`${BASE}${path}`);
    for (const assertion of assertions) assertion(response);
  } catch (error) {
    console.error(`FAIL ${path}: ${error.message}`);
    failed = true;
  }
}

await check("/health", [
  (response) => {
    if (response.status !== 200) throw new Error(`expected 200, got ${response.status}`);
  },
  async (response) => {
    const body = await response.json();
    if (body.status !== "ok") throw new Error(`expected { status: "ok" }, got ${JSON.stringify(body)}`);
  },
]);

await check("/", [
  (response) => {
    if (response.status !== 200) throw new Error(`expected 200, got ${response.status}`);
  },
  async (response) => {
    const html = await response.text();
    if (!html.includes("DDL Radar")) throw new Error("HTML does not contain DDL Radar");
  },
]);

if (failed) process.exit(1);
console.log("Smoke test passed");