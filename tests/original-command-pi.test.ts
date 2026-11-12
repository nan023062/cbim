import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {Application} from '../src/backend/main/assembly/application';
import {Paths} from '../src/backend/main/platform/paths';
import {commandVerificationReportSchema} from '../src/backend/core/tasks/command-verification';
import {originalCommandProvider,originalCommandData as data,type OriginalCommandMode} from './original-command-provider';
import {executeOriginalCommandSeed,waitOriginalCommand,originalCommandRecords,originalCommandLogBytes,originalCommandRunBytes,originalCommandByteEvidence,archiveOriginalCommandEvidence} from './original-command-fixture';

it.each(['bad-plan','bad-dispatch','absent-plan']as OriginalCommandMode[])('verifies original actual main command without replaying failed output (%s)',async mode=>{
  const f=await fixture(),provider=await originalCommandProvider(mode);let app=f.app,keepTemp=false;
  const directory='test-results/original-command-'+mode+'-pi-bytes';
  try{
    const seeded=await executeOriginalCommandSeed(app,f.user,f.a,provider,mode),id=seeded.seeded.entry.id,query=seeded.query;
    const read=async(input=query)=>commandVerificationReportSchema.parse(await app.dispatch('dispatch.commandReport',input));
    const first=await read();expect(first.command).toEqual(provider.state.report!.command);expect(first.source.outcome).toBe('failed');expect(first.scope?.status).toBe('closed');expect(first.acceptance).toBe('not_evaluated');expect(first.readOnly).toBe(true);expect(first.command.state).toBe(mode==='absent-plan'?'absent':'committed');
    expect(JSON.stringify(first)).not.toMatch(/sessionFile|nativeSessionId|apiKey|baseUrl|"prepared"/);
    const source=seeded.thread[0],failed=source.events.filter(event=>event.type==='tool.finished'&&event.data.id===query.toolCallId);expect(failed).toHaveLength(1);expect(failed[0].data.isError).toBe(true);expect(JSON.stringify(failed)).toContain(mode==='absent-plan'?'TEST_BEFORE_COMMIT':'TOOL_OUTPUT_INVALID');
    expect(source.toolReceipts?.filter(receipt=>receipt.toolName==='cbim_dispatch_command_report')).toEqual(expect.arrayContaining([expect.objectContaining({outcome:'succeeded',effects:['read']})]));
    const readonly=await read({...query,toolCallId:'original-initial-inspect'});expect(readonly.command).toEqual({state:'not_applicable',reason:'readonly_tool'});
    const unknown=await read({...query,toolCallId:'never-issued-call'});expect(unknown.command).toMatchObject({state:'unverifiable'});expect(unknown.command).not.toHaveProperty('commandId');expect(unknown.command).not.toHaveProperty('result');
    const before=await fs.readFile(path.join(f.user,id,'dispatch','dispatch.jsonl')),logBytes=await originalCommandLogBytes(f.user,id),counts={main:provider.main.length,member:provider.member.length,other:provider.other.length};
    for(let index=0;index<3;index++){const again=await read();expect(again.command).toEqual(first.command);expect(again.source).toEqual(first.source);expect(again.basis).toEqual(first.basis)}
    expect(await fs.readFile(path.join(f.user,id,'dispatch','dispatch.jsonl'))).toEqual(before);expect(await originalCommandLogBytes(f.user,id)).toEqual(logBytes);expect({main:provider.main.length,member:provider.member.length,other:provider.other.length}).toEqual(counts);
    // A second genuinely created root must not borrow the first root's native/canonical or transaction result.
    const other=await app.dispatch('loop.chat',{id,message:data.otherGoal,options:seeded.seeded.options});await waitOriginalCommand(async()=>(await originalCommandRecords(f.user,id)).scopes.every(scope=>scope.status==='closed')&&app.runtime.snapshot().pressure.activeRuns===0,provider,'independent root settled');
    expect(provider.other).toHaveLength(1);const wrongRoot=await read({...query,rootSessionId:other.taskId});expect(wrongRoot.command).toEqual({state:'unverifiable',reason:'source_unverified'});expect(wrongRoot.source.toolName).toBeUndefined();expect(wrongRoot.scope).toBeUndefined();if(first.command.state==='committed'||first.command.state==='absent')expect(JSON.stringify(wrongRoot)).not.toContain(first.command.commandId);
    const saved=await originalCommandRecords(f.user,id),allLogs=await originalCommandLogBytes(f.user,id),journal=await fs.readFile(path.join(f.user,id,'dispatch','dispatch.jsonl')),runBytes=await originalCommandRunBytes(f.user,id,query.rootSessionId,await app.execution(id).thread(query.rootSessionId),saved.runs),secondaryBytes=await originalCommandRunBytes(f.user,id,other.taskId,await app.execution(id).thread(other.taskId),[]);
    await archiveOriginalCommandEvidence(directory,f.user,id,[...runBytes,...secondaryBytes]);
    await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();
    const restored=await read();expect(restored.command).toEqual(first.command);expect(restored.source).toEqual(first.source);expect(await originalCommandRecords(f.user,id)).toEqual(saved);expect(await originalCommandLogBytes(f.user,id)).toEqual(allLogs);expect(await fs.readFile(path.join(f.user,id,'dispatch','dispatch.jsonl'))).toEqual(journal);expect(await originalCommandRunBytes(f.user,id,query.rootSessionId,await app.execution(id).thread(query.rootSessionId),saved.runs)).toEqual(runBytes);expect(await originalCommandRunBytes(f.user,id,other.taskId,await app.execution(id).thread(other.taskId),[])).toEqual(secondaryBytes);expect({main:provider.main.length,member:provider.member.length,other:provider.other.length}).toEqual({...counts,other:1});expect(provider.errors).toEqual([]);
    await fs.writeFile(`test-results/original-command-${mode}-pi-evidence.json`,JSON.stringify({mode,realPi:true,provider:'local deterministic HTTP',query,first,readonly,unknown,wrongRoot,restored,requests:{main:provider.main.length,member:provider.member.length,other:provider.other.length},faultCounts:seeded.faultCounts,originalFailurePreserved:true,queryWroteNoJournal:true,restartWithoutReplay:true,runBytes:originalCommandByteEvidence([...runBytes,...secondaryBytes]),bytesDirectory:directory,sourceFaultInjection:mode==='absent-plan'?'test throw before real plan transaction':'await actual commit then corrupt returned wire only'},null,2));
  }catch(error){keepTemp=true;await fs.mkdir('test-results',{recursive:true});await fs.writeFile(`test-results/original-command-${mode}-pi-failure.json`,JSON.stringify({mode,temp:f.temp,error:String(error),state:provider.state,mainRequests:provider.main.length,memberRequests:provider.member.length,otherRequests:provider.other.length,providerErrors:provider.errors},null,2));throw error}
  finally{provider.release();await app.shutdown();await provider.close();if(!keepTemp)await f.cleanup()}
},150000);
