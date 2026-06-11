#nullable enable

namespace CBIM.Kernel
{
    /// <summary>
    /// 为 <see cref="CompilerToolFactory"/> 提供当前活跃 <see cref="NeuralCircuitBuilder"/> 的显式接口。
    /// 取代原先通过闭包隐式绑定 <c>_activeBuilder</c> 的方式，使依赖关系在类型系统层面可见。
    /// </summary>
    public interface ICircuitBuilderContext
    {
        /// <summary>
        /// 返回当前活跃的 <see cref="NeuralCircuitBuilder"/>；若当前无编译中的回路则返回 <c>null</c>。
        /// </summary>
        NeuralCircuitBuilder? GetActiveBuilder();
    }
}
