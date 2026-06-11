using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using CBIM.Kernel;
using CBIM.Storage;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.FileSystemGlobbing;

namespace CBIM.Tools.Standard;

// 无状态门面：把一组工具 ID（或族名）+ 沙箱转成一份扁平的 AIFunction 列表。
// 没有任何可变静态状态——可以在任意线程并发调用。
//
// 支持的 toolId（大小写不敏感）：
//   单工具: readfile / writefile / editfile / deletefile / listdir / grep / glob / bash / run_command
//   族别名: files / search / shell / bash-all
public static class StandardTools
{

    #region 唯一公开入口


    /// <summary>
    /// 按 toolIds 列表返回对应的 AIFunction 列表。
    /// 重复工具名自动去重（保留首次出现）。
    /// </summary>
    public static IReadOnlyList<AIFunction> Build(
        IEnumerable<string> toolIds,
        ToolSandbox sandbox,
        FileBackend? storage = null)
    {
        if (sandbox == null)
            throw new ArgumentNullException(nameof(sandbox));

        var tools = new List<AIFunction>();
        var seenNames = new HashSet<string>(StringComparer.Ordinal);

        foreach (string raw in toolIds ?? Array.Empty<string>())
        {
            if (string.IsNullOrEmpty(raw))
                continue;
            string id = raw.Trim();
            if (id.Length == 0)
                continue;

            IReadOnlyList<AIFunction> batch;
            switch (id.ToLowerInvariant())
            {
                // ── 单工具 ──
                case "readfile":
                    batch = new[] { BuildReadFile(sandbox, storage) };
                    break;
                case "writefile":
                    batch = new[] { BuildWriteFile(sandbox, storage) };
                    break;
                case "editfile":
                    batch = new[] { BuildEditFile(sandbox, storage) };
                    break;
                case "deletefile":
                    batch = new[] { BuildDeleteFile(sandbox, storage) };
                    break;
                case "listdir":
                    batch = new[] { BuildListDirectory(sandbox, storage) };
                    break;
                case "grep":
                    batch = new[] { BuildGrep(sandbox) };
                    break;
                case "glob":
                    batch = new[] { BuildGlob(sandbox) };
                    break;
                case "bash":
                case "run_command":
                    batch = new[] { BuildRunCommand(sandbox) };
                    break;

                // ── 预设族（向后兼容 CreateFamilies 的族名） ──
                case "files":
                    batch = BuildFilesGroup(sandbox, storage);
                    break;
                case "search":
                    batch = BuildSearchGroup(sandbox);
                    break;
                case "shell":
                case "bash-all":
                    batch = BuildBashGroup(sandbox);
                    break;

                default:
                    Debug.WriteLine("[StandardTools] unknown toolId '" + id + "' — skipping");
                    continue;
            }

            for (int i = 0; i < batch.Count; i++)
            {
                AIFunction fn = batch[i];
                string name = fn.Name;
                if (string.IsNullOrEmpty(name))
                {
                    tools.Add(fn);
                    continue;
                }
                if (!seenNames.Add(name))
                {
                    Debug.WriteLine(
                        "[StandardTools] duplicate tool name '" + name +
                        "' from id '" + id + "' — keeping first occurrence");
                    continue;
                }
                tools.Add(fn);
            }
        }

        return tools;
    }


    #endregion
    #region 向后兼容：原 CreateFamilies / CreateFamily 签名


    /// <inheritdoc cref="Build"/>
    [Obsolete("Use Build() instead.")]
    public static IReadOnlyList<AIFunction> CreateFamilies(
        IEnumerable<string> familyNames,
        ToolSandbox sandbox,
        FileBackend? storage = null)
        => Build(familyNames, sandbox, storage);


    #endregion
    #region 预设族


    public static IReadOnlyList<AIFunction> BuildFilesGroup(ToolSandbox sandbox, FileBackend? storage)
        => new AIFunction[]
        {
            BuildReadFile(sandbox, storage),
            BuildWriteFile(sandbox, storage),
            BuildEditFile(sandbox, storage),
            BuildDeleteFile(sandbox, storage),
            BuildListDirectory(sandbox, storage)
        };

