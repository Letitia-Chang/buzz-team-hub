// Builds the single file Buzz loads (plugin.js) and its manifest from config.json.
// Set config.json's server and botPubkey, then run: node plugin/build.mjs
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
const at = (p) => new URL(p, import.meta.url);
const read = (p) => readFileSync(at(p), "utf8");
const config = JSON.parse(read("./config.json"));
if (!/^https:\/\/[^/]+$/.test(config.server)) throw new Error("config.server must be an https origin with no path");
if (!/^[0-9a-f]{64}$/.test(config.botPubkey)) throw new Error("config.botPubkey must be the bot's 64-character hex pubkey");
const version = JSON.parse(read("../package.json")).version;
const art = Object.fromEntries(readdirSync(at("./art/")).filter((f) => f.endsWith(".svg"))
  .map((f) => [f.replace(".svg", ""), "data:image/svg+xml;base64," + Buffer.from(read("./art/" + f)).toString("base64")]));
const out = [
  `// Team Hub ${version} — a Buzz API v1 plugin. Built from plugin/src by plugin/build.mjs; edit those, not this file.`,
  "// Illustrations: Open Peeps and Open Doodles by Pablo Stanley, CC0 1.0.",
  `const SERVER = ${JSON.stringify(config.server)};`,
  `const BOT_PUBKEY = ${JSON.stringify(config.botPubkey)};`,
  `const TEAM_NAME = ${JSON.stringify(config.teamName)};`,
  `const ART = ${JSON.stringify(art)};`,
  read("./src/blocks.js"),
  read("./src/app.js"),
].join("\n");
writeFileSync(at("./dist/plugin.js"), out);
writeFileSync(at("./dist/manifest.json"), JSON.stringify({
  id: "northstar.team-hub", name: "Team Hub", apiVersion: 1,
  description: `${config.teamName}'s Team Hub: sign in with Buzz, roles, team plugins, the Project Board and the team dashboard.`,
  updates: { defaultEnabled: true },
  discovery: { category: "developer-tools-and-integrations", tags: ["Teams", "Admin"] },
  host: { networkOrigins: [config.server] },
}, null, 2) + "\n");
console.log(`plugin/dist/plugin.js ${(out.length / 1024).toFixed(0)} KB`);
