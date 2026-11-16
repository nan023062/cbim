
import React from 'react';import {createRoot} from 'react-dom/client';import '../src/view/styles';
window.cbim={call:async(action,args)=>{
if(action==='models.list')return {profiles:[],secureStorage:true};
if(action==='list')return {entries:[]};
if(action==='resources.status')return {source:'local',session:{state:'signedOut'},config:{location:'C:/isolated/resources',repositoryId:'visual'}};
if(action==='resources.list')return {repositoryId:'visual',revision:'1',items:[]};
if(action==='automation.list')return {version:1,jobs:[],runs:[]};
if(action==='automation.catalog')return {agents:[],modules:[],workflows:[],skills:[]};
if(action==='agentHistory.roles')return {roles:[],diagnostics:[]};
throw Error('隔离验收：来源暂不可用，请刷新核实。');
}};
const {summarizeScope}=await import('../src/logic/tasks/rules/scope-view');
const {ChatMessages}=await import('../src/view/conversation/ChatMessages');
const {inlineMainRuns}=await import('../tests/inline-conversation-fixture');
const {TeamView}=await import('../src/view/team/TeamView');
const {BusinessArchitecture}=await import('../src/view/workspace/WorkspaceView');
const {WorkspaceDiagnostics}=await import('../src/view/diagnostics/WorkspaceDiagnostics');
const {AutomationView}=await import('../src/view/automation/AutomationView');
const {ResourceRepositoryView}=await import('../src/view/resources/ResourceRepositoryView');
const {RuntimeOverview}=await import('../src/view/runtime/RuntimeOverview');
const {ArchitectureEditor}=await import('../src/view/knowledge/ArchitectureEditor');
const {ModuleGovernancePanel}=await import('../src/view/governance/ModuleGovernancePanel');
const {ModuleOwnershipPanel}=await import('../src/view/workspace/ModuleOwnershipPanel');
const {WorkspaceMembers}=await import('../src/view/team/WorkspaceMembers');
const {AgentSessionHistory}=await import('../src/view/team/AgentSessionHistory');
const {ConversationTopics,ConversationChannel}=await import('../src/view/conversation/ConversationTopics');
const {OfficeScene}=await import('../src/view/tasks/OfficeScene');
const {MemberTaskDetail}=await import('../src/view/tasks/MemberTaskDetail');
const {progressFixture}=await import('../tests/conversation-progress-fixture');
const {MarkdownMessage}=await import('../src/view/execution-view/MarkdownMessage');
const {InterfaceHelp}=await import('../src/view/components/InterfaceHelp');
const w={id:'11111111-1111-4111-8111-111111111111',instanceId:'22222222-2222-4222-8222-222222222222',name:'本地工作区',path:'C:/isolated/typography',state:'running',tasks:[]};
const snapshot={workspaceId:w.id,instanceId:w.instanceId,revision:'visual',files:[
{path:'.cbim/team/design/agent.json',text:JSON.stringify({name:'设计 Agent',summary:'负责界面审查和证据反馈',capabilities:['设计审查'],limitations:['不替代真实测试'],skills:[]}),hash:'visual'}
]};
const identity={workspaceId:w.id,instanceId:w.instanceId};const noop=()=>{};const f=progressFixture(3);
const goal='把“可发布”定义为首个可对外发布的休闲联机版：双人联机、服务端机器人、断线恢复和浏览器界面。先做差距盘点，再按优先级实现并回归。';
const topic={scope:{...f.scope,objective:goal},runs:[],tasks:f.graph.tasks,archived:false};
const page=new URLSearchParams(location.search).get('page');
const views={
conversation:<ChatMessages run={inlineMainRuns(3)[0]} workspaceId={w.id}/>,
team:<TeamView workspace={w} snapshot={snapshot}/>,
business:<BusinessArchitecture workspace={w} snapshot={snapshot} tabId="visual" dirty={{current:new Set()}}/>,
diagnostics:<WorkspaceDiagnostics workspace={w} snapshot={snapshot} refreshKnowledge={async()=>{}}/>,
automation:<AutomationView workspace={w}/>,
connectors:<ResourceRepositoryView category="connectors" onSettings={noop}/>,
talent:<ResourceRepositoryView category="talent" onSettings={noop}/>,
businessResources:<ResourceRepositoryView category="templates" onSettings={noop}/>,
runtime:<RuntimeOverview onOpen={noop}/>,
governance:<ModuleGovernancePanel identity={identity} moduleId=".cbim/workspace/game" onClose={noop}/>,
ownership:<ModuleOwnershipPanel identity={identity} onClose={noop}/>,
members:<WorkspaceMembers workspace={w} agents={[]} onClose={noop}/>,
history:<AgentSessionHistory workspaceId={w.id} currentDefinitions={{}} knowledgeReady={true} onClose={noop}/>,
topics:<ConversationTopics topics={[topic]} unassigned={[]} conflicts={[]} onSelect={noop} renderRun={()=>null}/>,
channel:<ConversationChannel topic={topic} onClose={noop} onSelect={noop} renderRun={()=>null}/>,
office:<OfficeScene graph={f.graph} scopes={[summarizeScope(f.scope,'scopes:'+f.graph.cursor.streamId,1)]} mainRunning={true} queued={1} onChat={noop} onTask={noop}/>,
task:<MemberTaskDetail workspaceId={f.identity.workspaceId} rootSessionId={f.identity.rootSessionId} task={f.graph.tasks[0]} scope={f.scope} active={false}/>,
markdown:<MarkdownMessage text={'普通正文和**重点强调**。\n\n# 一级内容标题\n\n## 二级内容标题\n\n工具调用与执行结果使用统一文字。\n\n- 核实改动\n- 回传证据\n\n`inline code`\n\n```ts\nconst result = await agent.call(input);\n```'}/>,
};
for(const kind of ['agent','module','skill','workflow'])views['editor-'+kind]=<ArchitectureEditor workspaceId={w.id} snapshot={snapshot} kind={kind} parentId={kind==='agent'||kind==='skill'?'.cbim/team':'.cbim/workspace'} onClose={noop} onSaved={noop}/>;
createRoot(document.getElementById('root')).render(<><div style={{padding:16}}>{views[page]??<InterfaceHelp/>}</div></>);
