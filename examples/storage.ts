import { SwagenHarness, resolveConfig, FileStorage, newSession } from "../src/index.ts";
import type { Session } from "../src/index.ts";

const config = await resolveConfig({
  dryRun: true,
  storage: { backend: "memory" },
  cache: { strategy: "none" },
});

const memoryHarness = await SwagenHarness.create(config);
const memSession = await memoryHarness.newSession("openapi.yaml");
console.log("Memory session:", memSession.id);

const fileStorage = new FileStorage(".swagen/sessions");
const fileSession: Session = {
  ...newSession("openapi.yaml", config),
  id: "file-session-demo",
};
await fileStorage.putSession(fileSession);
const loaded = await fileStorage.getSession("file-session-demo");
console.log("File session loaded:", loaded?.id, "| source:", loaded?.specSource);

const allSessions = await fileStorage.listSessions();
console.log("All file sessions:", allSessions);

await fileStorage.deleteSession("file-session-demo");
console.log("Deleted demo session");
