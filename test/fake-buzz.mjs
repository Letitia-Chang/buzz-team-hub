#!/usr/bin/env node
// Stand-in for the `buzz` CLI in tests. Members come from FAKE_MEMBERS; DMs are
// appended to FAKE_OUTBOX so tests can read the code the bot "sent".
import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2).filter((a, i, all) => !(a === "--format" || all[i - 1] === "--format"));
const arg = (name) => args[args.indexOf(name) + 1];
const [group, cmd] = args;
if (group === "channels" && cmd === "members") {
  const members = readFileSync(process.env.FAKE_MEMBERS, "utf8").split(/\s+/).filter(Boolean);
  process.stdout.write(JSON.stringify(members));
} else if (group === "dms" && cmd === "open") {
  process.stdout.write(JSON.stringify({ event_id: "e", accepted: true, dm_id: "11111111-2222-4333-8444-" + arg("--pubkey").slice(0, 12) }));
} else if (group === "messages" && cmd === "send") {
  appendFileSync(process.env.FAKE_OUTBOX, JSON.stringify({ channel: arg("--channel"), content: arg("--content") }) + "\n");
  process.stdout.write(JSON.stringify({ event_id: "m", accepted: true, message: "" }));
} else {
  process.stderr.write("unknown command " + args.join(" "));
  process.exit(2);
}
