using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-NEWSLETTER-002-C1: parks chosen SQL statements of the real application at a chosen point so a test can put two real requests in
/// a known interleaving (two saves that both read the same version; a confirmation that holds its locks while a resend starts). Nothing
/// is parked unless a test arms a rule, so every other test passes through untouched.
/// </summary>
public sealed class NewsletterSqlGate : DbCommandInterceptor
{
    public sealed class Rule(Func<string, bool> match, int parties, int skip)
    {
        private int _arrivals;
        private readonly TaskCompletionSource _arrived = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource _release = new(TaskCreationOptions.RunContinuationsAsynchronously);

        internal bool Matches(string sql) => match(sql);

        /// <summary>Completes when <c>parties</c> statements are parked here.</summary>
        public Task Arrived => _arrived.Task;
        public void Release() => _release.TrySetResult();

        internal Task ParkAsync()
        {
            var arrival = Interlocked.Increment(ref _arrivals);
            if (arrival <= skip || arrival > skip + parties) return Task.CompletedTask;   // only <parties> statements, after the first <skip>, are parked
            if (arrival == skip + parties) _arrived.TrySetResult();
            return _release.Task;
        }
    }

    private readonly List<Rule> _rules = [];

    /// <summary>Of the statements that match, the first <paramref name="skip"/> pass and the next <paramref name="parties"/> wait until <see cref="Rule.Release"/>; later ones pass.</summary>
    public Rule Arm(Func<string, bool> match, int parties = 1, int skip = 0)
    {
        var rule = new Rule(match, parties, skip);
        lock (_rules) _rules.Add(rule);
        return rule;
    }

    private Task Maybe(DbCommand command)
    {
        Rule[] armed;
        lock (_rules) armed = _rules.Count == 0 ? [] : _rules.ToArray();
        foreach (var rule in armed)
        {
            if (rule.Matches(command.CommandText)) return rule.ParkAsync();
        }

        return Task.CompletedTask;
    }

    public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
    {
        await Maybe(command);
        return result;
    }

    public override async ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        await Maybe(command);
        return result;
    }
}