    public static IReadOnlyList<AIFunction> BuildSearchGroup(ToolSandbox sandbox)
        => new AIFunction[]
        {
            BuildGrep(sandbox),
            BuildGlob(sandbox)
        };

    public static IReadOnlyList<AIFunction> BuildBashGroup(ToolSandbox sandbox)
        => new AIFunction[] { BuildRunCommand(sandbox) };


    #endregion
    #region Files 工具


    private static AIFunction BuildReadFile(ToolSandbox sandbox, FileBackend? storage)
    {
        return AIFunctionFactory.Create(
            (Func<string, int, int, string>)((path, maxLines, offset) =>
            {
                string full = PathGuard.Normalize(path, sandbox);
                try
                {
                    if (!File.Exists(full))
                        return "ERROR: NotFound: file does not exist: " + full;

                    var info = new FileInfo(full);
                    if (info.Length > sandbox.MaxFileBytes)
                        return "ERROR: TooLarge: file " + full + " is " + info.Length +
                               " bytes, exceeds MaxFileBytes=" + sandbox.MaxFileBytes;

                    byte[] head = ReadHead(full, HeadProbeBytes);
                    if (BinaryDetector.IsBinary(head))
                    {
                        var meta = new Dictionary<string, object>
                        {
                            { "isBinary", true },
                            { "size", info.Length },
                            { "path", full }
                        };
                        return JsonSerializer.Serialize(meta);
                    }

                    string text = File.ReadAllText(full, Utf8NoBom);
                    return TruncateByLines(text, offset, maxLines, sandbox.MaxResultBytes);
                }
                catch (UnauthorizedAccessException) { throw; }
                catch (Exception ex) { return "ERROR: " + ex.GetType().Name + ": " + ex.Message; }
            }),
            "ReadFile",
            "Read a UTF-8 text file. Binary files return a JSON metadata object instead of their contents. Large text files are truncated by line count and total bytes.");
    }

    private static AIFunction BuildWriteFile(ToolSandbox sandbox, FileBackend? storage)
    {
        if (storage == null)
            throw new ArgumentNullException(nameof(storage), "Files family requires a FileBackend storage instance");
        return AIFunctionFactory.Create(
            (Func<string, string, string>)((path, content) =>
            {
                string full = PathGuard.Normalize(path, sandbox);
                try
                {
                    if (IsBlockedExtension(full, sandbox))
                        return "ERROR: BlockedExtension: writing this file extension is not permitted: " + full;
                    string payload = content ?? string.Empty;
                    storage.WriteAtomic(full, payload);
                    int bytes = Utf8NoBom.GetByteCount(payload);
                    RecordSideEffect(sandbox, "file.write", full, "bytes=" + bytes);
                    return "OK: wrote " + bytes + " bytes to " + full;
                }
                catch (UnauthorizedAccessException) { throw; }
                catch (Exception ex) { return "ERROR: " + ex.GetType().Name + ": " + ex.Message; }
            }),
            "WriteFile",
            "Write a UTF-8 text file atomically. Parent directories are created on demand. Overwrites any existing file at the path.");
    }

    private static AIFunction BuildEditFile(ToolSandbox sandbox, FileBackend? storage)
    {
        if (storage == null)
            throw new ArgumentNullException(nameof(storage), "Files family requires a FileBackend storage instance");
        return AIFunctionFactory.Create(
            (Func<string, string, string, string>)((path, oldStr, newStr) =>
            {
                string full = PathGuard.Normalize(path, sandbox);
                try
                {
                    if (IsBlockedExtension(full, sandbox))
                        return "ERROR: BlockedExtension: writing this file extension is not permitted: " + full;
                    if (!File.Exists(full))
                        return "ERROR: NotFound: file does not exist: " + full;
                    if (oldStr == null || oldStr.Length == 0)
                        return "ERROR: InvalidArgument: oldStr must be non-empty";

                    string existing = File.ReadAllText(full, Utf8NoBom);
                    int count = CountOccurrences(existing, oldStr);
                    if (count == 0)
                        return "ERROR: NoMatch: oldStr not found in " + full;
                    if (count > 1)
                        return "ERROR: AmbiguousMatch: oldStr appears " + count +
                               " times in " + full + "; oldStr must be unique";

                    int idx = existing.IndexOf(oldStr, StringComparison.Ordinal);
                    string updated = existing.Substring(0, idx) + (newStr ?? string.Empty) +
                                     existing.Substring(idx + oldStr.Length);
                    storage.WriteAtomic(full, updated);
                    RecordSideEffect(sandbox, "file.edit", full, "oldStrLen=" + oldStr.Length);
                    return "OK: replaced 1 occurrence in " + full;
                }
                catch (UnauthorizedAccessException) { throw; }
                catch (Exception ex) { return "ERROR: " + ex.GetType().Name + ": " + ex.Message; }
            }),
            "EditFile",
            "Replace a single exact occurrence of oldStr with newStr in a UTF-8 text file. Fails if oldStr does not appear exactly once.");
    }

