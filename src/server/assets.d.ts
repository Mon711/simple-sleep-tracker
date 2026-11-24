declare module 'tracker:assets' {
  export function embeddedAsset(path: string): import('./http.ts').Asset | undefined;
}
