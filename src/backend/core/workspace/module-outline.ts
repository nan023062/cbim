/**
 * 作用定位：模块正文的固定章节和可复制模板，供知识校验与桌面编辑共同使用。
 * 设计原因：标题是严格协议；在错误处给出原文和结构，避免调用者猜标题或读取实现。占位说明不代表业务事实或验收。
 */
export const moduleSections=['定位','子模块和 source 节点','结构关系图与抽象设计决策','雷区与排障','观察模式-待抽象'] as const;
/** 生成供填写的结构；有直属源时显式包含既定虚拟节点，不猜测真实依赖关系。 */
export function moduleBodyTemplate(sources:readonly string[]=[]){
  const sourceText=sources.length?'\n### Source 路径与维护说明\n'+sources.map(source=>'### '+source+'\n请按实际内容填写用途、边界及待核实事项。\n').join('\n'):'';
  const direct=sources.length?'\nclass CbimDirectContent["直属内容（虚拟子模块）"]\n<<virtual>> CbimDirectContent\nModule *-- CbimDirectContent':'';
  return '# 中文模块名称\n\n## '+moduleSections[0]+'\n请填写本模块负责的业务目标与边界。\n\n## '+moduleSections[1]+'\n请按实际情况说明直属子模块和源目录；没有时明确写无。\n'+sourceText+'\n## '+moduleSections[2]+'\n```mermaid\nclassDiagram\nclass Module'+direct+'\n```\n请依据实际代码填写结构、关系与设计原因。\n\n## '+moduleSections[3]+'\n请记录已知限制与验证方法；未知内容明确标记待核实。\n\n## '+moduleSections[4]+'\n请记录待验证的观察；没有时明确写无。\n';
}
