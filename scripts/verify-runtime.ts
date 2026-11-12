import {verifyRuntimeCandidate} from './runtime-candidate';
async function main(){const [directory,...rest]=process.argv.slice(2);if(!directory||rest.length)throw Error('用法：pnpm verify:runtime <候选目录>');const result=await verifyRuntimeCandidate(directory);console.log(JSON.stringify({verified:true,codeVersion:result.manifest.codeVersion,resourceVersion:result.manifest.resourceVersion,digest:result.digest}));}
main().catch(error=>{console.error(error.message);process.exitCode=1});
