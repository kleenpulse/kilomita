export { cloudflareEndpoint } from "./cloudflare";
export { ENGINE_VERSION, createSpeedTest } from "./engine";
export { selfHostedEndpoint } from "./self-hosted";
export type { SelfHostedServer } from "./self-hosted";
export type { TestEndpoint } from "./endpoint";
export type { Direction, Phase } from "./profiles";
export type {
  EngineError,
  EngineErrorCode,
  EngineResult,
  FetchFn,
  ProgressEvent,
  RunPhase,
  SpeedTest,
  SpeedTestEvents,
  SpeedTestOptions,
  SpeedTestOutcome,
  StopReason,
} from "./types";
