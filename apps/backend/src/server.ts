import { buildApp } from "./app.js";

const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);
const clock = process.env.NOW ? { now: () => new Date(process.env.NOW!) } : undefined;

try {
  const app = await buildApp({ clock });
  await app.listen({ host, port });
  console.log(`Server listening on ${host}:${port}`);
} catch (err) {
  console.error("Failed to start server:", err);
  process.exit(1);
}