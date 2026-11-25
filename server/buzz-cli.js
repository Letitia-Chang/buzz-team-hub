// Thin wrapper around the official `buzz` CLI, run as the server's bot identity.
// The CLI handles NIP-42 sign-in, NIP-98 request proofs and Buzz's membership
// headers, so this server never implements the relay protocol itself.
//
// Environment the CLI reads (set them for the server process only):
//   BUZZ_PRIVATE_KEY  the bot's private key (hex or nsec). Never log it.
//   BUZZ_RELAY_URL    your community, e.g. https://north-star-ai-labs.communities.buzz.xyz

import { execFile } from "node:child_process";

const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createBuzzCli({ bin = process.env.BUZZ_CLI || "buzz", timeoutMs = 20_000 } = {}) {
  const run = (args) =>
    new Promise((resolve, reject) => {
      execFile(
        bin,
        ["--format", "json", ...args],
        { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, env: process.env },
        (error, stdout, stderr) => {
          if (error) {
            // stderr can name the relay's refusal; it never contains the key.
            reject(new Error(`buzz ${args[0]} ${args[1]} failed: ${String(stderr || error.message).trim().slice(0, 300)}`));
            return;
          }
          try {
            resolve(JSON.parse(stdout));
          } catch {
            reject(new Error(`buzz ${args[0]} ${args[1]} returned non-JSON output`));
          }
        },
      );
    });

  return {
    /** Pubkeys (hex) of everyone in a channel, from the relay-signed kind:39002 list. */
    async channelMembers(channelId) {
      if (!UUID.test(channelId)) throw new Error("channelId must be a channel UUID");
      const members = await run(["channels", "members", "--channel", channelId]);
      if (!Array.isArray(members)) throw new Error("unexpected members output");
      return members.filter((key) => typeof key === "string" && HEX64.test(key));
    },

    /** Opens (or reuses) a DM between the bot and `pubkey`; returns its channel id. */
    async openDm(pubkey) {
      if (!HEX64.test(pubkey)) throw new Error("pubkey must be 64-char hex");
      const result = await run(["dms", "open", "--pubkey", pubkey]);
      if (!result || typeof result.dm_id !== "string") throw new Error("dms open returned no dm_id");
      return result.dm_id;
    },

    /** Sends a plain message into a channel or DM. */
    async sendMessage(channelId, content) {
      if (!UUID.test(channelId)) throw new Error("channelId must be a channel UUID");
      const result = await run(["messages", "send", "--channel", channelId, "--content", content]);
      if (result && result.accepted === false) throw new Error(`relay refused the message: ${result.message || ""}`);
      return result;
    },
  };
}
