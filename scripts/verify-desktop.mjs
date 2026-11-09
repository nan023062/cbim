import path from 'node:path';
import {signingConfig} from './desktop-signing/config.cjs';
import {createWindowsSigner} from './desktop-signing/windows.mjs';
import {verifyCandidate} from './desktop-signing/artifacts.mjs';

if (process.argv.length !== 3) throw Error('用法：pnpm verify:desktop <签名候选目录>');
const config = signingConfig();
const receipt = await verifyCandidate(path.resolve(process.argv[2]), config, createWindowsSigner(config));
console.log(JSON.stringify({version: receipt.version, sourceCommit: receipt.sourceCommit, publisherName: config.publisherName, verified: true}));