    private static AIFunction BuildDeleteFile(ToolSandbox sandbox, FileBackend? storage)
    {
        return AIFunctionFactory.Create(
            (Func<string, string>)(path =>
            {
                string full = PathGuard.Normalize(path, sandbox);
                try
                {
                    if (!File.Exists(full))
                        return "OK: file already absent: " + full;
                    File.Delete(full);
                    RecordSideEffect(sandbox, "file.delete", full, null);
                    return "OK: deleted " + full;
                }
                catch (UnauthorizedAccessException) { throw; }
                catch (Exception ex) { return "ERROR: " + ex.GetType().Name + ": " + ex.Message; }
            }),
            "DeleteFile",
            "Delete a file. A missing file is treated as success (idempotent).");
    }

    private static AIFunction BuildListDirectory(ToolSandbox sandbox, FileBackend? storage)
    {
        return AIFunctionFactory.Create(
            (Func<string, string>)(path =>
            {
                string full = PathGuard.Normalize(path, sandbox);
                try
                {
                    if (!Directory.Exists(full))
                        return "ERROR: NotFound: directory does not exist: " + full;

                    var entries = new List<Dictionary<string, object>>();

                    string[] dirs = Directory.GetDirectories(full);
                    Array.Sort(dirs, StringComparer.Ordinal);
                    for (int i = 0; i < dirs.Length; i++)
                    {
                        entries.Add(new Dictionary<string, object>
                        {
                            { "name", Path.GetFileName(dirs[i]) },
                            { "isDir", true },
                            { "size", -1L }
                        });
                    }

                    string[] files = Directory.GetFiles(full);
                    Array.Sort(files, StringComparer.Ordinal);
                    for (int i = 0; i < files.Length; i++)
                    {
                        long size;
                        try
                        { size = new FileInfo(files[i]).Length; }
                        catch { size = -1L; }
                        entries.Add(new Dictionary<string, object>
                        {
                            { "name", Path.GetFileName(files[i]) },
                            { "isDir", false },
                            { "size", size }
                        });
                    }

                    return JsonSerializer.Serialize(entries);
                }
                catch (UnauthorizedAccessException) { throw; }
                catch (Exception ex) { return "ERROR: " + ex.GetType().Name + ": " + ex.Message; }
            }),
            "ListDirectory",
            "List a directory's immediate entries. Returns a JSON array of {name, isDir, size} sorted by name. size is -1 for directories.");
    }


    #endregion
    #region Search 工具


