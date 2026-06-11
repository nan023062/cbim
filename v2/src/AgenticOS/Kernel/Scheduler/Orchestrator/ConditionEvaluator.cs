using System;

namespace CBIM.Kernel;

/// <summary>
/// <c>BranchNode.ConditionExpression</c> 的极简 evaluator——v1 只识 <c>contains</c> / <c>equals</c>。
/// </summary>
internal static class ConditionEvaluator
{
    private const string LiteralTrue = "true";
    private const string LiteralFalse = "false";
    private const string OpContainsToken = " contains ";
    private const string OpEqualsToken = " equals ";

    public static string Evaluate(string conditionExpression, CircuitMessage message)
    {
        if (string.IsNullOrWhiteSpace(conditionExpression))
            throw new ArgumentException("ConditionExpression 不能为空。", nameof(conditionExpression));
        if (message == null)
            throw new ArgumentNullException(nameof(message));

        string expr = conditionExpression.Trim();

        string @operator;
        int opIndex;
        if ((opIndex = expr.IndexOf(OpContainsToken, StringComparison.Ordinal)) >= 0)
        {
            @operator = "contains";
        }
        else if ((opIndex = expr.IndexOf(OpEqualsToken, StringComparison.Ordinal)) >= 0)
        {
            @operator = "equals";
        }
        else
        {
            throw new NotSupportedException(
                $"ConditionExpression 仅支持 'contains' 或 'equals' (v1)，未识别运算符: {expr}");
        }

        string lhs = expr.Substring(0, opIndex).Trim();
        string rhsPart = expr.Substring(opIndex + (@operator == "contains" ? OpContainsToken.Length : OpEqualsToken.Length)).Trim();

        string rhs = ParseQuotedLiteral(rhsPart, expr);
        string lhsValue = ResolveLhs(lhs, message, expr);

        bool result = @operator == "contains"
            ? lhsValue.IndexOf(rhs, StringComparison.Ordinal) >= 0
            : string.Equals(lhsValue, rhs, StringComparison.Ordinal);

        return result ? LiteralTrue : LiteralFalse;
    }

    private static string ParseQuotedLiteral(string rhsPart, string fullExpr)
    {
        if (rhsPart.Length < 2 || rhsPart[0] != '"' || rhsPart[rhsPart.Length - 1] != '"')
        {
            throw new NotSupportedException(
                $"ConditionExpression rhs 必须为双引号字符串字面量 (v1, 不支持转义): {fullExpr}");
        }
        return rhsPart.Substring(1, rhsPart.Length - 2);
    }

    private static string ResolveLhs(string lhs, CircuitMessage message, string fullExpr)
    {
        const string previousSummary = "previous.summary";
        const string nodePrefix = "node_";
        const string summarySuffix = ".summary";

        if (lhs == previousSummary)
        {
            return message.LastSummary;
        }

        if (lhs.StartsWith(nodePrefix, StringComparison.Ordinal) &&
            lhs.EndsWith(summarySuffix, StringComparison.Ordinal))
        {
            string nodeId = lhs.Substring(nodePrefix.Length, lhs.Length - nodePrefix.Length - summarySuffix.Length);
            if (string.IsNullOrWhiteSpace(nodeId))
            {
                throw new NotSupportedException(
                    $"ConditionExpression lhs 节点 Id 不能为空: {fullExpr}");
            }
            if (!message.History.TryGetValue(nodeId, out var outcome))
            {
                throw new NotSupportedException(
                    $"ConditionExpression lhs 引用了未在 History 中的节点 '{nodeId}': {fullExpr}");
            }
            return outcome.Summary ?? string.Empty;
        }

        throw new NotSupportedException(
            $"ConditionExpression lhs 仅支持 'previous.summary' 或 'node_<id>.summary' (v1): {fullExpr}");
    }
}
