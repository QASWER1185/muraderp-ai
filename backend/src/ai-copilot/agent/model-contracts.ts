export type FunctionCall = { type: "function_call"; call_id: string; name: string; arguments: string };
export type ModelOutput = { type: string; content?: Array<{ type: string; text?: string }>; call_id?: string; name?: string; arguments?: string };
export type ModelStep = { output: ModelOutput[]; text: string };
export interface AgentModel {
  respond(input: unknown[], tools: unknown[], signal: AbortSignal, options?: { toolChoice?: "auto" | "required" }): Promise<ModelStep>;
}
