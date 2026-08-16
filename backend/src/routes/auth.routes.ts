import { Router } from "express";
import { z } from "zod";
import { bootstrapBrowserSession, browserSessionHandler, clearBrowserSession } from "../auth/browser-session.js";

const tokenSchema = z.object({ accessToken: z.string().trim().min(20) });

export const authRouter = Router();

authRouter.post("/session", async (request, response) => {
  const authorization = request.header("authorization");
  const [scheme, token] = authorization?.split(" ", 2) ?? [];
  const accessToken = scheme === "Bearer" && token ? token : tokenSchema.parse(request.body).accessToken;
  try {
    const session = await bootstrapBrowserSession(accessToken, response);
    response.status(200).json({ data: session });
  } catch (error) {
    response.status(401).json({ error: { code: "UNAUTHORIZED", message: error instanceof Error ? error.message : "Unable to establish browser session" } });
  }
});

authRouter.get("/session", browserSessionHandler(true), (request, response) => {
  response.status(200).json({ data: { authenticated: true, userId: request.browserPrincipal!.userId } });
});

authRouter.delete("/session", (_request, response) => {
  clearBrowserSession(response);
  response.status(204).send();
});
