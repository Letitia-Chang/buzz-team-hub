# Team Hub

North Star's Team Hub for [Buzz](https://github.com/block/buzz-app): sign in with
Buzz, roles and permissions, team plugins, requests, an audit log, the team
dashboard, and the Project Board's data. All of it is served from the office
machine through a Cloudflare Tunnel.

It has two parts:

- **`server/`**: a small Node server with no dependencies. It runs on the office
  machine, listens on `127.0.0.1`, and is reached only through the tunnel.
- **`plugin/`**: the Buzz plugin people install. It signs them in and shows the
  pages.

## How sign-in works

1. In the plugin, you press **Send me a code**. Buzz already knows who you are, so
   there's nothing to type.
2. The server checks that you're in the team's private **access channel**. If you
   are, its bot account DMs you a 6-digit code. If you aren't, the reply is the same
   but no code is sent, so nobody can probe who's in the channel.
3. The plugin reads the code from that DM and fills it in. Codes work once, last 10
   minutes, and allow 5 tries.
4. You get a 14-day session. Every request re-checks the access channel (cached for
   5 minutes), so taking someone out of the channel signs them out.

The server stores only hashes of codes and tokens. The bot is its own Buzz
account, so nobody's personal key sits on the server.

## Roles and permissions

| | Owner | Admin | Member | Guest |
| --- | --- | --- | --- | --- |
| See the Project Board | ✓ | ✓ | ✓ | ✓ |
| Edit the Project Board | ✓ | ✓ | ✓ | |
| See the team dashboard | ✓ | ✓ | ✓ | |
| Use approved plugins | ✓ | ✓ | ✓ | |
| Answer requests | ✓ | ✓ | | |
| Manage members, roles and plugins | ✓ | ✓ | | |
| Manage servers and sign-in | ✓ | | | |
| See the audit log | ✓ | ✓ | | |

These are the defaults. Owners and admins can change the grid on **Roles &
permissions**, with three exceptions:
- Owners can always do everything.
- Only owners can change who manages servers.
- Only owners can make someone an admin.

Owners are set in `OWNER_PUBKEYS`. Everyone in the access channel starts as a
Member. Guests get an end date (7 days by default), and their access ends on its
own.

The server checks permissions on every request. The plugin only hides what you
can't do.

## Pages

| Page | What's there |
| --- | --- |
| **Home** | Members, agents shared in the team, questions answered and plugins in use, for Today or This week. Also the most asked agents, recent changes, and whether the office server is up. **Share my Agent Access counts** is an opt-in switch: it sends agent names and answers per day only, never who asked or what. |
| **Members** | Everyone in the access channel, with role and last seen. Owners and admins can change roles, make someone a guest for 7 days, or remove them (which signs them out; also remove them from the channel in Buzz). |
| **Roles & permissions** | The grid above. |
| **Plugins** | The team's plugins, shown as Verified when the release is signed by a publisher the team trusts. Also who can use each one after installing it (Everyone, Members and up, Admins and up), rolling out an update, and approving or rejecting a submitted plugin. **Copy trust file** gives the `plugin-trust.json` for `buzzodz plugin trust`, so Buzz refuses plugins from anyone else. |
| **Data & servers** | Whether the office server is up, the tunnel address, the bot, session settings, and (owners only) **Sign everyone out**. |
| **Requests** | Role, plugin and join requests, with Approve or Not now. |
| **Audit log** | Sign-ins, roles, plugins and settings, kept for 90 days. Nothing from Buzz messages. |

## Set up on the office machine

1. **Bot account.** Create a Buzz account for the bot (for example "Project Board
   bot") and add it to your community. Keep its private key for step 3 only.
2. **Access channel.** Create a private channel (for example `#team-hub-access`),
   add the bot and the team. Copy the channel's ID.
3. **Server.** Install the [`buzz` CLI](https://github.com/block/buzz), then:

   ```sh
   export BUZZ_PRIVATE_KEY=…              # the bot's key; only this process sees it
   export BUZZ_RELAY_URL=https://north-star-ai-labs.communities.buzz.xyz
   export ACCESS_CHANNEL_ID=…             # step 2
   export OWNER_PUBKEYS=…                 # your hex pubkey (comma-separate several)
   export AUTH_SECRET=$(openssl rand -hex 32)
   cp data/plugins.example.json data/plugins.json   # optional: the team's plugins
   npm start                              # listens on 127.0.0.1:8787
   ```
4. **Tunnel.** Point a Cloudflare Tunnel at `http://127.0.0.1:8787` with the
   hostname `nstr-data.northstar-ai-labs.com`.
5. **Plugin.** In `plugin/config.json`, set `server` (your tunnel's https origin)
   and `botPubkey` (the bot's hex pubkey). Then run `node plugin/build.mjs`. Install
   the `plugin/dist` folder in Buzz (**Settings → Plugins → Manage plugins**), or
   publish it as its own Git repository.

To plug in the real Project Board, mount `auth.handle` and `hub.handle` in
`feed_server.js`, and guard its routes with `await hub.require(req, res, "view")`
(or `"edit"`). `server/server.js` shows how.

## Develop

```sh
npm test                 # 17 end-to-end tests against a fake `buzz` CLI
node plugin/build.mjs    # plugin/src + plugin/art → plugin/dist
```

## Not built yet

- Adding or removing people from the access channel from Team Hub. For now that's
  done in Buzz, and the page says so.
- Agent Access reporting its counts to Team Hub by itself. Today, the Team Hub
  plugin reads your Agent Access counts on your computer when you turn on the
  switch on Home.

## License

MIT. Illustrations in `plugin/art/` are Open Peeps and Open Doodles by Pablo
Stanley, CC0.

## Demo

`node plugin/build.mjs --demo` builds **Team Hub demo** (`plugin/demo-dist/`): the same
pages on sample people and data, with Team Hub's real rules from `server/hub.js` running
in memory inside Buzz. No server, bot or network is needed, and nothing is saved.
A bar at the top previews the page as an Owner, Admin, Member or Guest, and resets it.

The `demo` branch holds just the built demo, so Buzz can install it:
**Settings → Plugins → Manage plugins → From a Git repository**, this repository's URL,
branch `demo`. It installs as a separate plugin (`northstar.team-hub-demo`).
