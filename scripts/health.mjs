const endpoints = [
  'https://api.devnet.solana.com',
  'https://rpc.magicblock.app/devnet',
  'https://devnet-as.magicblock.app',
];
for (const endpoint of endpoints) {
  try {
    const start = Date.now();
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getGenesisHash',
        params: [],
      }),
    });
    console.log(endpoint, r.status, Date.now() - start + 'ms', await r.text());
  } catch (e) {
    console.log(endpoint, e.message);
  }
}
const s = await (
  await fetch('https://status.magicblock.app/api/services')
).json();
for (const [_region, r] of Object.entries(s.environments.devnet.regions))
  for (const [endpoint, v] of Object.entries(r.servers))
    console.log(endpoint, JSON.stringify(v.live_status));
