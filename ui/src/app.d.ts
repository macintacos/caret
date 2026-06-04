// Ambient declarations for non-TS asset imports handled by Vite.
declare module "*.css";
declare module "*.svg?raw" {
  const src: string;
  export default src;
}
