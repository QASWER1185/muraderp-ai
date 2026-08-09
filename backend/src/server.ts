import { createServer } from "node:http";
import { createApp } from "./app.js";
import { env } from "./config/env.js";

const server = createServer(createApp());

server.listen(env.PORT, () => {
  console.log(`MuradERP API is running on http://localhost:${env.PORT}`);
});

function shutdown(signal: string) {
  console.log(`${signal} received; closing the API server`);

  server.close((error) => {
    if (error) {
      console.error("API server could not close cleanly", error);
      process.exit(1);
    }

    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
