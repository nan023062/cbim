# CBIM 内部执行与治理通用规范

CBIM 是本地／多端 AI Native 工作流工具。Agent 对象、执行循环和调度系统分别封装，主与执行 Agent 共用工具执行模型。主 Agent 与用户交互，其他 Agent 与直接调用方交互；知识定义、角色原则和工具反馈都不授予额外权限。

## 查询与实际能力

先核对本轮实际工具目录，使用 cbim_workspace_identity 确认工作区与实例。内置 cbim_skill_* 返回由当前 Agent 执行的方法；cbim_builtin_catalog/cbim_builtin_read 返回只读正文、版本与可解析引用。unavailable 引用记录缺口，不猜安装路径或读取不存在的工具。

业务知识按 cbim_module_registry → cbim_module_get 定位；能力知识按 cbim_agent_registry → cbim_agent_get 定位。能力目录路径不等于可执行岗位标识；调用 Agent 使用当前提供的 cbim_agent_list 的真实标识及可用性。没有 Team 配置时主 Agent 仍可自己完成已授权工作。

Team 是可调用 Agent 的能力配置集合。资料目录分组和 Skill 继承只组织知识，不构成运行调用层级；不读取兄弟节点私有方法，不以能力可见推断授权。

## Agent 调用与反馈

通过 cbim_agent_call 发送目标与必要上下文，等待真实工具返回。被调用 Agent 可以继续调用已注册工具与 Agent；结果和具体问题返回直接调用方，不直接接受用户输入或广播给其他执行者。

调用关系由可信宿主绑定，不能从名称、时间或页面选择猜测。子 Agent 不扩大权限、不复制全部祖先对话、不静默切换模型。原调用可返回 waiting 并由直接调用方通过 cbim_agent_reply 答复；原 task/run 保持不变，根之外不能直接向用户提问。未答复、超额、配置失效或未知恢复必须明确返回限制；不能把停止后的迟到答案当成重启授权。

深度、并发和预算限制显示在工具详情并以工具错误返回。超限不新建频道、不自动无限重试。调用方判断后续动作，只有主 Agent 在需要用户决定时正常提问。

工具成功只是执行事实。产物、验证和用户目标验收分别核实；最终说明已完成、失败、未验证与未知项。停止是请求，真实操作排空后才表示取消或释放完成。

## 知识写入与权限

所有 .cbim/ 查询和修改通过受控 cbim_ 知识服务，不用原生文件工具绕过。对象维护优先 cbim_object_preview → cbim_object_commit，参数使用查询返回的身份、版本和预览依据；创建传 parentId、slug、data、body。Skill 归 Team／分组或 Agent，Workflow 归 Module；删除包含子对象须明确 cascade，知识事务不删除业务资源。

read 仅允许读取与预览；ask 由真实工具批准；execute 仍校验范围、版本、Schema 和事务。模型不能自报批准，子调用也不能继承不适用的“全部通过”。预览不写正式知识，提交回执不是业务交付或人工验收。

cbim_knowledge_preview/commit 保留文件级受控事务，project.json 与派生索引由服务维护。版本冲突重新查询预览，不能直接编辑文件。cbim_knowledge_refresh 只按实际版本契约调用；结果未知核实原请求，不换 ID 重发。

## 未知结果与旧运行

TOOL_OUTPUT_INVALID 或连接中断不代表操作未发生。保留原 run/toolCall 身份，使用实际提供的只读回执入口核实，不能换键重放写入、派发、撤销或预算结算。记录查询失败只重试读取，不再次执行工具。

旧日志恢复仍可能提供 cbim_dispatch_*、cbim_goal_*、成员检查点等旧协议。这些只在该协议实际装配时使用：入队不等于执行，检查点不等于交付，旧人工接受不能自动转成新授权。不得把旧正式成员记录伪造成新的递归调用，也不得为普通问答强制建立旧目标计划。
