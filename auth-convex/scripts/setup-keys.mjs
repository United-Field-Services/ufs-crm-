// One-time: creates the signing keys Convex Auth needs and stores them as environment variables on
// the Convex deployment named in .env.local. The private key is never printed or written to disk.
import { execFileSync } from "node:child_process";
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";

const cli = new URL("../node_modules/convex/bin/main.js", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const convex = (...args) => execFileSync(process.execPath, [cli, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const has = (name) => { try { return convex("env", "get", name).trim().length > 0; } catch { return false; } };

if (has("JWT_PRIVATE_KEY") && has("JWKS")) { console.log("Signing keys already set; nothing changed."); process.exit(0); }
const keys = await generateKeyPair("RS256", { extractable: true });
const privateKey = (await exportPKCS8(keys.privateKey)).trimEnd().replace(/\n/g, " ");
const jwks = JSON.stringify({ keys: [{ use: "sig", ...(await exportJWK(keys.publicKey)) }] });
convex("env", "set", "--", "JWT_PRIVATE_KEY", privateKey);
convex("env", "set", "--", "JWKS", jwks);
console.log("Signing keys created and stored on the deployment.");
