import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();

// Serves /.well-known/openid-configuration and /.well-known/jwks.json, which the
// UFS People server uses to verify sign-in tokens.
auth.addHttpRoutes(http);

export default http;
