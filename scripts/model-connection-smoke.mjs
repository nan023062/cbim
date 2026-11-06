// Diagnose the saved default connection without printing or changing credentials.
import {_electron as electron} from 'playwright-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {latestExecutable} from './build-artifact.mjs';
const original=path.join(os.homedir(),'.cbim');
const installed=process.argv.includes('--installed');
const profile=installed?original:await fs.mkdtemp(path.join(os.tmpdir(),'cbim-connection-'));
let app;
try{
  if(!installed){await fs.mkdir(path.join(profile,'desktop'));
  await fs.copyFile(path.join(original,'llm.json'),path.join(profile,'llm.json'));
  await fs.copyFile(path.join(original,'desktop','Local State'),path.join(profile,'desktop','Local State'));
  }
  const executable=await latestExecutable();
  app=await electron.launch({executablePath:executable,env:{...process.env,CBIM_USER_DATA_ROOT:profile},timeout:60000});
  const page=await app.firstWindow();
  const settings=await page.evaluate(()=>window.cbim.call('models.list',{}));
  const selected=settings.profiles.find(p=>p.id===settings.selectedId);
  const result=await page.evaluate(id=>window.cbim.call('models.test',{id}),selected.id);
  console.log(JSON.stringify({installedProfile:installed,executable,model:selected.defaultModel,result}));
}catch(error){console.log(JSON.stringify({ok:false,error:error.message}));process.exitCode=1}
finally{if(app)await app.close().catch(()=>{});if(!installed){await fs.rm(path.join(profile,'llm.json'),{force:true});await fs.rm(path.join(profile,'desktop','Local State'),{force:true})}}
