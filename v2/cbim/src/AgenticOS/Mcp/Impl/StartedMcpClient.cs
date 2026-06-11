using System;
using System.Collections.Generic;
using System.Threading;
using ModelContextProtocol.Client;

namespace CBIM.Mcp
{
    /// <summary>
    /// <see cref="IStartedMcpClient"/> 实现——持有一条已完成握手的 MCP 会话与对应的工具列表。
    /// 由 <see cref="McpClientStarter"/> 构造，由 <see cref="McpManager"/> 在引用归零时 Dispose。
    ///
    /// AiFunctions 中的元素是 ModelContextProtocol.Client.McpClientTool，继承自
    /// Microsoft.Extensions.AI.AIFunction——但本类型对外仅暴露 IReadOnlyList&lt;object&gt;，
    /// 由装配侧（AgenticOS / 业务）自己 cast 到 AIFunction 挂到 ChatOptions.Tools。
    /// 这层装箱是 SPI 防火墙的一部分，不允许把 AIFunction 类型回填到 IStartedMcpClient。
    /// </summary>
    internal sealed class StartedMcpClient : IStartedMcpClient
    {
        private McpClient _client;

        public StartedMcpClient(McpClient client, IReadOnlyList<object> aiFunctions)
        {
            _client = client ?? throw new ArgumentNullException(nameof(client));
            AiFunctions = aiFunctions ?? throw new ArgumentNullException(nameof(aiFunctions));
        }

        /// <inheritdoc/>
        public IReadOnlyList<object> AiFunctions { get; }

        /// <summary>
        /// 关闭底层 MCP 会话——同步桥接 <see cref="IAsyncDisposable.DisposeAsync"/>。
        /// 幂等：Interlocked.Exchange 保证多次 Dispose / 与 ProcessExit 兜底竞态时只关一次。
        /// best-effort：进程已死 / 网络已断时关闭可能抛，吞掉以遵守 Dispose 不抛规约。
        /// </summary>
        public void Dispose()
        {
            var client = Interlocked.Exchange(ref _client, null);
            if (client == null) return;

            try
            {
                if (client is IAsyncDisposable asyncDisposable)
                {
                    asyncDisposable.DisposeAsync().AsTask().GetAwaiter().GetResult();
                }
                else if (client is IDisposable syncDisposable)
                {
                    syncDisposable.Dispose();
                }
            }
            catch
            {
                /* best-effort：Dispose 不上抛——子进程已退出 / socket 已断时关闭抛异常正常 */
            }
        }
    }
}
