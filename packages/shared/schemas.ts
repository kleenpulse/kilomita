import { z } from "zod";
import { ISP_SLUGS } from "./isps";
import { STATE_SLUGS } from "./states";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const nonNegative = z.number().nonnegative();

export const NetworkTypeSchema = z.enum([
  "2g",
  "3g",
  "4g",
  "5g",
  "fiber",
  "fixed-wireless",
  "satellite",
  "unknown",
]);
export type NetworkType = z.infer<typeof NetworkTypeSchema>;

export const BufferbloatGradeSchema = z.enum(["A", "B", "C", "D", "F"]);
export type BufferbloatGrade = z.infer<typeof BufferbloatGradeSchema>;

export const DeviceClassSchema = z.enum(["mobile", "tablet", "desktop"]);
export type DeviceClass = z.infer<typeof DeviceClassSchema>;

export const NigerianStateSchema = z.enum(STATE_SLUGS);
export type NigerianState = z.infer<typeof NigerianStateSchema>;

export const IspSlugSchema = z.enum(ISP_SLUGS);

export const IspSchema = z.object({
  slug: IspSlugSchema,
  name: z.string().min(1),
});
export type Isp = z.infer<typeof IspSchema>;

export const SpeedTestResultSchema = z.object({
  downloadMbps: nonNegative,
  uploadMbps: nonNegative,
  latency: z.object({
    idleMedianMs: nonNegative,
    idleP95Ms: nonNegative,
    jitterMs: nonNegative,
    /** Share of HTTP latency probes that failed or timed out. Not ICMP packet loss. */
    requestLossPct: nonNegative.max(100),
  }),
  loadedLatency: z.object({
    downloadMs: nonNegative,
    uploadMs: nonNegative,
    grade: BufferbloatGradeSchema,
  }),
  bytesUsed: z.number().int().nonnegative(),
  durationMs: nonNegative,
  lowDataMode: z.boolean(),
  engineVersion: z.string().regex(SEMVER_PATTERN),
  serverId: z.string().min(1).max(64),
  measuredAt: z.iso.datetime(),
  ispSlug: IspSlugSchema,
  stateSlug: NigerianStateSchema.optional(),
  lgaSlug: z.string().max(64).regex(SLUG_PATTERN).optional(),
  networkType: NetworkTypeSchema,
  deviceClass: DeviceClassSchema,
});
export type SpeedTestResult = z.infer<typeof SpeedTestResultSchema>;
