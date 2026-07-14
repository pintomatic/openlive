import { createHash } from "node:crypto";
import { KernalVoiceSession, loadKernalConfig } from "./kernal.js";

const config = loadKernalConfig();
if (!config.readEnabled || !config.apiKey) throw new Error("Kernal read configuration is not enabled");
const session = new KernalVoiceSession("live-verifier", config);
const bootstrap = await session.bootstrap();
const keeperIds = [...bootstrap.matchAll(/keeper\.[a-z0-9._-]+/g)].map((match) => match[0]);
const uniqueKeepers = new Set(keeperIds);
if (uniqueKeepers.size !== 9) throw new Error(`Expected nine typed keepers, got ${uniqueKeepers.size}`);

console.log(JSON.stringify({
  status: "PASS",
  key_hash: createHash("sha256").update(config.apiKey).digest("hex"),
  keeper_count: uniqueKeepers.size,
  typed_fleet: bootstrap.includes("Active keeper registry updated"),
}));
