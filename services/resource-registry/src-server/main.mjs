import { startRegistry } from './registry.mjs';
const {url,close}=await startRegistry({data:process.env.REGISTRY_DATA ?? 'data',token:process.env.REGISTRY_TOKEN,port:Number(process.env.PORT ?? 4179)});
console.log('Resource registry: '+url);
for(const event of ['SIGINT','SIGTERM']) process.once(event,close);
