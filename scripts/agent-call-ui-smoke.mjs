// Exercise the real readonly Agent detail components against explicit public IPC fixtures.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
const root=await fs.realpath(process.env.CBIM_UI_ROOT||process.cwd()),out=path.join(root,'test-results');await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(out,'agent-call-ui.html'),'<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/test-results/agent-call-ui.tsx"></script>');
await fs.writeFile(path.join(out,'agent-call-ui.tsx'),String.raw`
import React from 'react';import {createRoot} from 'react-dom/client';
import '/src/view/styles';
import {inlineMainRuns} from '/src/view/execution-view/unittest/support/inline-conversation-fixture.ts';
import {ToolTimeline} from '/src/view/execution-view/ToolTimeline.tsx';
import {AgentCallDetails} from '/src/view/execution-view/AgentCallDetails.tsx';
const parent=structuredClone(inlineMainRuns(0)[0]);parent.status='completed';
const first={version:1,workspaceId:parent.task.workspaceId,callerTaskId:parent.task.taskId,callerRunId:parent.runId,toolCallId:'first',taskId:'child',runId:'child-run'};
const second={...first,callerTaskId:'child',callerRunId:'child-run',toolCallId:'second',taskId:'grandchild',runId:'grandchild-run'};
function child(ref,text){const r=structuredClone(parent);r.task={...r.task,taskId:ref.taskId,input:'Instruction from caller'};r.runId=ref.runId;r.events=[{...r.events[0],taskId:ref.taskId,runId:ref.runId,data:{agentCall:ref}},{...r.events[0],taskId:ref.taskId,runId:ref.runId,seq:2,type:'message',data:{text}}];return r}
function tool(r,ref){r.events.push({...r.events[0],seq:10,type:'tool.updated',data:{id:ref.toolCallId,name:'cbim_agent_call',agentCall:ref,input:{input:'Inspect code'}}})}
tool(parent,first);const one=child(first,'Child verified reply'),two=child(second,'Grandchild verified reply');tool(one,second);
window.fixture={calls:[],invalid:false};window.cbim={call:async(action,args)=>{window.fixture.calls.push({action,args});if(action!=='loop.inspect')throw Error('Unexpected action '+action);const r=structuredClone(args.taskId==='child'?one:two);if(window.fixture.invalid)r.runId='wrong-run';return r}};
createRoot(document.getElementById('root')).render(<main><textarea aria-label="Main draft" defaultValue="Keep draft"/><ToolTimeline run={parent} toolCallId="first" renderDetails={id=><AgentCallDetails parentRun={parent} toolCallId={id}/>}/></main>);
`);
const server=await createServer({root,configFile:false,optimizeDeps:{entries:['test-results/agent-call-ui.tsx']},esbuild:{jsx:'automatic'},server:{host:'127.0.0.1',port:0},logLevel:'error'});let browser;
const checks=[],errors=[];
try{
 await server.listen();browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1200,height:900}});page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
 const url='http://127.0.0.1:'+server.httpServer.address().port+'/test-results/agent-call-ui.html';
 assert.equal((await fetch(url,{signal:AbortSignal.timeout(10000)})).status,200);
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
 assert.equal(await page.evaluate(()=>window.fixture.calls.length),0);
 if(!await page.locator('main details').first().evaluate(node=>node.open))await page.locator('main details > summary').first().click();
 await page.getByRole('button',{name:'查看执行对话',exact:true}).click();const dialogs=page.locator('dialog[open]');await dialogs.first().getByText('Child verified reply',{exact:true}).waitFor();
 assert.equal(await dialogs.first().locator('textarea').count(),0);checks.push('pending-reference-lazy-read-and-readonly');
 if(!await dialogs.first().locator('details').first().evaluate(node=>node.open))await dialogs.first().locator('details > summary').first().click();await dialogs.first().getByRole('button',{name:'查看执行对话',exact:true}).click();await dialogs.last().getByText('Grandchild verified reply',{exact:true}).waitFor();assert.equal(await dialogs.count(),2);checks.push('recursive-tool-detail');
 await dialogs.last().getByRole('button',{name:'返回调用方',exact:true}).click();assert.equal(await dialogs.count(),1);
 await page.setViewportSize({width:320,height:760});const bounds=await dialogs.first().evaluate(node=>({width:node.clientWidth,scroll:node.scrollWidth}));assert.ok(bounds.scroll<=bounds.width+1,JSON.stringify(bounds));await page.screenshot({path:path.join(out,'agent-call-mobile.png')});checks.push('320px-full-width-and-return');
 await dialogs.first().getByRole('button',{name:'返回调用方',exact:true}).first().click();assert.equal(await page.getByRole('textbox',{name:'Main draft'}).inputValue(),'Keep draft');
 await page.evaluate(()=>window.fixture.invalid=true);await page.getByRole('button',{name:'查看执行对话',exact:true}).first().click();await dialogs.first().getByRole('alert').waitFor();
 const before=await page.evaluate(()=>window.fixture.calls.length);await page.evaluate(()=>window.fixture.invalid=false);await dialogs.first().getByRole('button',{name:'重试读取',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('dialog[open] [role="alert"]'));assert.equal(await page.evaluate(()=>window.fixture.calls.length),before+1);checks.push('identity-rejection-and-read-only-retry');
 assert.deepEqual(errors,[]);assert.ok((await page.evaluate(()=>window.fixture.calls)).every(item=>item.action==='loop.inspect'));
 const report={checks,pageErrors:errors,executionWrites:0};await fs.writeFile(path.join(out,'agent-call-ui-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser?.close();await server.close()}