    private static AIFunction BuildGrep(ToolSandbox sandbox)
    {
        return AIFunctionFactory.Create(
            (Func<string, string, bool, int, int, string>)((pattern, path, ignoreCase, context, maxMatches) =>
            {
                string full = PathGuard.Normalize(path, sandbox);

                if (string.IsNullOrEmpty(pattern))
                    return "ERROR: InvalidArgument: pattern must be non-empty";

                Regex regex;
                try
                {
                    var opts = RegexOptions.CultureInvariant | RegexOptions.Compiled;
                    if (ignoreCase)
                        opts |= RegexOptions.IgnoreCase;
                    regex = new Regex(pattern, opts);
                }
                catch (ArgumentException ex)
                {
                    return "ERROR: InvalidPattern: " + ex.Message;
                }

                try
                {
                    bool isFile = File.Exists(full);
                    bool isDir = Directory.Exists(full);
                    if (!isFile && !isDir)
                        return "ERROR: NotFound: " + full;

                    int contextN = context < 0 ? 0 : context;
                    long byteBudget = sandbox.MaxResultBytes > 0 ? sandbox.MaxResultBytes : long.MaxValue;
                    var sb = new StringBuilder();
                    int matches = 0;
                    bool capped = false;

                    if (isFile)
                    {
                        GrepFile(full, regex, contextN, maxMatches, ref matches, ref capped, sb, ref byteBudget);
                    }
                    else
                    {
                        foreach (string file in EnumerateFiles(full))
                        {
                            if (capped)
                                break;
                            GrepFile(file, regex, contextN, maxMatches, ref matches, ref capped, sb, ref byteBudget);
                        }
                    }

                    if (matches == 0)
                        return "[no matches]";
                    if (capped)
                        sb.Append('\n').Append("[truncated: limits reached after ").Append(matches).Append(" matches]");
                    return sb.ToString();
                }
                catch (UnauthorizedAccessException) { throw; }
                catch (Exception ex) { return "ERROR: " + ex.GetType().Name + ": " + ex.Message; }
            }),
            "Grep",
            "Search files for lines matching a .NET regular expression. Returns one match per line in 'file:line: content' form. Recurses into directories.");
    }

    private static AIFunction BuildGlob(ToolSandbox sandbox)
    {
        return AIFunctionFactory.Create(
            (Func<string, string, string>)((pattern, root) =>
            {
                string fullRoot = PathGuard.Normalize(root, sandbox);

                if (string.IsNullOrEmpty(pattern))
                    return "ERROR: InvalidArgument: pattern must be non-empty";

                try
                {
                    if (!Directory.Exists(fullRoot))
                        return "ERROR: NotFound: directory does not exist: " + fullRoot;

                    var matcher = new Matcher(StringComparison.OrdinalIgnoreCase);
                    matcher.AddInclude(pattern);

                    var result = matcher.GetResultsInFullPath(fullRoot);

                    long byteBudget = sandbox.MaxResultBytes > 0 ? sandbox.MaxResultBytes : long.MaxValue;
                    var sb = new StringBuilder();
                    int emitted = 0;
                    bool capped = false;
                    var sorted = new List<string>(result);
                    sorted.Sort(StringComparer.Ordinal);

                    for (int i = 0; i < sorted.Count; i++)
                    {
                        string p = sorted[i];
                        int approxBytes = Encoding.UTF8.GetByteCount(p) + 1;
                        if (sb.Length > 0 && byteBudget - approxBytes < 0)
                        { capped = true; break; }
                        if (emitted > 0)
                            sb.Append('\n');
                        sb.Append(p);
                        byteBudget -= approxBytes;
                        emitted++;
                    }

                    if (emitted == 0)
                        return "[no matches]";
                    if (capped)
                        sb.Append('\n').Append("[truncated: byte cap reached after ")
                          .Append(emitted).Append(" of ").Append(sorted.Count).Append(" paths]");
                    return sb.ToString();
                }
                catch (UnauthorizedAccessException) { throw; }
                catch (Exception ex) { return "ERROR: " + ex.GetType().Name + ": " + ex.Message; }
            }),
            "Glob",
            "Find files matching a glob pattern (e.g. '**/*.cs', 'src/**/*.{cs,json}'). Returns one absolute path per line.");
    }


    #endregion
    #region Bash 工具


