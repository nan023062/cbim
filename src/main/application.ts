import path from 'node:path';
import fs from 'node:fs/promises';
import {Catalog} from './catalog';
import {Paths,exists,fail,readJson,atomic,json} from './paths';
import {Rules} from './knowledge';
import {Workspace} from './workspace';
import {serve} from './mcp';
import {ResourceRepositories} from './resource-repository';
export class Application {
  readonly catalog:Catalog;readonly rules:Rules;readonly running=new Map<string,Workspace>();private opening=new Map<string,Promise<Workspace>>();
  readonly resources:ResourceRepositories;
  constructor(readonly paths:Paths,designRoot:string){this.catalog=new Catalog(paths);this.rules=new Rules(designRoot);this.resources=new ResourceRepositories(paths)}
  async init(){await this.catalog.init();await this.rules.init();await this.resources.init()}
  async list(){const data=await this.catalog.read();return {...data,warning:this.catalog.warning,entries:await Promise.all(data.entries.map(async e=>this.running.get(e.id)?.view()||{...e,state:await exists(e.path)?'registered':'missing',tasks:[],writable:false}))}}
  workspace(id:string){const ws=this.running.get(id);if(!ws)fail('NOT_RUNNING','工作区未运行，请由用户在桌面打开');return ws}
  async open(id:string){if(this.running.get(id)?.state==='running')return this.running.get(id)!;if(this.opening.has(id))return this.opening.get(id)!;
    const pending=(async()=>{const entry=(await this.catalog.read()).entries.find(x=>x.id===id);if(!entry)fail('NOT_REGISTERED','工作区未登记');const ws=new Workspace(entry,this.paths,this.rules);this.running.set(id,ws);
      await ws.open(serve);await this.catalog.update(d=>{const item=d.entries.find(e=>e.id===id);if(item)item.lastOpened=new Date().toISOString();d.recent=[id,...d.recent.filter(x=>x!==id)].slice(0,30);d.lastRunning=[...new Set([...d.lastRunning,id])]});return ws})();this.opening.set(id,pending);try{return await pending}finally{this.opening.delete(id)}
  }
  async close(id:string){await this.opening.get(id)?.catch(()=>{});const ws=this.running.get(id);await ws?.close();this.running.delete(id);await this.catalog.update(d=>{d.lastRunning=d.lastRunning.filter(x=>x!==id)})}
  async remove(id:string){await this.close(id);await this.catalog.remove(id)}
  async restore(){const d=await this.catalog.read();if(d.settings.restore)for(const id of d.lastRunning){try{await this.open(id)}catch{/* visible failed state retained */}}}
  async shutdown(){await Promise.allSettled([...this.opening.values()]);await Promise.all([...this.running.values()].map(w=>w.close()));await this.resources.close();this.running.clear()}
  async dispatch(action:string,args:any={}){switch(action){
    case 'list':return this.list();
    case 'resources.status':return this.resources.status();
    case 'resources.configure':return this.resources.configure(args);
    case 'resources.list':return this.resources.read();
    case 'resources.save':return this.resources.save(args);
    case 'resources.remove':return this.resources.remove(args);
    case 'resources.share':return this.resources.startSharing(args);
    case 'resources.stopSharing':return this.resources.stopSharing();
    case 'resources.connection':return this.resources.connection();
    case 'add':return this.catalog.add(args.path);
    case 'open':return (await this.open(args.id)).view();
    case 'close':return this.close(args.id);
    case 'remove':return this.remove(args.id);
    case 'relocate':await this.close(args.id);return this.catalog.relocate(args.id,args.path,args.confirm===true);
    case 'settings':return this.catalog.update(d=>{d.settings.restore=args.restore===true});
    case 'forgetRecent':return this.catalog.update(d=>{d.recent=d.recent.filter(x=>x!==args.id)});
    case 'snapshot':return this.workspace(args.id).snapshot();
    case 'preview':return this.workspace(args.workspaceId).preview(args);
    case 'commit':return this.workspace(args.workspaceId).commit(args);
    case 'movePreview':{const ws=this.workspace(args.id);return ws.preview(await ws.planMove(await ws.read(),args.from,args.to))}
    case 'writeAccess':{const ws=this.workspace(args.id);ws.assert();ws.writable=args.enabled===true;return ws.view()}
    case 'task':if(!['validate','reindex'].includes(args.name))fail('TOOL','不支持的工具');return this.workspace(args.id).startTask(args.name);
    case 'cancelTask':return this.workspace(args.id).cancelTask(args.taskId);
    case 'local':if(!['memory','task-records','logs'].includes(args.kind))fail('TYPE','未知本地数据类型');return this.workspace(args.id).localData(args.kind);
    case 'discovery':{const ws=this.workspace(args.id);return {...await readJson(this.paths.discovery(ws.entry.id)),credentialsPath:path.join(this.paths.project(ws.entry.id),'credentials.json')}}
    default:fail('ACTION','未知操作');
  }}
}
