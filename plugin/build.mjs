// Builds the single file Buzz loads (plugin.js) and its manifest from config.json.
// Set config.json's server and botPubkey, then run: node plugin/build.mjs
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
const at = (p) => new URL(p, import.meta.url);
const read = (p) => readFileSync(at(p), "utf8");
const config = JSON.parse(read("./config.json"));
// --demo builds "Team Hub demo": the same pages on sample data, with Team Hub's real
// rules (server/hub.js) running in memory. No server, bot or network needed.
const demo = process.argv.includes("--demo");
const outDir = demo ? "./demo-dist/" : "./dist/";
// server/hub.js without its Node imports and exports, for the demo backend.
const hubForBrowser = () => read("../server/hub.js").replace(/^import .*$/gm, "").replace(/^export (async function|function|const)/gm, "$1");
if (!/^https:\/\/[^/]+$/.test(config.server)) throw new Error("config.server must be an https origin with no path");
if (!demo && !/^[0-9a-f]{64}$/.test(config.botPubkey)) throw new Error("config.botPubkey must be the bot's 64-character hex pubkey");
const version = JSON.parse(read("../package.json")).version;
const art = Object.fromEntries(readdirSync(at("./art/")).filter((f) => f.endsWith(".svg"))
  .map((f) => [f.replace(".svg", ""), "data:image/svg+xml;base64," + Buffer.from(read("./art/" + f)).toString("base64")]));
const out = [
  `// Team Hub ${version} — a Buzz API v1 plugin. Built from plugin/src by plugin/build.mjs; edit those, not this file.`,
  "// Illustrations: Open Peeps and Open Doodles by Pablo Stanley, CC0 1.0. Icons: Lucide, ISC.",
  `const SERVER = ${JSON.stringify(config.server)};`,
  `const BOT_PUBKEY = ${JSON.stringify(config.botPubkey)};`,
  `const TEAM_NAME = ${JSON.stringify(config.teamName)};`,
  `const ART = ${JSON.stringify(art)};`,
  `const DEMO = ${demo};`,
  ...(demo ? [hubForBrowser(), read("./src/demo-backend.js"), "const DEMO_BACKEND = createDemoBackend();"] : ["const DEMO_BACKEND = null;"]),
  read("./src/icons.js"),
  read("./src/blocks.js"),
  read("./src/app.js"),
].join("\n");
writeFileSync(at(outDir + "plugin.js"), out);
writeFileSync(at(outDir + "manifest.json"), JSON.stringify({
  id: demo ? "northstar.team-hub-demo" : "northstar.team-hub", name: demo ? "Team Hub demo" : "Team Hub", apiVersion: 1,
  description: demo
    ? `A demo of Team Hub for ${config.teamName}, with sample data: sign in with Buzz, roles, team plugins, requests and the audit log. Nothing is saved or sent.`
    : `${config.teamName}'s Team Hub: sign in with Buzz, roles, team plugins, the Project Board and the team dashboard.`,
  updates: { defaultEnabled: true },
  discovery: { category: "developer-tools-and-integrations", tags: ["Teams", "Admin"] },
  ...(demo ? {} : { host: { networkOrigins: [config.server] } }),
}, null, 2) + "\n");
console.log(`plugin/${outDir.slice(2)}plugin.js ${(out.length / 1024).toFixed(0)} KB`);