    private static AIFunction BuildRunCommand(ToolSandbox sandbox)
    {
        return AIFunctionFactory.Create(
            (Func<string, string, int, string>)((command, workDir, timeoutMs) =>
            {
                if (string.IsNullOrEmpty(command))
                    return "ERROR: InvalidArgument: command must be non-empty";

                int clampedTimeout = timeoutMs <= 0 ? BashDefaultTimeoutMs
                                   : timeoutMs > BashMaxTimeoutMs ? BashMaxTimeoutMs
                                   : timeoutMs;

                string? resolvedWorkDir;
                if (workDir != null)
                {
                    try
                    { resolvedWorkDir = PathGuard.Normalize(workDir, sandbox); }
                    catch (UnauthorizedAccessException ex)
                    {
                        return "ERROR: SandboxViolation: workDir escapes sandbox: " + ex.Message;
                    }
                }
                else
                {
                    resolvedWorkDir = string.IsNullOrEmpty(sandbox.WorkingDirectory)
                        ? null : sandbox.WorkingDirectory;
                }

                RecordSideEffect(sandbox, "bash", resolvedWorkDir ?? string.Empty, command);

                ProcessStartInfo psi;
                if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
                {
                    psi = new ProcessStartInfo("cmd.exe", "/c " + command);
                }
                else
                {
                    string escaped = command.Replace("'", "'\"'\"'");
                    psi = new ProcessStartInfo("/bin/sh", "-c '" + escaped + "'");
                }

                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                if (!string.IsNullOrEmpty(resolvedWorkDir))
                    psi.WorkingDirectory = resolvedWorkDir;

                System.Diagnostics.Process process;
                try
                {
                    process = new System.Diagnostics.Process();
                    process.StartInfo = psi;
                    process.Start();
                }
                catch (Exception ex)
                {
                    return "ERROR: ProcessStartFailed: " + ex.Message;
                }

                var stdoutSb = new StringBuilder();
                var stderrSb = new StringBuilder();

                Task stdoutTask = Task.Run(() =>
                {
                    string? line;
                    while ((line = process.StandardOutput.ReadLine()) != null)
                    {
                        lock (stdoutSb)
                        {
                            if (stdoutSb.Length > 0)
                                stdoutSb.Append('\n');
                            stdoutSb.Append(line);
                        }
                    }
                });

                Task stderrTask = Task.Run(() =>
                {
                    string? line;
                    while ((line = process.StandardError.ReadLine()) != null)
                    {
                        lock (stderrSb)
                        {
                            if (stderrSb.Length > 0)
                                stderrSb.Append('\n');
                            stderrSb.Append(line);
                        }
                    }
                });

                bool finished = Task.Run(() => process.WaitForExit(clampedTimeout)).GetAwaiter().GetResult();

                bool timedOut = false;
                if (!finished)
                {
                    timedOut = true;
                    try
                    { process.Kill(); }
                    catch { }
                }

                Task.WhenAll(stdoutTask, stderrTask).Wait(5_000);

                int exitCode = 0;
                try
                { exitCode = process.ExitCode; }
                catch { }
                process.Dispose();

                string stdout = stdoutSb.ToString();
                string stderr = stderrSb.ToString();

                long maxBytes = sandbox.MaxResultBytes > 0 ? sandbox.MaxResultBytes : long.MaxValue;
                stdout = TruncateUtf8(stdout, maxBytes, out long usedBytes);
                stderr = TruncateUtf8(stderr, maxBytes - usedBytes, out _);

                var result = new BashResultPayload
                {
                    exitCode = exitCode,
                    stdout = stdout,
                    stderr = stderr,
                    timedOut = timedOut
                };
                return JsonSerializer.Serialize(result);
            }),
            "RunCommand",
            "Execute a shell command and return its exit code, stdout, and stderr. On Windows runs via cmd.exe /c; on Unix via /bin/sh -c.");
    }


    #endregion
    #region 常量


    private const int HeadProbeBytes = 8 * 1024;
    private const int BashDefaultTimeoutMs = 30_000;
    private const int BashMaxTimeoutMs = 120_000;
    private const int SideEffectDetailMaxChars = 256;

    private static readonly UTF8Encoding Utf8NoBom = new UTF8Encoding(false);

    /// <summary>记录一次副作用到沙箱 SideEffects 队列。Detail 超长截断到 256 字符。</summary>
    private static void RecordSideEffect(ToolSandbox sandbox, string kind, string target, string? detail)
    {
        if (sandbox == null)
            return;
        string? truncated = detail == null
            ? null
            : (detail.Length <= SideEffectDetailMaxChars ? detail : detail.Substring(0, SideEffectDetailMaxChars));
        sandbox.SideEffects.Enqueue(new SideEffect(
            Kind: kind,
            Target: target ?? string.Empty,
            Detail: truncated,
            At: DateTimeOffset.UtcNow));
    }


