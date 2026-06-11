#nullable enable
using System;
using System.IO;
using System.Threading.Tasks;
using CBIM.Kernel;
using CBIM.Tools.Standard;
using FluentAssertions;
using Microsoft.Extensions.AI;
using Xunit;

namespace CBIM.Test;

/// <summary>
/// 验证 MotorCortex 家族里的 bash 工具调用后,沙箱 SideEffects 队列里
/// 必有一条 Kind=="bash" 的副作用记录。这条记录是脑区调用结束时归入
/// NeuronOutcome.SideEffects 的素材源。
/// </summary>
public sealed class BashSideEffectTest
{
    [Fact]
    public async Task RunCommand_invocation_enqueues_bash_side_effect_in_sandbox()
    {
        // -- arrange --
        string sandboxRoot = Path.Combine(Path.GetTempPath(), "cbim-bash-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(sandboxRoot);

        var sandbox = new ToolSandbox(
            allowedPathPrefixes: new[] { sandboxRoot },
            workingDirectory: sandboxRoot);

        var tools = StandardTools.BuildBashGroup(sandbox);
        tools.Should().HaveCount(1);
        AIFunction bashTool = tools[0];
        bashTool.Name.Should().Be("RunCommand");

        // 选用一条平台无关的 noop 命令——Windows 走 cmd.exe,*nix 走 /bin/sh,
        // 但工具记录副作用发生在执行前,无论命令成败都会入队。
        string command = OperatingSystem.IsWindows() ? "rem cbim-test" : "true";
        var args = new AIFunctionArguments(new System.Collections.Generic.Dictionary<string, object?>
        {
            ["command"] = command,
            ["workDir"] = sandboxRoot,
            ["timeoutMs"] = 5_000,
        });

        // -- act --
        object? result = await bashTool.InvokeAsync(args);
        _ = result; // 只关心副作用,不强求 stdout 内容

        // -- assert --
        // ToolSandbox.SideEffects 是 internal,通过 InternalsVisibleTo 直读。
        sandbox.SideEffects.Should().NotBeEmpty();
        bool sawBash = false;
        foreach (var se in sandbox.SideEffects)
        {
            if (string.Equals(se.Kind, "bash", StringComparison.Ordinal))
            {
                sawBash = true;
                se.Detail.Should().Be(command);
                break;
            }
        }
        sawBash.Should().BeTrue();

        // -- cleanup --
        try
        { Directory.Delete(sandboxRoot, recursive: true); }
        catch { /* best-effort */ }
    }
}
