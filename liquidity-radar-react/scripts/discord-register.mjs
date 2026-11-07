// Registers Radar AI's Discord slash command (/ask), once per change to it.
//
//   DISCORD_BOT_TOKEN=... node scripts/discord-register.mjs
//
// The token is only needed here, never by the deployed endpoint (api/discord.mjs
// replies through each interaction's own webhook). Keep it out of the repo.
const APP_ID = process.env.DISCORD_APP_ID || '1568628618957955082'
const TOKEN = process.env.DISCORD_BOT_TOKEN
if (!TOKEN) {
  console.error('DISCORD_BOT_TOKEN is not set')
  process.exit(1)
}

const COMMANDS = [
  {
    name: 'ask',
    description: 'Ask Radar AI about the markets, the news calendar or the testnet bot',
    options: [{ type: 3, name: 'question', description: 'Your question, e.g. how is BTC looking?', required: true, max_length: 500 }],
    // In servers (0) and as a user app (1); in servers, bot DMs and private channels.
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
]

const r = await fetch(`https://discord.com/api/v10/applications/${APP_ID}/commands`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json', authorization: 'Bot ' + TOKEN },
  body: JSON.stringify(COMMANDS),
})
const out = await r.text()
if (!r.ok) {
  console.error('HTTP ' + r.status + ': ' + out.slice(0, 500))
  process.exit(1)
}
console.log('registered: ' + JSON.parse(out).map((c) => '/' + c.name).join(', '))
console.log(`invite: https://discord.com/oauth2/authorize?client_id=${APP_ID}&scope=applications.commands%20bot&permissions=0`)