    #endregion
    #region Files 私有辅助


    private static byte[] ReadHead(string path, int maxBytes)
    {
        using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
        {
            long len = Math.Min(fs.Length, maxBytes);
            byte[] buf = new byte[len];
            int read = 0;
            while (read < buf.Length)
            {
                int n = fs.Read(buf, read, buf.Length - read);
                if (n <= 0)
                    break;
                read += n;
            }
            if (read == buf.Length)
                return buf;
            byte[] trimmed = new byte[read];
            Array.Copy(buf, trimmed, read);
            return trimmed;
        }
    }

    private static int CountOccurrences(string haystack, string needle)
    {
        if (string.IsNullOrEmpty(haystack) || string.IsNullOrEmpty(needle))
            return 0;
        int count = 0;
        int idx = 0;
        while (true)
        {
            int hit = haystack.IndexOf(needle, idx, StringComparison.Ordinal);
            if (hit < 0)
                break;
            count++;
            idx = hit + needle.Length;
        }
        return count;
    }

    private static string TruncateByLines(string text, int offset, int maxLines, long maxResultBytes)
    {
        if (text == null)
            return string.Empty;

        string[] lines = text.Split('\n');
        int start = offset < 0 ? 0 : offset;
        if (start >= lines.Length)
            return "[empty: offset " + offset + " past end of file (" + lines.Length + " lines)]";

        int end = (maxLines > 0) ? Math.Min(lines.Length, start + maxLines) : lines.Length;

        var sb = new StringBuilder();
        long byteBudget = maxResultBytes > 0 ? maxResultBytes : long.MaxValue;
        bool byteTruncated = false;
        int emitted = 0;

        for (int i = start; i < end; i++)
        {
            string ln = lines[i];
            int approxBytes = Utf8NoBom.GetByteCount(ln) + 1;
            if (sb.Length > 0 && byteBudget - approxBytes < 0)
            { byteTruncated = true; break; }
            if (i > start)
                sb.Append('\n');
            sb.Append(ln);
            byteBudget -= approxBytes;
            emitted++;
        }

        bool lineTruncated = end < lines.Length;
        if (lineTruncated || byteTruncated)
        {
            sb.Append('\n');
            sb.Append("[truncated: emitted ").Append(emitted)
              .Append(" of ").Append(lines.Length).Append(" lines");
            if (byteTruncated)
                sb.Append(", byte cap reached");
            sb.Append("]");
        }
        return sb.ToString();
    }

    private static bool IsBlockedExtension(string path, ToolSandbox sandbox)
    {
        if (sandbox.BlockedExtensions == null || sandbox.BlockedExtensions.Count == 0)
            return false;
        string ext = Path.GetExtension(path);
        if (string.IsNullOrEmpty(ext))
            return false;
        for (int i = 0; i < sandbox.BlockedExtensions.Count; i++)
        {
            if (string.Equals(sandbox.BlockedExtensions[i], ext, StringComparison.OrdinalIgnoreCase))
                return true;
        }
        return false;
    }


    #endregion
    #region Search 私有辅助


    private static IEnumerable<string> EnumerateFiles(string root)
    {
        var stack = new Stack<string>();
        stack.Push(root);
        while (stack.Count > 0)
        {
            string dir = stack.Pop();
            string[] subs;
            try
            { subs = Directory.GetDirectories(dir); }
            catch { continue; }
            Array.Sort(subs, StringComparer.Ordinal);
            for (int i = subs.Length - 1; i >= 0; i--)
            {
                string name = Path.GetFileName(subs[i]);
                if (string.IsNullOrEmpty(name))
                    continue;
                if (name[0] == '.')
                    continue;
                if (string.Equals(name, "node_modules", StringComparison.OrdinalIgnoreCase))
                    continue;
                stack.Push(subs[i]);
            }

            string[] files;
            try
            { files = Directory.GetFiles(dir); }
            catch { continue; }
            Array.Sort(files, StringComparer.Ordinal);
            for (int i = 0; i < files.Length; i++)
                yield return files[i];
        }
    }

