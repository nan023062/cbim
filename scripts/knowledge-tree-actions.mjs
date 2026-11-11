/** 桌面验收按真实目录路径打开行尾菜单，不把隐藏菜单项当顶栏操作或先改变业务选择。 */
export async function clickKnowledgeTreeAction(view,objectPath,label){
  const name=view.locator(`[data-knowledge-path=${JSON.stringify(objectPath)}]`),row=name.locator('..');
  await name.waitFor();await row.locator('summary').click();await row.getByRole('button',{name:label,exact:true}).click();
}
/** 详情中的 Skill/Workflow 操作仍直接点击；目录动作固定根或当前选择，没有选择时拒绝猜测对象。 */
export async function clickArchitectureAction(view,label){
  const visible=view.getByRole('button',{name:label,exact:true});if(await visible.count()===1){await visible.click();return}
  const root=['新建工程模块','发布架构','使用模板','负责人记录'].includes(label)?'.cbim/workspace':['新建 Agent','发布整个团队'].includes(label)?'.cbim/team':undefined;
  const target=root??await view.locator('.knowledge-file-row.selected [data-knowledge-path]').getAttribute('data-knowledge-path');
  if(!target)throw Error('操作缺少明确知识节点：'+label);
  await clickKnowledgeTreeAction(view,target,label);
}
