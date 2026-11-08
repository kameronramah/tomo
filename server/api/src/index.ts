import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { config } from "./config.js";
import "./db.js";
import authRoutes from "./routes-auth.js";
import serverRoutes from "./routes-servers.js";

const app = Fastify({ logger: true, trustProxy: config.trustProxy, bodyLimit: 64 * 1024 });

// Le client de bureau (origine tauri.localhost) et le client web de dev appellent l'API
// depuis une autre origine. L'authentification passe par l'en-tête Authorization (pas de cookie).
await app.register(cors, { origin: true, methods: ["GET", "POST", "PATCH", "DELETE"] });

// Limite globale par IP ; les routes de connexion ont une limite plus stricte.
await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });

// Seul le JSON est lu ; toute autre requête (ex. POST sans corps) passe avec un corps vide.
app.addContentTypeParser("*", (_req, _payload, done) => done(null, undefined));

app.get("/health", async () => ({ ok: true }));

await app.register(authRoutes);
await app.register(serverRoutes);

// Outils de test : uniquement si DEV_TOOLS=1 (serveur de dev). Absents en production.
if (config.devTools) {
  const { default: devRoutes, seedDevUser } = await import("./routes-dev.js");
  await app.register(devRoutes);
  await seedDevUser((msg) => app.log.warn(msg));
  app.log.warn("MODE DEV : outils de test actifs. Ne jamais activer DEV_TOOLS en production.");
}

app.listen({ port: config.port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
