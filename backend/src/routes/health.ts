import { Router } from "express";

export const healthRouter = Router();

healthRouter.get("/", (_request, response) => {
  response.status(200).json({
    status: "ok",
    service: "muraderp-api",
    version: "0.1.0",
    timestamp: new Date().toISOString(),
  });
});
