import Fastify from "fastify";

export async function buildApp() {
  const app = Fastify({ logger: false });
  app.get("/health", async () => ({ status: "ok" as const }));
  return app;
}