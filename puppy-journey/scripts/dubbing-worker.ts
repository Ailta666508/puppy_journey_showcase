import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import { createDubbingStore } from "../src/lib/dubbing/store.server";
import { createDubbingWorkerDependencies, runDubbingWorkerOnce } from "../src/lib/dubbing/worker.server";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.DUBBING_ENABLED !== "true") throw new Error("Set DUBBING_ENABLED=true after applying the dubbing migration.");
  if (!url || !key) throw new Error("Worker needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, {
      ...init, signal: AbortSignal.any([AbortSignal.timeout(60_000), ...(init?.signal ? [init.signal] : [])]),
    }) },
  });
  const deps = createDubbingWorkerDependencies(client);
  const workerId = `dubbing-${randomUUID()}`;
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());
  const once = process.argv.includes("--once");
  const store = createDubbingStore(client);
  let nextMaintenanceAt = 0;
  let lastExhaustedPurges = 0;
  console.info(`Dubbing worker started (${process.env.DUBBING_TTS_MODE || "disabled"} speech mode).`);
  do {
    if (Date.now() >= nextMaintenanceAt) {
      try {
        const retention = await store.sweepMaintenance();
        if (retention.exhaustedPurges > 0 && retention.exhaustedPurges !== lastExhaustedPurges) {
          console.error(`Dubbing cleanup needs operator attention: ${retention.exhaustedPurges} deletion tasks exhausted automatic retries.`);
        }
        lastExhaustedPurges = retention.exhaustedPurges;
      }
      catch { console.warn("Dubbing retention maintenance failed; it will retry in one minute."); }
      nextMaintenanceAt = Date.now() + 60_000;
    }
    const worked = await runDubbingWorkerOnce(deps, workerId, controller.signal);
    if (once || controller.signal.aborted) break;
    if (!worked) await delay(2000, undefined, { signal: controller.signal }).catch(() => undefined);
  } while (!controller.signal.aborted);
}

main().catch((error: unknown) => {
  // Never log provider errors, SQL payloads, storage URLs, scripts or recordings.
  const message = error instanceof Error && /^(Set DUBBING_ENABLED|Worker needs )/.test(error.message)
    ? error.message : "Dubbing worker stopped; check configuration and database availability.";
  console.error(message);
  process.exitCode = 1;
});
