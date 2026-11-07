import {app as electronApp} from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {Application} from '../src/backend/main/application';
import {Paths} from '../src/backend/main/platform/paths';
import {createControlledFileTransport} from '../src/backend/main/platform/controlled-file-transport';
import type {ControlledFileTransport,ExclusiveControlledFile} from '../src/backend/main/platform/controlled-file-protocol';
import {seedControlledFile} from './controlled-file-seed';
import type {ControlledHostConfig,ControlledHostTrace} from './controlled-file-electron-fixture';

// 仅由 tests/controlled-file-electron-fixture 创建的独立 Electron 进程启动，不导入产品 main.ts 或创建窗口。
const config=JSON.parse(fs.readFileSync(process.env.CBIM_CONTROLLED_TEST_CONFIG!,'utf8'))as ControlledHostConfig;
assert.ok(path.basename(config.root).startsWith('cbim-controlled-file-'));assert.ok(path.resolve(config.user).startsWith(path.resolve(config.root)+path.sep));
electronApp.setPath('userData',path.join(config.root,'electron-user-data'));electronApp.disableHardwareAcceleration();electronApp.on('window-all-closed',()=>{});
const send=(value:unknown)=>process.stdout.write('CBIM_CONTROLLED_TEST '+JSON.stringify(value)+'\n');
const traces:ControlledHostTrace[]=[];let application:Application|undefined;
let stopGate:{release:()=>void;promise:Promise<void>}|undefined,holdBeforeWrite=false;
const faultState={beforeWriteReached:false,signalAborted:false,appliedWriteCalls:0,corruptedOutputs:0};

function observedTransport(real:ControlledFileTransport):ControlledFileTransport{
  return {
    withExclusiveExisting:async(root,relativePath,protectedRoots,signal,use)=>{
      traces.push({kind:'open-request'});
      return real.withExclusiveExisting(root,relativePath,protectedRoots,signal,async session=>{
        const internal=session as ExclusiveControlledFile&{child?:{pid?:number;on:(name:string,fn:(value:any)=>void)=>void};exited?:Promise<void>};
        assert.ok(internal.child?.pid,'必须实际启动持有句柄的 utility child');assert.ok(internal.exited);
        const pid=internal.child.pid;traces.push({kind:'opened',pid});void internal.exited.then(()=>traces.push({kind:'exited',pid}));
        internal.child.on('message',reply=>traces.push({kind:'reply',pid,phase:reply.kind,seq:reply.seq,...(reply.code?{code:reply.code}:{}),...(typeof reply.writeIssued==='boolean'?{writeIssued:reply.writeIssued}:{})}));
        const stopped=()=>{faultState.signalAborted=true;traces.push({kind:'aborted',pid,writeIssued:session.writeIssued})};signal.addEventListener('abort',stopped,{once:true});
        const wrapper:ExclusiveControlledFile={readBefore:()=>session.readBefore(),recheckIdentity:()=>session.recheckIdentity(),get writeIssued(){return session.writeIssued},replaceAndFlush:async bytes=>{
          traces.push({kind:'replace-enter',pid,byteLength:bytes.byteLength});
          if(holdBeforeWrite){holdBeforeWrite=false;faultState.beforeWriteReached=true;await stopGate!.promise}
          const result=await session.replaceAndFlush(bytes);traces.push({kind:'replace-confirmed',pid,byteLength:result.fact.byteLength,sha256:result.fact.sha256});return result;
        }};
        try{return await use(wrapper)}finally{signal.removeEventListener('abort',stopped)}
      });
    },
    drain:async root=>{traces.push({kind:'transport-drain'});await real.drain(root);traces.push({kind:'transport-drained'})},
    close:async()=>{traces.push({kind:'transport-close'});await real.close();traces.push({kind:'transport-closed'})},
  };
}

async function handle(op:string,args:any){
  assert.ok(application);
  if(op==='seed')return seedControlledFile(application,config.project,args.providerUrl);
  if(op==='dispatch')return application.dispatch(args.action,args.args);
  if(op==='trace')return traces;
  if(op==='fault-status')return faultState;
  if(op==='corrupt-applied-output'){
    const service=application.controlledFiles(args.workspaceId),write=service.write.bind(service);
    service.write=async(...values:Parameters<typeof write>)=>{
      const actual=await write(...values);faultState.appliedWriteCalls++;assert.equal(actual.state,'applied');
      faultState.corruptedOutputs++;return {...structuredClone(actual),toolCallId:'different-controlled-call'};
    };
    return {armed:true,afterRealAppliedOnly:true};
  }
  if(op==='hold-before-write'){
    assert.equal(holdBeforeWrite,false);let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve});stopGate={release,promise};holdBeforeWrite=true;return {armed:true};
  }
  if(op==='release-before-write'){stopGate?.release();return {released:true}}
  if(op==='shutdown'){await application.shutdown();return {closed:true}}
  throw Error('Unknown controlled test host operation '+op);
}

void electronApp.whenReady().then(async()=>{
  const transport=observedTransport(createControlledFileTransport({entryPath:config.childEntry,koffiPath:config.koffiPath}));
  application=new Application(new Paths(config.user,config.repository),path.join(config.repository,'design'),undefined,{controlledFiles:transport});await application.init();
  // Windows GUI Electron 不保证继承的 stdin 可持续读取；测试控制使用仅 loopback 的私有随机端口。
  const server=http.createServer(async(req,res)=>{try{assert.equal(req.method,'POST');assert.equal(req.headers['x-cbim-test-token'],config.controlToken);let body='';for await(const chunk of req)body+=chunk;const request=JSON.parse(body),value=await handle(request.op,request.args);res.end(JSON.stringify({value}));if(request.op==='shutdown')res.once('finish',()=>{server.close();setImmediate(()=>electronApp.exit(0))})}catch(error){res.end(JSON.stringify({error:{message:String(error instanceof Error?error.message:error),code:(error as {code?:string})?.code,stack:error instanceof Error?error.stack:undefined}}))}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  send({ready:true,pid:process.pid,port:address.port,electron:process.versions.electron,node:process.version,realUtilityTransport:true});
}).catch(error=>{send({ready:false,error:String(error),stack:error instanceof Error?error.stack:undefined});electronApp.exit(1)});
