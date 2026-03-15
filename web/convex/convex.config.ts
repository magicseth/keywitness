import { defineApp } from "convex/server";
import selfHosting from "@convex-dev/self-hosting/convex.config.js";
import resend from "@convex-dev/resend/convex.config.js";
const app = defineApp();
app.use(selfHosting);
app.use(resend);
export default app;
