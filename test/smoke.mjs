/**
 * End-to-end smoke test: spawns the MCP server over stdio exactly as an agent
 * would, lists its tools, and calls each one with real arguments.
 *   node test/smoke.mjs
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(here, '..', 'src', 'index.js');

const transport = new StdioClientTransport({
  command: 'node',
  args: [serverPath],
  env: { ...process.env, NODE_PATH: '/root/botchain-mcp/node_modules' },
});
const client = new Client({ name: 'smoke', version: '0.1.0' }, { capabilities: {} });

const show = (label, res) => {
  const text = res.content?.map((c) => c.text).join('\n') ?? JSON.stringify(res);
  console.log(`\n──── ${label} ────`);
  console.log(text.length > 1200 ? text.slice(0, 1200) + '\n…(truncated)' : text);
};

await client.connect(transport);
console.log('connected ✓');

const tools = await client.listTools();
console.log(`tools exposed: ${tools.tools.length}`);
console.log(tools.tools.map((t) => `  ${t.name}`).join('\n'));

const cases = [
  ['chain_stats', {}],
  ['address_overview', { address: '0xfad8473C54c058b58DF32caDf6415FBa15639682' }],
  ['token_info', { token: '0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C', holder: '0xef8DC669ECa13E612b67Ff09478352E85bD6CC53' }],
  ['bridge_status', { chainId: 1 }],
  ['bridge_status', { chainId: 56 }],
  ['bridge_status', { chainId: 677 }],
  ['ecosystem_votes', { projectId: 508, hours: 6 }],
  ['contract_inspect', { address: '0xef8DC669ECa13E612b67Ff09478352E85bD6CC53' }],
];

for (const [name, args] of cases) {
  try {
    const res = await client.callTool({ name, arguments: args });
    show(`${name} ${JSON.stringify(args)}`, res);
  } catch (e) {
    console.log(`\n──── ${name} FAILED ────\n${e.message}`);
  }
}

// bridge_config is verbose — show a summary instead
try {
  const res = await client.callTool({ name: 'bridge_config', arguments: {} });
  const data = JSON.parse(res.content.map((c) => c.text).join(''));
  console.log('\n──── bridge_config (summary) ────');
  console.log(JSON.stringify(data.chains.map((c) => ({
    chainId: c.chainId, name: c.name, bridge: c.bridgeContract,
    tokens: c.tokens.map((t) => t.symbol),
  })), null, 1));
} catch (e) { console.log('bridge_config FAILED', e.message); }

await client.close();
console.log('\nsmoke test complete');
