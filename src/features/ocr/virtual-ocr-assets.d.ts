// No top-level imports/exports: this declares an ambient virtual module.
// Use a distinct basename from assets.ts so source discovery includes this file.
declare module 'virtual:biboo-ocr-assets' {
  interface Asset { path: string; bytes: number; sha256: string }
  const manifest: { version: 1; worker: Asset; core: Asset; wasm: Asset; languages: Record<'nld' | 'por', Asset> }
  export default manifest
}
