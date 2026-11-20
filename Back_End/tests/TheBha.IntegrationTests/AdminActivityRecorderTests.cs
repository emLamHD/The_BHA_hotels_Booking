using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TheBha.Application.Activity;
using TheBha.Domain.Website;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-ADMIN-BADGE-001-PR02 (ADR 0011 §A, §D): the recorder on real PostgreSQL. It runs in the caller's transaction (no transaction, no counter row: an error; a rollback leaves neither the
/// number nor the row), keeps one sequence per menu, serialises two connections on the menu's counter row, and decides after taking that row which rows keep a correlation id.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class AdminActivityRecorderTests(PostgreSqlWebApplicationFactory factory) : IAsyncLifetime
{
    private static readonly Guid StaffA = Guid.Parse("5a000000-0000-4000-8000-0000000000a1");
    private static readonly Guid StaffB = Guid.Parse("5a000000-0000-4000-8000-0000000000b2");
    private static readonly Guid PropertyId = Guid.Parse("90000000-0000-0000-0000-0000000000c3");
    private static readonly Guid Correlation = Guid.Parse("c0000000-0000-4000-8000-000000000001");
    private static readonly TimeSpan Deadline = TimeSpan.FromSeconds(20);

    public async Task InitializeAsync()
    {
        await factory.ResetDatabaseAsync();
        foreach (var (id, mail) in new[] { (StaffA, "a@example.com"), (StaffB, "b@example.com") })
            await ExecuteAsync(
                $"""
                INSERT INTO "StaffAccounts" ("Id","IsActive","CreatedAtUtc","UserName","NormalizedUserName","Email","NormalizedEmail","EmailConfirmed","PhoneNumberConfirmed","TwoFactorEnabled","LockoutEnabled","AccessFailedCount","CanManageWebsite","CanEditBlog","CanPublishBlog")
                VALUES ('{id}',true,now(),'{mail}','{mail.ToUpperInvariant()}','{mail}','{mail.ToUpperInvariant()}',false,false,false,true,0,false,true,true)
                """);
        await ExecuteAsync(
            $"""
            INSERT INTO "Properties" ("Id","Name","Slug","Description","Address","City","Country","TimeZone","CheckInTime","CheckOutTime","IsActive","CreatedAt","UpdatedAt")
            VALUES ('{PropertyId}','P','p-recorder',NULL,'1 Test St','Da Nang','Vietnam','Asia/Ho_Chi_Minh','14:00:00','12:00:00',true,now(),now())
            """);
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private sealed record Row(string MenuKey, long Sequence, string ActorKind, Guid? Staff, string Action, string EntityKey, string Title, int ItemCount, Guid? CorrelationId, Guid? PropertyId);

    private sealed class Unit(IServiceScope scope) : IDisposable
    {
        public TheBhaDbContext Db { get; } = scope.ServiceProvider.GetRequiredService<TheBhaDbContext>();
        public IAdminActivityRecorder Recorder { get; } = scope.ServiceProvider.GetRequiredService<IAdminActivityRecorder>();
        public void Dispose() => scope.Dispose();
    }

    private Unit Open() => new(factory.Services.CreateScope());

    private static AdminActivityEntry Entry(string menu = AdminMenuKeys.BlogPosts, string action = AdminActivityActions.Created, string entityKey = "11111111-1111-1111-1111-111111111111",
        Guid? staff = null, Guid? property = null, string? title = "A post", Guid? correlation = null, int items = 1) =>
        new(menu, property, staff is null ? AdminActorKind.System : AdminActorKind.Staff, staff, action, "post", entityKey, title, items, correlation);

    private static async Task RecordCommittedAsync(Unit unit, AdminActivityEntry entry)
    {
        await using var transaction = await unit.Db.Database.BeginTransactionAsync();
        await unit.Recorder.RecordAsync(entry, CancellationToken.None);
        await transaction.CommitAsync();
    }

    [Fact]
    public async Task A_committed_record_appends_with_one_independent_sequence_per_menu()
    {
        using var unit = Open();
        await using (var transaction = await unit.Db.Database.BeginTransactionAsync())
        {
            await unit.Recorder.RecordAsync(Entry(items: 3, title: "Post 1"), default);
            await unit.Recorder.RecordAsync(Entry(entityKey: "22222222-2222-2222-2222-222222222222", staff: StaffA), default);
            await unit.Recorder.RecordAsync(Entry(AdminMenuKeys.WebsiteHero, title: "Banner"), default);
            await unit.Recorder.RecordAsync(Entry(AdminMenuKeys.Calendar, property: PropertyId, staff: StaffB), default);
            await transaction.CommitAsync();
        }

        var rows = await RowsAsync();
        Assert.Equal([("blog-posts", 1L), ("blog-posts", 2L), ("calendar", 1L), ("website-hero", 1L)], rows.Select(r => (r.MenuKey, r.Sequence)).ToArray());
        Assert.Equal((3, "System", (Guid?)null, "Post 1"), (rows[0].ItemCount, rows[0].ActorKind, rows[0].Staff, rows[0].Title));
        Assert.Equal(("Staff", StaffA), (rows[1].ActorKind, rows[1].Staff!.Value));
        Assert.Equal(PropertyId, rows[2].PropertyId);
        Assert.Null(rows[3].PropertyId);
        Assert.Equal([2L, 1L, 1L, 0L], [await CounterAsync("blog-posts"), await CounterAsync("website-hero"), await CounterAsync("calendar"), await CounterAsync("blog-media")]);
    }

    [Fact]
    public async Task A_rollback_leaves_no_activity_and_no_counter_move_and_the_number_is_reused()
    {
        using var unit = Open();
        await using (var transaction = await unit.Db.Database.BeginTransactionAsync())
        {
            await unit.Recorder.RecordAsync(Entry(), default);
            await unit.Recorder.RecordAsync(Entry(), default);
            await transaction.RollbackAsync();
        }

        Assert.Empty(await RowsAsync());
        Assert.Equal(0, await CounterAsync("blog-posts"));

        await RecordCommittedAsync(unit, Entry());
        Assert.Equal([1L], (await RowsAsync()).Select(r => r.Sequence).ToArray());
    }

    [Fact]
    public async Task Without_a_transaction_it_throws_and_writes_nothing()
    {
        using var unit = Open();
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => unit.Recorder.RecordAsync(Entry(), default));
        Assert.Contains("transaction", error.Message);
        Assert.Empty(await RowsAsync());
        Assert.Equal(0, await CounterAsync("blog-posts"));
    }

    [Fact]
    public async Task A_menu_without_a_counter_row_throws_and_the_callers_transaction_rolls_back_whole()
    {
        using var unit = Open();
        await using var transaction = await unit.Db.Database.BeginTransactionAsync();
        await unit.Recorder.RecordAsync(Entry(), default); // fine: the caller's own earlier record in the same transaction
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => unit.Recorder.RecordAsync(Entry("no-such-menu"), default));
        Assert.Contains("no counter row", error.Message);
        await transaction.RollbackAsync();

        Assert.Empty(await RowsAsync());
        Assert.Equal(0, await CounterAsync("blog-posts"));
    }

    [Theory]
    [InlineData("Staff actor without an id", "blog-posts", "Staff", false, false, 1, "k")]
    [InlineData("System actor with an id", "blog-posts", "System", true, false, 1, "k")]
    [InlineData("Property on a global menu", "blog-posts", "System", false, true, 1, "k")]
    [InlineData("Property-scoped menu without a Property", "calendar", "System", false, false, 1, "k")]
    [InlineData("zero items", "blog-posts", "System", false, false, 0, "k")]
    [InlineData("empty entity key", "blog-posts", "System", false, false, 1, "  ")]
    [InlineData("entity key too long", "blog-posts", "System", false, false, 1, "TOO-LONG")]
    [InlineData("control character in the key", "blog-posts", "System", false, false, 1, "a\nb")]
    public async Task A_wrong_entry_is_refused_before_a_number_is_taken(string why, string menu, string kind, bool staff, bool property, int items, string key)
    {
        using var unit = Open();
        var entry = new AdminActivityEntry(menu, property ? PropertyId : null, Enum.Parse<AdminActorKind>(kind), staff ? StaffA : null, "Created", "post",
            key == "TOO-LONG" ? new string('x', 81) : key, "t", items);
        await using var transaction = await unit.Db.Database.BeginTransactionAsync();

        await Assert.ThrowsAnyAsync<ArgumentException>(() => unit.Recorder.RecordAsync(entry, default));
        await transaction.RollbackAsync();
        Assert.True(await CounterAsync(menu) == 0 && (await RowsAsync()).Count == 0, why);
    }

    [Fact]
    public async Task The_entity_key_and_the_title_are_normalised()
    {
        var emoji = "\U0001F600";
        using var unit = Open();
        await using (var transaction = await unit.Db.Database.BeginTransactionAsync())
        {
            await unit.Recorder.RecordAsync(Entry(entityKey: "{AABBCCDD-1111-2222-3333-444455556666}", title: "  Hello\r\n\t\0 World \u0085 "), default);
            await unit.Recorder.RecordAsync(Entry(entityKey: " Settings ", title: null), default);
            await unit.Recorder.RecordAsync(Entry(title: new string('a', 199) + emoji + "tail"), default);      // 200 characters, the emoji whole
            await unit.Recorder.RecordAsync(Entry(title: new string('b', 200) + emoji), default);               // cut before the emoji, never inside it
            await unit.Recorder.RecordAsync(Entry(title: "a\ud800b"), default);                                 // an unpaired surrogate cannot be stored: it becomes U+FFFD
            await unit.Recorder.RecordAsync(Entry(title: "é " + new string(' ', 300) + "x"), default);
            await transaction.CommitAsync();
        }

        var rows = await RowsAsync();
        Assert.Equal("aabbccdd-1111-2222-3333-444455556666", rows[0].EntityKey);
        Assert.Equal("Hello World", rows[0].Title);
        Assert.Equal(("settings", ""), (rows[1].EntityKey, rows[1].Title));
        Assert.Equal(new string('a', 199) + emoji, rows[2].Title);
        Assert.Equal(new string('b', 200), rows[3].Title);
        Assert.Equal("a�b", rows[4].Title);
        Assert.Equal("é", rows[5].Title); // capped at 200 characters, then trailing blanks trimmed
    }

    // Each step is its own committed transaction, as separate requests would be: Action:Actor:Entity. K = the row keeps the correlation id, N = it is stored without one; every row is appended.
    [Theory]
    [InlineData("Created:A:1|Published:A:1", "KK")]
    [InlineData("DraftSaved:A:1|Published:A:1", "KK")]
    [InlineData("Created:A:1|Published:A:1|Published:A:1", "KKN")]
    [InlineData("Created:A:1|Created:A:1", "KN")]
    [InlineData("DraftSaved:A:1|DraftSaved:A:1", "KN")]
    [InlineData("Created:A:1|DraftSaved:A:1", "KN")]
    [InlineData("Created:A:1|Published:B:1", "KN")]
    [InlineData("Created:A:1|Published:A:2", "KN")]
    [InlineData("Created:A:1|Deleted:A:1", "KN")]
    [InlineData("Created:A:1|Published:A:1|DraftSaved:A:1", "KKN")]
    [InlineData("Published:A:1", "N")]
    [InlineData("Published:A:1|Created:A:1", "NK")]
    public async Task Only_a_valid_save_then_publish_chain_keeps_its_correlation_id(string steps, string expected)
    {
        using var unit = Open();
        foreach (var step in steps.Split('|'))
        {
            var parts = step.Split(':');
            await RecordCommittedAsync(unit, Entry(action: parts[0], staff: parts[1] == "A" ? StaffA : StaffB, entityKey: $"{parts[2]}0000000-0000-0000-0000-000000000000", correlation: Correlation));
        }

        var rows = await RowsAsync();
        Assert.Equal(expected.Length, rows.Count);
        Assert.Equal(Enumerable.Range(1, expected.Length).Select(n => (long)n), rows.Select(r => r.Sequence));
        Assert.Equal(expected, string.Concat(rows.Select(r => r.CorrelationId == Correlation ? 'K' : r.CorrelationId is null ? 'N' : '?')));
    }

    [Fact]
    public async Task A_correlation_id_is_ignored_outside_the_Blog_posts_menu_and_when_not_given()
    {
        using var unit = Open();
        await RecordCommittedAsync(unit, Entry(AdminMenuKeys.BlogCategories, staff: StaffA, correlation: Correlation));
        await RecordCommittedAsync(unit, Entry(AdminMenuKeys.BlogCategories, AdminActivityActions.Published, staff: StaffA, correlation: Correlation));
        await RecordCommittedAsync(unit, Entry(staff: StaffA));
        await RecordCommittedAsync(unit, Entry(action: AdminActivityActions.Published, staff: StaffA));

        Assert.All(await RowsAsync(), row => Assert.Null(row.CorrelationId));
    }

    // Two real connections on one menu. B must wait on the counter row A holds (observed through pg_blocking_pids, not a sleep); then both commit and the numbers follow the commit order. With the
    // same correlation id the second request is decided only after it got the row, so it sees A's committed chain start and stores NULL instead of failing on the unique index.
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Two_overlapping_transactions_on_one_menu_serialise_on_the_counter_and_number_in_commit_order(bool sameCorrelation)
    {
        using var a = Open();
        using var b = Open();
        await using var transactionA = await a.Db.Database.BeginTransactionAsync();
        await using var transactionB = await b.Db.Database.BeginTransactionAsync();
        var pidA = await BackendPidAsync(a.Db);
        var pidB = await BackendPidAsync(b.Db);
        Guid? correlation = sameCorrelation ? Correlation : null;

        await a.Recorder.RecordAsync(Entry(staff: StaffA, title: "from A", correlation: correlation), default);
        var secondRecord = b.Recorder.RecordAsync(Entry(staff: StaffA, title: "from B", correlation: correlation), default);

        await WaitUntilBlockedByAsync(pidB, pidA);
        Assert.False(secondRecord.IsCompleted);
        Assert.Empty(await RowsAsync()); // A has not committed: nothing is visible to anybody else

        await transactionA.CommitAsync();
        await secondRecord.WaitAsync(Deadline);
        await transactionB.CommitAsync();

        var rows = await RowsAsync();
        Assert.Equal([("from A", 1L), ("from B", 2L)], rows.Select(r => (r.Title, r.Sequence)).ToArray());
        Assert.Equal(2, await CounterAsync("blog-posts"));
        Assert.Equal(sameCorrelation ? [Correlation, (Guid?)null] : [(Guid?)null, null], rows.Select(r => r.CorrelationId).ToArray());
    }

    private async Task WaitUntilBlockedByAsync(int waiter, int holder)
    {
        using var timeout = new CancellationTokenSource(Deadline);
        await using var connection = new NpgsqlConnection(factory.ConnectionString);
        await connection.OpenAsync(timeout.Token);
        while (true)
        {
            await using var command = new NpgsqlCommand("SELECT @holder = ANY(pg_blocking_pids(@waiter))", connection);
            command.Parameters.AddWithValue("holder", holder);
            command.Parameters.AddWithValue("waiter", waiter);
            if ((bool)(await command.ExecuteScalarAsync(timeout.Token))!) return;
            await Task.Delay(20, timeout.Token); // a poll with a deadline, not evidence: the evidence is the lock graph above
        }
    }

    private static async Task<int> BackendPidAsync(TheBhaDbContext db)
    {
        await using var command = new NpgsqlCommand("SELECT pg_backend_pid()", (NpgsqlConnection)db.Database.GetDbConnection(), (NpgsqlTransaction)db.Database.CurrentTransaction!.GetDbTransaction());
        return (int)(await command.ExecuteScalarAsync())!;
    }

    private async Task<List<Row>> RowsAsync()
    {
        await using var connection = new NpgsqlConnection(factory.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(
            """SELECT "MenuKey","Sequence","ActorKind","ActorStaffId","Action","EntityKey","TitleSnapshot","ItemCount","CorrelationId","PropertyId" FROM "AdminActivities" ORDER BY "MenuKey","Sequence" """, connection);
        await using var reader = await command.ExecuteReaderAsync();
        var rows = new List<Row>();
        while (await reader.ReadAsync())
            rows.Add(new Row(reader.GetString(0), reader.GetInt64(1), reader.GetString(2), reader.IsDBNull(3) ? null : reader.GetGuid(3), reader.GetString(4), reader.GetString(5), reader.GetString(6),
                reader.GetInt32(7), reader.IsDBNull(8) ? null : reader.GetGuid(8), reader.IsDBNull(9) ? null : reader.GetGuid(9)));
        return rows;
    }

    private async Task<long> CounterAsync(string menu)
    {
        await using var connection = new NpgsqlConnection(factory.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand("""SELECT "LastSequence" FROM "MenuActivityStreams" WHERE "MenuKey" = @menu""", connection);
        command.Parameters.AddWithValue("menu", menu);
        return (long)(await command.ExecuteScalarAsync() ?? 0L);
    }

    private async Task ExecuteAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(factory.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }
}
