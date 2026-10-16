namespace TheBha.Domain.Website;

/// <summary>
/// CUST-WEB-HEADER-001-CP02-C2: the message syntax every managed text uses — an ICU MessageFormat subset, so a
/// full sentence with parameters and plural forms is ONE translatable unit and no translated fragments are ever
/// concatenated. The subset is exactly: plain text, <c>{name}</c>, and
/// <c>{count, plural, =0 {…} one {…} other {…}}</c> (selectors <c>=N zero one two few many other</c>, <c>other</c>
/// required, <c>#</c> inside a branch is the number, branches may nest further arguments). An apostrophe is always a
/// literal (French needs it everywhere) and a literal brace is not supported. The two TypeScript formatters (Customer
/// and Admin) and this validator are run against the one shared vector file <c>icu-vectors.json</c>, so the three can
/// never disagree about what a message means.
/// </summary>
public static class IcuMessage
{
    private static readonly HashSet<string> Selectors = new(StringComparer.Ordinal) { "zero", "one", "two", "few", "many", "other" };

    /// <summary>The variable names a valid message uses (the plural argument included), or the first syntax error.</summary>
    public sealed record Analysis(string? Error, IReadOnlyCollection<string> Variables)
    {
        public bool IsValid => Error is null;
    }

    public static Analysis Analyze(string? text)
    {
        var variables = new SortedSet<string>(StringComparer.Ordinal);
        var source = text ?? string.Empty;
        var position = 0;
        var error = ParseText(source, ref position, 0, variables);
        if (error is null && position < source.Length)
        {
            error = "The message has a '}' that closes nothing.";
        }

        return new Analysis(error, error is null ? variables : []);
    }

    private static string? ParseText(string source, ref int position, int depth, SortedSet<string> variables)
    {
        while (position < source.Length)
        {
            var current = source[position];
            if (current == '}')
            {
                return depth == 0 ? "The message has a '}' that closes nothing." : null;
            }

            if (current == '{')
            {
                position++;
                if (ParseArgument(source, ref position, depth, variables) is { } error)
                {
                    return error;
                }

                continue;
            }

            position++;
        }

        return depth == 0 ? null : "The message has a '{' that is never closed.";
    }

    private static string? ParseArgument(string source, ref int position, int depth, SortedSet<string> variables)
    {
        var nameStart = position;
        while (position < source.Length && source[position] is not (',' or '}'))
        {
            position++;
        }

        if (position >= source.Length)
        {
            return "The message has a '{' that is never closed.";
        }

        var name = source[nameStart..position].Trim();
        if (!IsName(name))
        {
            return $"'{{{name}…' is not a valid placeholder; use letters and digits such as {{count}}.";
        }

        variables.Add(name);
        if (source[position] == '}')
        {
            position++;
            return null;
        }

        position++; // ','
        var typeStart = position;
        while (position < source.Length && source[position] is not ',')
        {
            position++;
        }

        if (position >= source.Length || !string.Equals(source[typeStart..position].Trim(), "plural", StringComparison.Ordinal))
        {
            return $"{{{name}, …}} must be a plural: {{{name}, plural, one {{…}} other {{…}}}}.";
        }

        position++; // ','
        var seenOther = false;
        var seen = new HashSet<string>(StringComparer.Ordinal);
        while (true)
        {
            SkipWhite(source, ref position);
            if (position >= source.Length)
            {
                return "The message has a '{' that is never closed.";
            }

            if (source[position] == '}')
            {
                position++;
                break;
            }

            var selectorStart = position;
            while (position < source.Length && !char.IsWhiteSpace(source[position]) && source[position] != '{')
            {
                position++;
            }

            var selector = source[selectorStart..position];
            if (!Selectors.Contains(selector) && !IsExact(selector))
            {
                return $"'{selector}' is not a plural form; use =N, zero, one, two, few, many or other.";
            }

            if (!seen.Add(selector))
            {
                return $"The plural form '{selector}' appears twice.";
            }

            seenOther |= selector == "other";
            SkipWhite(source, ref position);
            if (position >= source.Length || source[position] != '{')
            {
                return $"The plural form '{selector}' must be followed by {{text}}.";
            }

            position++;
            if (ParseText(source, ref position, depth + 1, variables) is { } error)
            {
                return error;
            }

            if (position >= source.Length || source[position] != '}')
            {
                return "The message has a '{' that is never closed.";
            }

            position++;
        }

        return seenOther ? null : $"The plural of {{{name}}} needs an 'other' form.";
    }

    private static void SkipWhite(string source, ref int position)
    {
        while (position < source.Length && char.IsWhiteSpace(source[position]))
        {
            position++;
        }
    }

    private static bool IsName(string name) =>
        name.Length > 0 && char.IsAsciiLetter(name[0]) && name.All(char.IsAsciiLetterOrDigit);

    private static bool IsExact(string selector) =>
        selector.Length > 1 && selector[0] == '=' && selector[1..].All(char.IsAsciiDigit);
}
