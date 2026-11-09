import path from 'node:path';
import {signingConfig} from './desktop-signing/config.cjs';
import {createWindowsSigner} from './desktop-signing/windows.mjs';
import {verifyCandidate} from './desktop-signing/artifacts.mjs';

const args = process.argv.slice(2);
if (!args[0] || args[0].startsWith('--') || args.length > 2 || (args[1] && args[1] !== '--unsigned')) throw Error('用法：pnpm verify:desktop <候选目录> [--unsigned]');
const unsigned = args[1] === '--unsigned', config = unsigned ? undefined : signingConfig();
const receipt = await verifyCandidate(path.resolve(args[0]), config, unsigned ? undefined : createWindowsSigner(config), {unsigned});
console.log(JSON.stringify({version: receipt.version, sourceCommit: receipt.sourceCommit, signingMode: unsigned ? 'unsigned' : 'signed', publisherName: config?.publisherName, verified: true}));
