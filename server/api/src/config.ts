function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Variable d'environnement manquante : ${name}`);
    process.exit(1);
  }
  return value;
}

const jwtSecret = requireEnv("JWT_SECRET");
if (jwtSecret.length < 32) {
  console.error("JWT_SECRET doit faire au moins 32 caractères (génère-le avec : openssl rand -base64 48)");
  process.exit(1);
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  dataDir: process.env.DATA_DIR ?? "./data",
  /** Derrière Caddy : faire confiance à X-Forwarded-For pour l'IP réelle (limitation des tentatives). */
  trustProxy: process.env.TRUST_PROXY === "1",
  /** "open" : tout le monde peut créer un compte ; "closed" : inscriptions fermées. */
  registration: (process.env.REGISTRATION ?? "open") === "closed" ? "closed" : "open",
  jwtSecret: new TextEncoder().encode(jwtSecret),
  livekit: {
    url: requireEnv("LIVEKIT_URL"), // wss://… donné aux clients
    httpUrl: process.env.LIVEKIT_HTTP_URL ?? requireEnv("LIVEKIT_URL").replace(/^ws/, "http"),
    apiKey: requireEnv("LIVEKIT_API_KEY"),
    apiSecret: requireEnv("LIVEKIT_API_SECRET"),
  },
};
