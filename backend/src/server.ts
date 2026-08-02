import express from "express";
import { config } from "./config/app";

import healthRoutes from "./routes/health.routes";
import customerRoutes from "./routes/customer.routes";

console.log("=========== SERVER VERSION 2 ===========");

const app = express();

app.use(express.json());

app.get("/", (_req, res) => {
  res.send("🚀 Welcome to MuradERP-AI Backend");
});

app.get("/api/test", (_req, res) => {
  res.json({
    success: true,
    message: "API Test Working",
  });
});

app.use("/api", healthRoutes);
app.use("/api", customerRoutes);

app.listen(config.port, () => {
  console.log(
    `🚀 MuradERP-AI Server is running on http://localhost:${config.port}`
  );
});