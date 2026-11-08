import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {runIsolatedNode} from '../src/backend/main/platform/isolated-node';
const receipt=path.resolve(process.argv[2]);if(path.dirname(path.dirname(receipt))!==path.resolve(os.tmpdir())||!path.basename(path.dirname(receipt)).startsWith('cbim-isolation-crash-'))throw Error('receipt');
const code=`const fs=require('fs');const child=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',detached:true});fs.writeFileSync('descendant.json',JSON.stringify({pid:child.pid}));setInterval(()=>{},1000);`;
void runIsolatedNode({entry:'main.cjs',files:[{path:'main.cjs',base64:Buffer.from(code).toString('base64')}],timeoutMs:30000},new AbortController().signal,{onStarted:value=>fs.writeFileSync(receipt,JSON.stringify(value),{flag:'wx'})}).then(()=>{process.exitCode=2}).catch(error=>{console.error(error);process.exitCode=1});
