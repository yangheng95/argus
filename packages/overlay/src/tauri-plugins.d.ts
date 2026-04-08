// Type shims for Tauri v2 plugins that are loaded at runtime in Tauri context
// but not installed as npm packages (they are bundled by Tauri's plugin system).

declare module "@tauri-apps/plugin-dialog" {
  export interface OpenDialogOptions {
    directory?: boolean;
    multiple?: boolean;
    title?: string;
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }
  export function open(options?: OpenDialogOptions): Promise<string | string[] | null>;
  export function save(options?: { title?: string; defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }): Promise<string | null>;
}
