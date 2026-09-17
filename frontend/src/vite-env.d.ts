/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Absolute URL of this environment's Phoenix, including any query it should
   * open with. Unset locally, where Compose runs Phoenix on 6006; set by the
   * deployment, which is the only place that knows its own hostname. See
   * `src/lib/phoenixUrl.ts`.
   */
  readonly VITE_PHOENIX_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
