import { createHash } from "node:crypto";
import { KernalVoiceSession, loadKernalConfig } from "./kernal.js";

const config = loadKernalConfig();
if (!config.readEnabled || !config.apiKey) throw new Error("Kernal read configuration is not enabled");
const session = new KernalVoiceSession("live-verifier", config);
const bootstrap = await session.bootstrap();
const keeperIds = [...bootstrap.matchAll(/keeper\.[a-z0-9._-]+/g)].map((match) => match[0]);
const uniqueKeepers = new Set(keeperIds);
if (uniqueKeepers.size !== 9) throw new Error(`Expected nine typed keepers, got ${uniqueKeepers.size}`);
const keeperStatus = session.buildTools({ emit: async () => {}, userText: "fleet status", turnNumber: 1 })
  .find((tool) => tool.name === "keeper_status");
if (!keeperStatus) throw new Error("keeper_status tool is unavailable");
const fleet = await keeperStatus.execute({});
for (const required of ["Current work:", "Next action:", "Blockers:", "Freshness:", "Evidence:", "Child projects:", "hub-openlive-voice-surface"]) {
  if (!fleet.output.includes(required)) throw new Error(`Fleet verification missing: ${required}`);
}

console.log(JSON.stringify({
  status: "PASS",
  key_hash: createHash("sha256").update(config.apiKey).digest("hex"),
  keeper_count: uniqueKeepers.size,
  typed_fleet: bootstrap.includes("Active keeper registry updated"),
  five_question_contract: true,
}));
