// A simple load test of the sharing API: `bun run load-test -- --url http://localhost:3931`.
// Each virtual user loops token → submit → correct → stats, like a person who shares and then
// fixes their state. Point it only at a server you run (memory mode or your own Neon and Upstash),
// never at someone else's. No dependencies: Bun's fetch and timers.

import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:3931" },
    users: { type: "string", default: "20" },
    rounds: { type: "string", default: "20" },
  },
});
const base = values.url.replace(/\/$/, "");
const users = Number(values.users);
const rounds = Number(values.rounds);
if (!Number.isInteger(users) || !Number.isInteger(rounds) || users < 1 || rounds < 1) {
  console.error("--users and --rounds must be positive integers.");
  process.exit(2);
}

// The server refuses a run longer than its token has existed, so each submit waits this long.
const DURATION_MS = 1_500;
const timings = new Map<string, number[]>();
const failures = new Map<string, number>();

async function timed(
  name: string,
  path: string,
  init: RequestInit,
): Promise<{ ok: boolean; body: string } | null> {
  const started = performance.now();
  try {
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: { "content-type": "application/json" },
    });
    const body = await response.text();
    const list = timings.get(name) ?? [];
    list.push(performance.now() - started);
    timings.set(name, list);
    if (!response.ok) failures.set(name, (failures.get(name) ?? 0) + 1);
    return { ok: response.ok, body };
  } catch {
    failures.set(name, (failures.get(name) ?? 0) + 1);
    return null;
  }
}

function result(user: number, round: number) {
  return {
    // Distinct numbers per submit, so nothing reads as a replayed duplicate.
    downloadMbps: 10 + user + round / 100,
    uploadMbps: 3,
    latency: { idleMedianMs: 50, idleP95Ms: 62, jitterMs: 4, requestLossPct: 0 },
    loadedLatency: { downloadMs: 70, uploadMs: 64, grade: "A" },
    bytesUsed: 9_000_000,
    durationMs: DURATION_MS,
    lowDataMode: true,
    engineVersion: "0.3.0",
    serverId: "cloudflare",
    measuredAt: new Date().toISOString(),
    ispSlug: "mtn",
    stateSlug: "lagos",
    networkType: "4g",
    deviceClass: "mobile",
  };
}

async function user(index: number): Promise<void> {
  for (let round = 0; round < rounds; round++) {
    const issued = await timed("POST /api/tokens", "/api/tokens", {
      method: "POST",
      body: JSON.stringify({ lowData: true }),
    });
    if (!issued?.ok) continue;
    const { token } = JSON.parse(issued.body) as { token: string };
    await new Promise((resolve) => setTimeout(resolve, DURATION_MS));
    const secret = randomBytes(32).toString("base64url");
    const stored = await timed("POST /api/results", "/api/results", {
      method: "POST",
      body: JSON.stringify({ token, secret, result: result(index, round) }),
    });
    if (stored?.ok) {
      const { id } = JSON.parse(stored.body) as { id: string };
      await timed("PATCH /api/results/:id", `/api/results/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ secret, stateSlug: "kano" }),
      });
    }
    await timed("GET /api/stats/isp", "/api/stats/isp", { method: "GET" });
  }
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? NaN;
}

const started = performance.now();
await Promise.all(Array.from({ length: users }, (_, i) => user(i)));
const seconds = (performance.now() - started) / 1000;

console.log(
  `${String(users)} users × ${String(rounds)} rounds against ${base} in ${seconds.toFixed(1)} s`,
);
console.log("route                      count  fail   p50 ms   p95 ms   p99 ms");
for (const [name, list] of timings) {
  const sorted = [...list].sort((a, b) => a - b);
  const row = [
    name.padEnd(25),
    String(sorted.length).padStart(6),
    String(failures.get(name) ?? 0).padStart(5),
    ...[50, 95, 99].map((p) => percentile(sorted, p).toFixed(0).padStart(8)),
  ];
  console.log(row.join(" "));
}
