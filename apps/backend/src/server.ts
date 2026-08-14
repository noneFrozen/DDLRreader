import { buildApp } from "./app.js";

const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);

try {
  const app = await buildApp();
  await app.listen({ host, port });
  console.log(`Server listening on ${host}:${port}`);
} catch (err) {
  console.error("Failed to start server:", err);
  process.exit(1);
}