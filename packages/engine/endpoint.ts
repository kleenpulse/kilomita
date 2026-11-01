/** A speed test server. Swap implementations to change where tests run. */
export interface TestEndpoint {
  /** Reported as `serverId` in results. */
  readonly id: string;
  /** A request with an empty body, timed for latency. */
  latencyUrl(): string;
  /** A GET whose response body is exactly `bytes` long. */
  downloadUrl(bytes: number): string;
  /** A POST target that reads the whole body before it responds. */
  uploadUrl(): string;
  /** The largest `bytes` a single download request may ask for. */
  readonly maxDownloadBytes: number;
  /** Server processing time reported in the response headers, to subtract from latency. */
  serverTimeMs?(headers: Headers): number | undefined;
}
