export const runtime = "nodejs";

// Re-export del handler real (mantiene lógica en src/server)
export { POST } from "../../../../../src/server/ai-outputs/compare/explain/route";
