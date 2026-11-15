import {_electron} from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {verifyDesktopBrand} from './brand-acceptance.mjs';
const executable=process.env.CBIM_TEST_EXE;assert.ok(executable,'Set CBIM_TEST_EXE to the exact packaged executable');
const output=path.resolve(process.env.CBIM_BRAND_REPORT_DIR||'test-results/branding-website');await fs.mkdir(output,{recursive:true});
const profile=await fs.mkdtemp(path.join(output,'isolated-user-')),env={...process.env,CBIM_USER_DATA_ROOT:profile};delete env.ELECTRON_RUN_AS_NODE;
const app=await _electron.launch({executablePath:executable,env,timeout:60000}),errors=[];
try{const page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
await page.locator('.workspace-welcome').waitFor({timeout:60000});
const report=await verifyDesktopBrand({app,page,executable,installer:process.env.CBIM_TEST_INSTALLER,output});assert.deepEqual(errors,[]);console.log(JSON.stringify(report));
}finally{await app.close()}
