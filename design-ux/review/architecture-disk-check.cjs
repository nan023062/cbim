// Exercise project-local snapshot validation and atomic writes against a fresh directory.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const ts=require('typescript');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const {ProjectTrees}=require('../../src/logic/projects/project-trees.ts');
const {OrganizationDirectory}=require('../../src/logic/projects/organization-directory.ts');
const {BusinessDirectory}=require('../../src/logic/projects/business-directory.ts');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cbim-ux-disk-'));
 try{
 const open=()=>new ProjectTrees(root,undefined);
 const projects={Open:async()=>({trees:open(),runtime:{project:{UpdateTree(){}}}})};
 const org=new OrganizationDirectory(projects),biz=new BusinessDirectory(projects);
 await open().SaveOrganization({revision:0,nodes:[{id:'team',kind:'team',parentId:null,name:'资源团队',position:''},{id:'member',kind:'agent',parentId:'team',name:'维护岗',position:''}]});
 const team=(revision,teamSkills)=>org.Change('demo',{action:'update',id:'team',revision,parentId:null,name:'资源团队',position:'',teamSkills});
 const skill={id:'review',name:'核对清单',content:'检查版本与来源'};
 await team(0,[skill]);await assert.rejects(()=>team(0,[]));
 await team(1,[{...skill,content:'核对来源'}]);
 assert.equal((await open().Organization()).nodes[0].teamSkills[0].content,'核对来源');
 assert.equal((await open().Organization()).nodes[1].teamSkills,undefined);
 await team(2,[]);assert.deepEqual((await open().Organization()).nodes[0].teamSkills,[]);
 await open().SaveBusiness({revision:0,nodes:[]});
 const definition={name:'引擎管理',parentId:null,summary:'',sources:[],virtual:true};
 const snapshot=await biz.Change('demo',{action:'create',revision:0,definition});
 const id=snapshot.nodes[0].id,output={name:'回退报告',description:'记录版本',path:'报告',criteria:['可重新安装','重启后识别']};
 const save=(revision,outputs)=>biz.Change('demo',{action:'update',revision,id,definition:{...definition,outputs,workflows:[{name:'回退',reference:'docs/rollback.md'}]}});
 await save(1,[output]);await assert.rejects(()=>save(1,[]));
 await save(2,[{...output,criteria:['重启后识别']}]);
 const actual=(await open().Business()).nodes[0];assert.deepEqual(actual.outputs[0].criteria,['重启后识别']);assert.equal(actual.workflows[0].reference,'docs/rollback.md');
 await save(3,[]);assert.deepEqual((await open().Business()).nodes[0].outputs,[]);
 console.log('Production services: legacy fields, team skills CRUD/isolation, outputs/criteria CRUD, workflow reference, stale saves and reopen from disk PASS');
 }finally{fs.rmSync(root,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
