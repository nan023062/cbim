using System.Threading;
using System.Threading.Tasks;

namespace CBIM.Kernel
{
    /// <summary>
    /// 可被 Orchestrator 驱动的调用单元抽象——Kernel 层的唯一感知点。
    /// Mind 层的 <see cref="CBIM.Mind.Brain"/> 实现此接口；Kernel 完全不依赖 Mind 具体类。
    /// </summary>
    public interface IInvocable
    {
        Task<NeuronOutcome> InvokeAsync(NeuronInput input, CancellationToken ct = default);
    }
}
