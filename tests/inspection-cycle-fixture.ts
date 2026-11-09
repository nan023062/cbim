import fs from 'node:fs/promises';
import path from 'node:path';
import type {DispatchScope} from '../src/backend/core/tasks/dispatch-scope';

/** Read only this fixture's durable scopes; never infer recovery identity from rendered labels. */
export async function inspectionScopes(user:string,workspaceId:string):Promise<DispatchScope[]>{
  const raw=await fs.readFile(path.join(user,workspaceId,'dispatch','dispatch.jsonl'),'utf8'),scopes=new Map<string,DispatchScope>();
  for(const line of raw.slice(0,raw.lastIndexOf('\n')).split('\n').filter(Boolean)){const {body}=JSON.parse(line);if(body.workspaceId!==workspaceId)throw Error('Fixture workspace mismatch');for(const scope of body.mutation.scopes??[])scopes.set(scope.scopeId,scope)}return [...scopes.values()];
}

/** Deliberate corruption is restricted to a named fixture root, after every real run has settled. */
export async function corruptInspectionHistory(user:string,workspaceId:string,rootSessionId:string,taskId:string,runId:string){
  const main=path.join(user,workspaceId,'loop-engine','tasks',rootSessionId),oldIds=await fs.readdir(main),files=new Map<string,string>();
  for(const id of oldIds){const file=path.join(main,id,'events.jsonl');await fs.access(file);files.set(file,'{"fixture_old_history_corrupt":}\n')}
  const member=path.join(user,workspaceId,'dispatch','runs','tasks',taskId,runId,'events.jsonl');await fs.access(member);files.set(member,'{"fixture_old_member_corrupt":}\n');
  for(const [file,bytes] of files){const relative=path.relative(path.resolve(user),path.resolve(file));if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Corruption escaped fixture user root');await fs.writeFile(file,bytes)}
  return {oldIds,files,unchanged:async()=>{for(const [file,bytes] of files)if(await fs.readFile(file,'utf8')!==bytes)throw Error('Old malformed history was modified')}};
}