    private static void GrepFile(
        string file,
        Regex regex,
        int context,
        int maxMatches,
        ref int matches,
        ref bool capped,
        StringBuilder sb,
        ref long byteBudget)
    {
        string[] lines;
        try
        {
            if (IsLikelyBinary(file))
                return;
            lines = File.ReadAllLines(file);
        }
        catch { return; }

        int lastEmittedLine = -1;
        for (int i = 0; i < lines.Length; i++)
        {
            if (!regex.IsMatch(lines[i]))
                continue;

            if (matches > 0 && context > 0 && lastEmittedLine >= 0 && lastEmittedLine < i - context - 1)
            {
                if (!AppendLine(sb, "--", ref byteBudget))
                { capped = true; return; }
            }

            int ctxStart = Math.Max(0, i - context);
            int ctxEnd = Math.Min(lines.Length - 1, i + context);

            for (int j = ctxStart; j < i; j++)
            {
                if (j <= lastEmittedLine)
                    continue;
                if (!AppendLine(sb, file + "-" + (j + 1) + "- " + lines[j], ref byteBudget))
                { capped = true; return; }
                lastEmittedLine = j;
            }
            if (!AppendLine(sb, file + ":" + (i + 1) + ": " + lines[i], ref byteBudget))
            { capped = true; return; }
            lastEmittedLine = i;

            for (int j = i + 1; j <= ctxEnd; j++)
            {
                if (!AppendLine(sb, file + "-" + (j + 1) + "- " + lines[j], ref byteBudget))
                { capped = true; return; }
                lastEmittedLine = j;
            }

            matches++;
            if (maxMatches > 0 && matches >= maxMatches)
            { capped = true; return; }
        }
    }

    private static bool AppendLine(StringBuilder sb, string line, ref long byteBudget)
    {
        int approxBytes = Encoding.UTF8.GetByteCount(line) + 1;
        if (sb.Length > 0 && byteBudget - approxBytes < 0)
            return false;
        if (sb.Length > 0)
            sb.Append('\n');
        sb.Append(line);
        byteBudget -= approxBytes;
        return true;
    }

    private static bool IsLikelyBinary(string file)
    {
        try
        {
            using (var fs = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                int probeLen = (int)Math.Min(fs.Length, 8 * 1024);
                if (probeLen <= 0)
                    return false;
                byte[] buf = new byte[probeLen];
                int read = 0;
                while (read < probeLen)
                {
                    int n = fs.Read(buf, read, probeLen - read);
                    if (n <= 0)
                        break;
                    read += n;
                }
                if (read < probeLen)
                {
                    byte[] trimmed = new byte[read];
                    Array.Copy(buf, trimmed, read);
                    return BinaryDetector.IsBinary(trimmed);
                }
                return BinaryDetector.IsBinary(buf);
            }
        }
        catch { return true; }
    }


    #endregion
    #region Bash 私有辅助


    private static string TruncateUtf8(string text, long budgetBytes, out long usedBytes)
    {
        if (string.IsNullOrEmpty(text))
        { usedBytes = 0; return text ?? string.Empty; }
        if (budgetBytes <= 0)
        { usedBytes = 0; return "[truncated]"; }

        int byteCount = Encoding.UTF8.GetByteCount(text);
        if (byteCount <= budgetBytes)
        { usedBytes = byteCount; return text; }

        const string suffix = "[truncated]";
        int suffixBytes = Encoding.UTF8.GetByteCount(suffix);
        long allowedForContent = budgetBytes - suffixBytes;
        if (allowedForContent <= 0)
        { usedBytes = suffixBytes; return suffix; }

        byte[] encoded = Encoding.UTF8.GetBytes(text);
        int cutAt = (int)Math.Min(allowedForContent, encoded.Length);
        while (cutAt > 0 && (encoded[cutAt] & 0xC0) == 0x80)
            cutAt--;

        string truncated = Encoding.UTF8.GetString(encoded, 0, cutAt) + suffix;
        usedBytes = Encoding.UTF8.GetByteCount(truncated);
        return truncated;
    }

    private sealed class BashResultPayload
    {
        public int exitCode { get; set; }
        public string? stdout { get; set; }
        public string? stderr { get; set; }
        public bool timedOut { get; set; }
    }

    #endregion
}
