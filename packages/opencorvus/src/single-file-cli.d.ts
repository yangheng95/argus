declare module "single-file-cli/single-file-cli-api.js" {
  export interface SingleFileCaptureApi {
    capture(urls: string[]): Promise<void>
    finish(): Promise<void>
  }

  export function initialize(options: Record<string, unknown>): Promise<SingleFileCaptureApi>
}
