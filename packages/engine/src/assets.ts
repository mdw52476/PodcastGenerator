import { staticFile } from "remotion";

/**
 * Asset paths in a resolved plan are relative to the render's public folder.
 * The browser preview passes absolute (signed) URLs instead; use those as-is.
 */
export const asset = (src: string) => (/^(https?:|blob:|data:)/.test(src) ? src : staticFile(src));
