using System.Runtime.CompilerServices;

// AgenticCLI.Test reaches into kernel internals (e.g. ToolSandbox.SideEffects
// queue, ModuleResolver) to assert behavior at the seam without inflating
// the public API surface. Keep this list narrow.
[assembly: InternalsVisibleTo("AgenticCLI.Test")]
