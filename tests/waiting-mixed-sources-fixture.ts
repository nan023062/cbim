import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {channel} from 'node:diagnostics_channel';
import type {Application} from '../src/backend/main/assembly/application';
import {ChatInputs} from '../src/backend/main/materials/chat-inputs';
import type {ChatAttachment} from '../src/bridge/contracts/chat';
import type {RepositoryConnectionPreview,RepositoryConnectionReceipt} from '../src/backend/core/connectors/repository-connection';
import type {ResourceLibrarySnapshot} from '../src/bridge/contracts/resources';
import type {RepositoryListOutput,RepositoryToolTarget} from '../src/backend/core/connectors/repository-tools';
import {seedWaitingAttachments,attachmentHash,attachmentWait} from './waiting-attachments-fixture';
import {mixedSourceData,mixedResourceKinds,mixedResourceText,waitingMixedSourcesProvider} from './waiting-mixed-sources-provider';
export {attachmentHash,attachmentWait};
export {additionRecords as mixedRecords,additionRunBytes as mixedRunBytes,additionRunByteEvidence as mixedRunByteEvidence} from './queued-dependency-addition-fixture';

/** Observes real Undici HTTP request identities only. Never captures credentials or changes transport behavior. */
export function observeRepositoryHttp(origin:string){
  const requests:Array<{method:string;path:string}>=[],topic=channel('undici:request:create');
  const listener=(value:unknown)=>{const {request}=value as {request?:{origin?:string;path?:string;method?:string}};if(String(request?.origin)===origin)requests.push({method:request?.method??'',path:request?.path??''})};topic.subscribe(listener);return {requests,close:()=>topic.unsubscribe(listener)};
}

/** Real same-application store, seven resources, explicit sharing, connector knowledge transaction, then independent workspace grant. */
export async function seedMixedSources(app:Application,project:string,temp:string,provider:Awaited<ReturnType<typeof waitingMixedSourcesProvider>>){
  const seed=await seedWaitingAttachments(app,project,provider),repository=path.join(temp,'mixed-resource-library'),folder=path.join(project,'selected-directory');
  await fs.mkdir(repository);await fs.mkdir(path.join(folder,'nested'),{recursive:true});await fs.mkdir(path.join(folder,'.cbim'));
  await fs.writeFile(path.join(folder,mixedSourceData.listingName),'Only the filename should be listed');await fs.writeFile(path.join(folder,'nested','private-body.txt'),mixedSourceData.nestedFact);await fs.writeFile(path.join(folder,'.cbim','hidden.json'),'not attachment content');
  await app.dispatch('resources.configure',{mode:'local',location:repository});let library=await app.dispatch('resources.list') as ResourceLibrarySnapshot;
  for(const kind of mixedResourceKinds)library=await app.dispatch('resources.save',{repositoryId:library.repositoryId,revision:library.revision,item:{kind,name:'资料 '+kind,summary:'明确保存的 '+kind+' 静态参考',content:mixedResourceText(kind)}}) as ResourceLibrarySnapshot;
  await app.dispatch('resources.share',{lan:false,port:0});const sharing=app.resources.status().sharing;assert.ok(sharing);const workspace=app.workspace(seed.entry.id),identity={workspaceId:seed.entry.id,instanceId:workspace.instanceId},knowledge=await workspace.snapshot();
  const preview=await app.dispatch('resources.connection.preview',{...identity,revision:knowledge.revision,repositoryId:library.repositoryId,connectorId:mixedSourceData.connectorId,name:'补充资料共享仓库',summary:'七种静态资料，只有实际只读HTTP导入才成为附件快照'}) as RepositoryConnectionPreview;
  await app.dispatch('resources.connection.commit',{...identity,planId:preview.planId});
  const grant=await app.dispatch('resources.connection.grant',{...identity,connectorId:mixedSourceData.connectorId,repositoryId:library.repositoryId,definitionHash:preview.definitionHash,expectedGrantRevision:0,commandId:randomUUID()}) as RepositoryConnectionReceipt;
  const trace=observeRepositoryHttp(sharing.url);
  const targets=async(current:Application)=>{const result=await current.dispatch('chat.materialTargets',{id:seed.entry.id}) as {workspaceId:string;instanceId:string;targets:RepositoryToolTarget[]};assert.equal(result.workspaceId,seed.entry.id);assert.equal(result.instanceId,current.workspace(seed.entry.id).instanceId);return result};
  const importSources=async(current:Application)=>{
    const inputs=new ChatInputs(current.workspace(seed.entry.id)),items=await seed.importFiles(current);items.push(await inputs.path('folder',folder));
    for(const kind of ['link','web'] as const)items.push(await current.dispatch('chat.import',{id:seed.entry.id,importId:randomUUID(),attachment:{kind,value:provider.webUrl+(kind==='link'?'/reference-no-fetch':'/page')}}) as ChatAttachment);
    const before=trace.requests.length,available=await targets(current);assert.equal(trace.requests.length,before,'Discovering captured targets does not fetch');const target=available.targets.find(item=>item.connectorId===mixedSourceData.connectorId);assert.ok(target);
    const listing=await current.dispatch('chat.materialList',{id:seed.entry.id,importId:randomUUID(),connectorId:target.connectorId,connectionId:target.connectionId,limit:50}) as RepositoryListOutput;assert.equal(listing.revision,library.revision);assert.equal(listing.totalItems,7);
    for(const kind of mixedResourceKinds){const item=listing.items.find(item=>item.kind===kind);assert.ok(item);items.push(await current.dispatch('chat.import',{id:seed.entry.id,importId:randomUUID(),attachment:{kind:'repository_resource',connectorId:target.connectorId,connectionId:target.connectionId,expectedRevision:listing.revision,resourceId:item.id}}) as ChatAttachment)}
    assert.equal(items.length,12);return {items,target,listing};
  };
  const changeSources=async(current:Application)=>{
    await fs.writeFile(seed.sources.text,'MIXED_FILE_AFTER_IMPORT_MUST_NOT_APPEAR');await fs.unlink(seed.sources.image);await fs.writeFile(path.join(folder,'ADDED_AFTER_IMPORT.txt'),'new');provider.changeWeb();
    const currentLibrary=await current.dispatch('resources.list') as ResourceLibrarySnapshot,item=currentLibrary.items[0];await current.dispatch('resources.save',{repositoryId:currentLibrary.repositoryId,revision:currentLibrary.revision,id:item.id,item:{kind:item.kind,name:item.name,summary:item.summary,content:'MIXED_RESOURCE_AFTER_IMPORT_MUST_NOT_APPEAR'}});
    await current.dispatch('resources.connection.revoke',{...identity,connectorId:mixedSourceData.connectorId,expectedGrantRevision:grant.grant.revision,commandId:randomUUID()});await current.dispatch('resources.stopSharing');await provider.closeWeb();
  };
  return {...seed,repository,folder,identity,library,grant,preview,trace,targets,importSources,changeSources};
}

export async function mixedSnapshotEvidence(seed:{snapshotPath:(id:string)=>string},items:ChatAttachment[]){return Promise.all(items.map(async item=>{const bytes=await fs.readFile(seed.snapshotPath(item.id));return {attachmentId:item.id,snapshotHash:attachmentHash(bytes),saved:JSON.parse(bytes.toString('utf8')) as Record<string,unknown>}}))}
