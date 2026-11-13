// Real React App, isolated public IPC fixtures. This server never opens a model or user workspace.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'vite';
const root=process.cwd(),out=path.join(root,'test-results');
await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(out,'office-team-ui.html'),'<meta name="viewport" content="width=device-width, initial-scale=1"><title>CBIM Office isolated UI check</title><div id="root"></div><script type="module" src="/scripts/office-team-ui-fixture.tsx"></script>');
const server=await createServer({root,configFile:false,esbuild:{jsx:'automatic'},server:{host:'127.0.0.1',port:0},logLevel:'error'});
await server.listen();
console.log(JSON.stringify({url:'http://127.0.0.1:'+server.httpServer.address().port+'/test-results/office-team-ui.html',fixture:'office-team-v1',executionWrites:false}));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await server.close();process.exit(0)});
