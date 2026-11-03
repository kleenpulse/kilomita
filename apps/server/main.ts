import { join } from "node:path";
import { buildServer } from "./app.ts";
import { Budget, loadBudgetState, saveBudgetState } from "./budget.ts";
import { ConfigError, parseConfig } from "./config.ts";

const SAVE_EVERY_MS = 60_000;

let config;
try {
  config = parseConfig(process.env);
} catch (error) {
  console.error(error instanceof ConfigError ? error.message : "Invalid configuration.");
  process.exit(1);
}

const statePath = config.stateDir === null ? null : join(config.stateDir, "egress.json");
const budget = new Budget(
  config.budgetBytes,
  Date.now,
  statePath === null ? null : loadBudgetState(statePath),
);
if (config.budgetBytes !== null && statePath === null) {
  console.error("KILOMITA_STATE_DIR is unset: the budget count is lost on restart.");
}

function save(): void {
  if (statePath !== null) saveBudgetState(statePath, budget.snapshot());
}

const app = buildServer(config, { budget });
const timer = setInterval(save, SAVE_EVERY_MS);
timer.unref();

async function shutdown(): Promise<void> {
  clearInterval(timer);
  save();
  await app.close();
  process.exit(0);
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());

await app.listen({ port: config.port, host: config.host });
console.log(`Test server listening on ${config.host}:${config.port} (${config.protocol}).`);
