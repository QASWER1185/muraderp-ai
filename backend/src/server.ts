import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { env } from "./config/env.js";

export function startServer() {
  const server = createServer(createApp());
  server.listen(env.PORT, () => {
    console.log(`MuradERP API is running on http://localhost:${env.PORT}`);
  });
  return server;
}

function shutdown(server: ReturnType<typeof createServer>, signal: string) {
  console.log(`${signal} received; closing the API server`);

  server.close((error) => {
    if (error) {
      console.error("API server could not close cleanly", error);
      process.exit(1);
    }

    process.exit(0);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = startServer();
  process.on("SIGTERM", () => shutdown(server, "SIGTERM"));
  process.on("SIGINT", () => shutdown(server, "SIGINT"));
}
