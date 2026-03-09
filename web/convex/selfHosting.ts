import { exposeUploadApi } from "@convex-dev/self-hosting";
import { components } from "./_generated/api";
export const {
  generateUploadUrl,
  generateUploadUrls,
  recordAsset,
  recordAssets,
  gcOldAssets,
  listAssets,
} = exposeUploadApi(components.selfHosting);
