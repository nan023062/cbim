using System;
using System.Collections.Generic;
using System.Linq;
using ModelContextProtocol.Client;

namespace CBIM.Mcp
{
    /// <summary>
    /// <see cref="IMcpClientStarter"/> 的真实实现——基于官方
    /// <c>ModelContextProtocol</c> SDK（github.com/modelcontextprotocol/csharp-sdk）的薄封装。
    ///
    /// 职责（仅此而已）：
    ///   1. 按 <see cref="McpDescriptor"/> 子类型构造对应 IClientTransport
    ///      （StdioMcpDescriptor → StdioClientTransport；HttpMcpDescriptor → HttpClientTransport）
    ///   2. 同步 block 调用 <see cref="McpClient.CreateAsync"/> 完成握手
    ///   3. 同步 block 调用 <see cref="McpClient.ListToolsAsync()"/> 获取工具集
    ///   4. 把 McpClientTool（继承自 AIFunction）装箱进 IReadOnlyList&lt;object&gt; 返回
    ///
    /// 同步签名是 SPI 契约——SDK 是异步的，这里用 .GetAwaiter().GetResult() 桥接。
    /// 调用方 <see cref="McpManager"/> 已在锁内串行化同 Id 启动，不存在 Unity 主线程死锁风险
    /// （前提：调用方不在 SynchronizationContext 上）。
    ///
    /// 失败语义：
    ///   - CreateAsync 失败 → 异常原样上抛（连接 / 握手错误）。
    ///   - ListToolsAsync 失败 → Dispose 已建立的 client 后再上抛，避免泄露子进程 / socket。
    ///   - 不缓存、不重试——这两件由 <see cref="McpManager"/> 与装配侧分别负责。
    ///
    /// <see cref="McpDescriptor.Shared"/> 字段在本类不读——共享 / 隔离语义在 McpManager 实现，
    /// starter 只负责"按 descriptor 起一条新连接"。
    /// </summary>
    public sealed class McpClientStarter : IMcpClientStarter
    {
        /// <inheritdoc/>
        public IStartedMcpClient Start(McpDescriptor descriptor)
        {
            if (descriptor == null) throw new ArgumentNullException(nameof(descriptor));

            IClientTransport transport = BuildTransport(descriptor);

            // 1) 握手：CreateAsync 返回的 McpClient 已完成 protocol/initialize。
            //    这一步失败直接上抛，没有需要清理的中间产物（transport 不持有进程 / socket）。
            McpClient client = McpClient.CreateAsync(transport).GetAwaiter().GetResult();

            // 2) tools/list：失败必须释放已建立的 client，否则子进程 / socket 泄露。
            IReadOnlyList<object> aiFunctions;
            try
            {
                IList<McpClientTool> tools = client.ListToolsAsync().GetAwaiter().GetResult();

                // McpClientTool : AIFunction —— 装箱为 object，由装配侧自己 cast 回 AIFunction 用。
                var boxed = new List<object>(tools.Count);
                for (int i = 0; i < tools.Count; i++)
                    boxed.Add(tools[i]);
                aiFunctions = boxed;
            }
            catch
            {
                DisposeQuiet(client);
                throw;
            }

            return new StartedMcpClient(client, aiFunctions);
        }

        /// <summary>
        /// 按 descriptor 子类型构造 IClientTransport。
        /// 不在这里 await——构造器是同步的，连接动作由后续 McpClient.CreateAsync 触发。
        /// </summary>
        private static IClientTransport BuildTransport(McpDescriptor descriptor)
        {
            switch (descriptor)
            {
                case StdioMcpDescriptor stdio:
                    return BuildStdioTransport(stdio);
                case HttpMcpDescriptor http:
                    return BuildHttpTransport(http);
                default:
                    throw new NotSupportedException(
                        "Unsupported McpDescriptor subtype: " + descriptor.GetType().FullName +
                        ". Expected StdioMcpDescriptor or HttpMcpDescriptor.");
            }
        }

        private static StdioClientTransport BuildStdioTransport(StdioMcpDescriptor d)
        {
            // SDK 的 Options 字段是 IList / IDictionary（可变）——我们的 descriptor 用的是
            // IReadOnlyList / IReadOnlyDictionary，必须拷贝一份。
            var options = new StdioClientTransportOptions
            {
                Command = d.Command,
                Name = d.Id,
                Arguments = d.Args.ToList(),
            };

            // EnvironmentVariables 是 IDictionary<string, string?>（值可空）——
            // 仅当我们的 Env 非空才注入；空字典就保持 null（避免无意义复制 + 让 SDK 用默认环境）。
            if (d.Env.Count > 0)
            {
                var env = new Dictionary<string, string>(d.Env.Count, StringComparer.Ordinal);
                foreach (var kv in d.Env)
                    env[kv.Key] = kv.Value;
                // 上转 string? 字典是隐式的（C# 引用类型 nullable 仅是注解）。
                options.EnvironmentVariables = env;
            }

            return new StdioClientTransport(options);
        }

        private static HttpClientTransport BuildHttpTransport(HttpMcpDescriptor d)
        {
            // HttpClientTransportOptions.Endpoint 要求 absolute Uri + http/https scheme，
            // 这里用 UriKind.Absolute 严格构造——不合法直接 UriFormatException 上抛。
            var endpoint = new Uri(d.Endpoint, UriKind.Absolute);

            // AdditionalHeaders 是 IDictionary<string,string>——拷贝 descriptor 的只读字典
            // 并按需补一条 Authorization。空 token / 空 headers 都跳过分配。
            IDictionary<string, string> headers = null;
            if (d.Headers.Count > 0)
            {
                headers = new Dictionary<string, string>(d.Headers.Count, StringComparer.Ordinal);
                foreach (var kv in d.Headers)
                    headers[kv.Key] = kv.Value;
            }

            if (!string.IsNullOrEmpty(d.AuthToken))
            {
                headers ??= new Dictionary<string, string>(StringComparer.Ordinal);
                // 不覆盖 caller 显式传入的 Authorization——若 Headers 已含此键，认为是 caller 故意指定。
                if (!headers.ContainsKey("Authorization"))
                    headers["Authorization"] = "Bearer " + d.AuthToken;
            }

            var options = new HttpClientTransportOptions
            {
                Endpoint = endpoint,
                Name = d.Id,
                AdditionalHeaders = headers,
                // TransportMode 用默认 AutoDetect——SDK 自己探测 Streamable HTTP / SSE。
            };

            return new HttpClientTransport(options);
        }

        /// <summary>tools/list 失败时清理 client——任何 Dispose 异常都吞掉，原因不能掩盖。</summary>
        private static void DisposeQuiet(McpClient client)
        {
            try
            {
                if (client is IAsyncDisposable asyncDisposable)
                    asyncDisposable.DisposeAsync().AsTask().GetAwaiter().GetResult();
                else if (client is IDisposable syncDisposable)
                    syncDisposable.Dispose();
            }
            catch
            {
                /* best-effort：吞异常以保留 ListTools 原始失败原因 */
            }
        }
    }
}
