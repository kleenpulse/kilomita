import { z } from "zod";
import { ISP_SLUGS } from "./isps";
import { NETWORK_TYPES } from "./network-types";
import { SHARING } from "./sharing";
import { STATE_SLUGS } from "./states";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const nonNegative = z.number().nonnegative();

export const NetworkTypeSchema = z.enum(NETWORK_TYPES);
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

/** A shared result's own secret: 32 random bytes, base64url without padding. */
export const ResultSecretSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const TokenRequestSchema = z.strictObject({ lowData: z.boolean() });

export const SubmitResultSchema = z.strictObject({
  token: z.string().min(1).max(512),
  secret: ResultSecretSchema,
  result: SpeedTestResultSchema,
});
export type SubmitResult = z.infer<typeof SubmitResultSchema>;

/** Network details the owner may correct shortly after sharing. null clears the state. */
export const CorrectResultSchema = z
  .strictObject({
    secret: ResultSecretSchema,
    ispSlug: IspSlugSchema.optional(),
    stateSlug: NigerianStateSchema.nullable().optional(),
    networkType: NetworkTypeSchema.optional(),
  })
  .refine(
    (body) =>
      body.ispSlug !== undefined || body.stateSlug !== undefined || body.networkType !== undefined,
    { message: "Nothing to correct" },
  );
export type CorrectResult = z.infer<typeof CorrectResultSchema>;

export const DeleteResultsSchema = z.strictObject({
  secrets: z.array(ResultSecretSchema).min(1).max(SHARING.deleteBatch),
});

/** One published group. Below the minimum size it carries no numbers at all, not even a count. */
export type StatsCell =
  | { key: string; enough: false }
  | { key: string; enough: true; downloadMbps: number; uploadMbps: number; latencyMs: number };
