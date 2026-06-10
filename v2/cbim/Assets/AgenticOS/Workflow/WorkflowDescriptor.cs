using System;
using CBIM.Kernel;

namespace CBIM.Workflow
{
    /// <summary>
    /// Workflow 描述符——注册表条目（元数据 + 编译好的回路图）。
    ///
    /// <para>一个 Workflow 绑定一个已编译的 <see cref="NeuralCircuit"/>；
    /// 注册表负责持久化 / 查询，执行侧（Orchestrator）只拿 Circuit 跑。</para>
    ///
    /// <para>与 <c>SkillDescriptor</c> 平级——同属「配置类资产」维度扩展，形态不同：
    /// Skill 是纯文本描述；Workflow 额外携带可执行 IR。</para>
    /// </summary>
    public sealed class WorkflowDescriptor
    {
        /// <summary>Workflow 唯一 Id。kebab-case，全局唯一。</summary>
        public string Id { get; }

        /// <summary>Workflow 名（人类可读）。</summary>
        public string Name { get; }

        /// <summary>一句话描述：这个 Workflow 做什么。LLM 看到此描述判断何时调用。</summary>
        public string Description { get; }

        /// <summary>编译好的回路图（非 null）——执行侧直接使用，无需再编译。</summary>
        public NeuralCircuit Circuit { get; }

        public WorkflowDescriptor(string id, string name, string description, NeuralCircuit circuit)
        {
            if (string.IsNullOrWhiteSpace(id))
                throw new ArgumentException("WorkflowDescriptor.Id 不能为空。", nameof(id));
            if (string.IsNullOrWhiteSpace(name))
                throw new ArgumentException("WorkflowDescriptor.Name 不能为空。", nameof(name));
            if (string.IsNullOrWhiteSpace(description))
                throw new ArgumentException("WorkflowDescriptor.Description 不能为空。", nameof(description));
            if (circuit == null)
                throw new ArgumentNullException(nameof(circuit));

            Id = id;
            Name = name;
            Description = description;
            Circuit = circuit;
        }

        public override string ToString() => $"WorkflowDescriptor({Id})";
    }
}
