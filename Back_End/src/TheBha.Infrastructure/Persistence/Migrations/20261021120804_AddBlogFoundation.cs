using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TheBha.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddBlogFoundation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "CanEditBlog",
                table: "StaffAccounts",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "CanPublishBlog",
                table: "StaffAccounts",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "BlogAudits",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ActorStaffId = table.Column<Guid>(type: "uuid", nullable: false),
                    Action = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    PostId = table.Column<Guid>(type: "uuid", nullable: true),
                    TranslationId = table.Column<Guid>(type: "uuid", nullable: true),
                    CategoryId = table.Column<Guid>(type: "uuid", nullable: true),
                    Locale = table.Column<string>(type: "character varying(35)", maxLength: 35, nullable: true),
                    RevisionId = table.Column<Guid>(type: "uuid", nullable: true),
                    VersionAfter = table.Column<int>(type: "integer", nullable: true),
                    Detail = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BlogAudits", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BlogAudits_StaffAccounts_ActorStaffId",
                        column: x => x.ActorStaffId,
                        principalTable: "StaffAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "BlogCategories",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SystemKey = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false, defaultValue: 1),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedByStaffId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedByStaffId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BlogCategories", x => x.Id);
                    table.CheckConstraint("CK_BlogCategories_SortOrder", "\"SortOrder\" BETWEEN 0 AND 9999");
                    table.CheckConstraint("CK_BlogCategories_Version", "\"Version\" >= 1");
                    table.ForeignKey(
                        name: "FK_BlogCategories_StaffAccounts_CreatedByStaffId",
                        column: x => x.CreatedByStaffId,
                        principalTable: "StaffAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BlogCategories_StaffAccounts_UpdatedByStaffId",
                        column: x => x.UpdatedByStaffId,
                        principalTable: "StaffAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "BlogMedia",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    StorageKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    ContentType = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    ByteSize = table.Column<long>(type: "bigint", nullable: false),
                    Width = table.Column<int>(type: "integer", nullable: false),
                    Height = table.Column<int>(type: "integer", nullable: false),
                    CreatedByStaffId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BlogMedia", x => x.Id);
                    table.CheckConstraint("CK_BlogMedia_Key", "\"StorageKey\" ~ '^blog/[0-9a-f]{32}\\.(jpg|png|webp)$'");
                    table.CheckConstraint("CK_BlogMedia_Size", "\"ByteSize\" > 0 AND \"Width\" > 0 AND \"Height\" > 0");
                    table.ForeignKey(
                        name: "FK_BlogMedia_StaffAccounts_CreatedByStaffId",
                        column: x => x.CreatedByStaffId,
                        principalTable: "StaffAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "BlogPosts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedByStaffId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BlogPosts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BlogPosts_StaffAccounts_CreatedByStaffId",
                        column: x => x.CreatedByStaffId,
                        principalTable: "StaffAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "BlogCategorySlugs",
                columns: table => new
                {
                    Locale = table.Column<string>(type: "character varying(35)", maxLength: 35, nullable: false),
                    Slug = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    CategoryId = table.Column<Guid>(type: "uuid", nullable: false),
                    IsCurrent = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BlogCategorySlugs", x => new { x.Locale, x.Slug });
                    table.ForeignKey(
                        name: "FK_BlogCategorySlugs_BlogCategories_CategoryId",
                        column: x => x.CategoryId,
                        principalTable: "BlogCategories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "BlogCategoryTranslations",
                columns: table => new
                {
                    CategoryId = table.Column<Guid>(type: "uuid", nullable: false),
                    Locale = table.Column<string>(type: "character varying(35)", maxLength: 35, nullable: false),
                    Name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Slug = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Description = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BlogCategoryTranslations", x => new { x.CategoryId, x.Locale });
                    table.ForeignKey(
                        name: "FK_BlogCategoryTranslations_BlogCategories_CategoryId",
                        column: x => x.CategoryId,
                        principalTable: "BlogCategories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "BlogSettings",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false),
                    HomeSectionCategoryId = table.Column<Guid>(type: "uuid", nullable: true),
                    Version = table.Column<int>(type: "integer", nullable: false, defaultValue: 1),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedByStaffId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BlogSettings", x => x.Id);
                    table.CheckConstraint("CK_BlogSettings_Single", "\"Id\" = 1");
                    table.CheckConstraint("CK_BlogSettings_Version", "\"Version\" >= 1");
                    table.ForeignKey(
                        name: "FK_BlogSettings_BlogCategories_HomeSectionCategoryId",
                        column: x => x.HomeSectionCategoryId,
                        principalTable: "BlogCategories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BlogSettings_StaffAccounts_UpdatedByStaffId",
                        column: x => x.UpdatedByStaffId,
                        principalTable: "StaffAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "BlogCategoryPins",
                columns: table => new
                {
                    CategoryId = table.Column<Guid>(type: "uuid", nullable: false),
                    PostId = table.Column<Guid>(type: "uuid", nullable: false),
                    Position = table.Column<int>(type: "integer", nullable: false),
                    PinnedByStaffId = table.Column<Guid>(type: "uuid", nullable: false),
                    PinnedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BlogCategoryPins", x => new { x.CategoryId, x.PostId });
                    table.CheckConstraint("CK_BlogCategoryPins_Position", "\"Position\" BETWEEN 0 AND 999");
                    table.ForeignKey(
                        name: "FK_BlogCategoryPins_BlogCategories_CategoryId",
                        column: x => x.CategoryId,
                        principalTable: "BlogCategories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BlogCategoryPins_BlogPosts_PostId",
                        column: x => x.PostId,
                        principalTable: "BlogPosts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BlogCategoryPins_StaffAccounts_PinnedByStaffId",
                        column: x => x.PinnedByStaffId,
                        principalTable: "StaffAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "BlogPostRevisions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TranslationId = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<int>(type: "integer", nullable: false),
                    State = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    Origin = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    RestoredFromRevisionId = table.Column<Guid>(type: "uuid", nullable: true),
                    Title = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    Slug = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Summary = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    BodyJson = table.Column<string>(type: "jsonb", nullable: false),
                    CoverMediaId = table.Column<Guid>(type: "uuid", nullable: true),
                    CoverAlt = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    AuthorName = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    MetaTitle = table.Column<string>(type: "character varying(70)", maxLength: 70, nullable: false),
                    MetaDescription = table.Column<string>(type: "character varying(170)", maxLength: 170, nullable: false),
                    OgImageMediaId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedByStaffId = table.Column<Guid>(type: "uuid", nullable: false),
                    UpdatedByStaffId = table.Column<Guid>(type: "uuid", nullable: false),
                    PublishedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    PublishedByStaffId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BlogPostRevisions", x => x.Id);
                    table.UniqueConstraint("AK_BlogPostRevisions_TranslationId_Id", x => new { x.TranslationId, x.Id });
                    table.CheckConstraint("CK_BlogPostRevisions_Number", "\"Number\" >= 1");
                    table.CheckConstraint("CK_BlogPostRevisions_Published", "\"PublishedAtUtc\" IS NULL OR \"State\" = 'Frozen'");
                    table.ForeignKey(
                        name: "FK_BlogPostRevisions_BlogMedia_CoverMediaId",
                        column: x => x.CoverMediaId,
                        principalTable: "BlogMedia",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BlogPostRevisions_BlogMedia_OgImageMediaId",
                        column: x => x.OgImageMediaId,
                        principalTable: "BlogMedia",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BlogPostRevisions_StaffAccounts_CreatedByStaffId",
                        column: x => x.CreatedByStaffId,
                        principalTable: "StaffAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BlogPostRevisions_StaffAccounts_PublishedByStaffId",
                        column: x => x.PublishedByStaffId,
                        principalTable: "StaffAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BlogPostRevisions_StaffAccounts_UpdatedByStaffId",
                        column: x => x.UpdatedByStaffId,
                        principalTable: "StaffAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "BlogPostTranslations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PostId = table.Column<Guid>(type: "uuid", nullable: false),
                    Locale = table.Column<string>(type: "character varying(35)", maxLength: 35, nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false, defaultValue: 1),
                    DraftRevisionId = table.Column<Guid>(type: "uuid", nullable: true),
                    PublishedRevisionId = table.Column<Guid>(type: "uuid", nullable: true),
                    FirstPublishedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedByStaffId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BlogPostTranslations", x => x.Id);
                    table.CheckConstraint("CK_BlogPostTranslations_FirstPublished", "\"PublishedRevisionId\" IS NULL OR \"FirstPublishedAtUtc\" IS NOT NULL");
                    table.CheckConstraint("CK_BlogPostTranslations_Published", "\"Status\" <> 'Published' OR \"PublishedRevisionId\" IS NOT NULL");
                    table.CheckConstraint("CK_BlogPostTranslations_Unpublished", "\"Status\" <> 'Unpublished' OR \"PublishedRevisionId\" IS NOT NULL");
                    table.CheckConstraint("CK_BlogPostTranslations_Version", "\"Version\" >= 1");
                    table.ForeignKey(
                        name: "FK_BlogPostTranslations_BlogPostRevisions_Id_DraftRevisionId",
                        columns: x => new { x.Id, x.DraftRevisionId },
                        principalTable: "BlogPostRevisions",
                        principalColumns: new[] { "TranslationId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BlogPostTranslations_BlogPostRevisions_Id_PublishedRevision~",
                        columns: x => new { x.Id, x.PublishedRevisionId },
                        principalTable: "BlogPostRevisions",
                        principalColumns: new[] { "TranslationId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BlogPostTranslations_BlogPosts_PostId",
                        column: x => x.PostId,
                        principalTable: "BlogPosts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BlogPostTranslations_StaffAccounts_UpdatedByStaffId",
                        column: x => x.UpdatedByStaffId,
                        principalTable: "StaffAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "BlogRevisionCategories",
                columns: table => new
                {
                    RevisionId = table.Column<Guid>(type: "uuid", nullable: false),
                    CategoryId = table.Column<Guid>(type: "uuid", nullable: false),
                    IsPrimary = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BlogRevisionCategories", x => new { x.RevisionId, x.CategoryId });
                    table.ForeignKey(
                        name: "FK_BlogRevisionCategories_BlogCategories_CategoryId",
                        column: x => x.CategoryId,
                        principalTable: "BlogCategories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BlogRevisionCategories_BlogPostRevisions_RevisionId",
                        column: x => x.RevisionId,
                        principalTable: "BlogPostRevisions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "BlogRevisionMedia",
                columns: table => new
                {
                    RevisionId = table.Column<Guid>(type: "uuid", nullable: false),
                    MediaId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BlogRevisionMedia", x => new { x.RevisionId, x.MediaId });
                    table.ForeignKey(
                        name: "FK_BlogRevisionMedia_BlogMedia_MediaId",
                        column: x => x.MediaId,
                        principalTable: "BlogMedia",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BlogRevisionMedia_BlogPostRevisions_RevisionId",
                        column: x => x.RevisionId,
                        principalTable: "BlogPostRevisions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "BlogPostSlugs",
                columns: table => new
                {
                    Locale = table.Column<string>(type: "character varying(35)", maxLength: 35, nullable: false),
                    Slug = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    TranslationId = table.Column<Guid>(type: "uuid", nullable: false),
                    State = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BlogPostSlugs", x => new { x.Locale, x.Slug });
                    table.ForeignKey(
                        name: "FK_BlogPostSlugs_BlogPostTranslations_TranslationId",
                        column: x => x.TranslationId,
                        principalTable: "BlogPostTranslations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_BlogAudits_ActorStaffId",
                table: "BlogAudits",
                column: "ActorStaffId");

            migrationBuilder.CreateIndex(
                name: "IX_BlogAudits_CategoryId_AtUtc",
                table: "BlogAudits",
                columns: new[] { "CategoryId", "AtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_BlogAudits_PostId_AtUtc",
                table: "BlogAudits",
                columns: new[] { "PostId", "AtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_BlogCategories_CreatedByStaffId",
                table: "BlogCategories",
                column: "CreatedByStaffId");

            migrationBuilder.CreateIndex(
                name: "IX_BlogCategories_UpdatedByStaffId",
                table: "BlogCategories",
                column: "UpdatedByStaffId");

            migrationBuilder.CreateIndex(
                name: "UX_BlogCategories_SystemKey",
                table: "BlogCategories",
                column: "SystemKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BlogCategoryPins_CategoryId_Position",
                table: "BlogCategoryPins",
                columns: new[] { "CategoryId", "Position" });

            migrationBuilder.CreateIndex(
                name: "IX_BlogCategoryPins_PinnedByStaffId",
                table: "BlogCategoryPins",
                column: "PinnedByStaffId");

            migrationBuilder.CreateIndex(
                name: "IX_BlogCategoryPins_PostId",
                table: "BlogCategoryPins",
                column: "PostId");

            migrationBuilder.CreateIndex(
                name: "UX_BlogCategorySlugs_Current",
                table: "BlogCategorySlugs",
                columns: new[] { "CategoryId", "Locale" },
                unique: true,
                filter: "\"IsCurrent\"");

            migrationBuilder.CreateIndex(
                name: "IX_BlogMedia_CreatedByStaffId",
                table: "BlogMedia",
                column: "CreatedByStaffId");

            migrationBuilder.CreateIndex(
                name: "IX_BlogMedia_StorageKey",
                table: "BlogMedia",
                column: "StorageKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BlogPostRevisions_CoverMediaId",
                table: "BlogPostRevisions",
                column: "CoverMediaId");

            migrationBuilder.CreateIndex(
                name: "IX_BlogPostRevisions_CreatedByStaffId",
                table: "BlogPostRevisions",
                column: "CreatedByStaffId");

            migrationBuilder.CreateIndex(
                name: "IX_BlogPostRevisions_OgImageMediaId",
                table: "BlogPostRevisions",
                column: "OgImageMediaId");

            migrationBuilder.CreateIndex(
                name: "IX_BlogPostRevisions_PublishedByStaffId",
                table: "BlogPostRevisions",
                column: "PublishedByStaffId");

            migrationBuilder.CreateIndex(
                name: "IX_BlogPostRevisions_UpdatedByStaffId",
                table: "BlogPostRevisions",
                column: "UpdatedByStaffId");

            migrationBuilder.CreateIndex(
                name: "UX_BlogPostRevisions_Number",
                table: "BlogPostRevisions",
                columns: new[] { "TranslationId", "Number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "UX_BlogPostRevisions_OneDraft",
                table: "BlogPostRevisions",
                column: "TranslationId",
                unique: true,
                filter: "\"State\" = 'Draft'");

            migrationBuilder.CreateIndex(
                name: "IX_BlogPosts_CreatedByStaffId",
                table: "BlogPosts",
                column: "CreatedByStaffId");

            migrationBuilder.CreateIndex(
                name: "UX_BlogPostSlugs_OneCurrent",
                table: "BlogPostSlugs",
                column: "TranslationId",
                unique: true,
                filter: "\"State\" = 'Current'");

            migrationBuilder.CreateIndex(
                name: "UX_BlogPostSlugs_OneDraft",
                table: "BlogPostSlugs",
                column: "TranslationId",
                unique: true,
                filter: "\"State\" = 'Draft'");

            migrationBuilder.CreateIndex(
                name: "IX_BlogPostTranslations_Id_DraftRevisionId",
                table: "BlogPostTranslations",
                columns: new[] { "Id", "DraftRevisionId" });

            migrationBuilder.CreateIndex(
                name: "IX_BlogPostTranslations_Id_PublishedRevisionId",
                table: "BlogPostTranslations",
                columns: new[] { "Id", "PublishedRevisionId" });

            migrationBuilder.CreateIndex(
                name: "IX_BlogPostTranslations_Locale_Status",
                table: "BlogPostTranslations",
                columns: new[] { "Locale", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_BlogPostTranslations_UpdatedByStaffId",
                table: "BlogPostTranslations",
                column: "UpdatedByStaffId");

            migrationBuilder.CreateIndex(
                name: "UX_BlogPostTranslations_PostLocale",
                table: "BlogPostTranslations",
                columns: new[] { "PostId", "Locale" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BlogRevisionCategories_CategoryId",
                table: "BlogRevisionCategories",
                column: "CategoryId");

            migrationBuilder.CreateIndex(
                name: "UX_BlogRevisionCategories_Primary",
                table: "BlogRevisionCategories",
                column: "RevisionId",
                unique: true,
                filter: "\"IsPrimary\"");

            migrationBuilder.CreateIndex(
                name: "IX_BlogRevisionMedia_MediaId",
                table: "BlogRevisionMedia",
                column: "MediaId");

            migrationBuilder.CreateIndex(
                name: "IX_BlogSettings_HomeSectionCategoryId",
                table: "BlogSettings",
                column: "HomeSectionCategoryId");

            migrationBuilder.CreateIndex(
                name: "IX_BlogSettings_UpdatedByStaffId",
                table: "BlogSettings",
                column: "UpdatedByStaffId");

            migrationBuilder.AddForeignKey(
                name: "FK_BlogPostRevisions_BlogPostTranslations_TranslationId",
                table: "BlogPostRevisions",
                column: "TranslationId",
                principalTable: "BlogPostTranslations",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            // BHA-BLOG-001-CP01: the "Điểm đến nổi bật" category and the settings row linking the home section to it by id (idempotent).
            migrationBuilder.Sql(TheBha.Infrastructure.Persistence.BlogSeed.Sql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Refuses while Blog content, a Blog picture, a changed category or a Blog permission exists, so a rollback cannot drop any of it silently.
            migrationBuilder.Sql(
                "DO $$ BEGIN IF EXISTS (SELECT 1 FROM \"BlogPosts\") OR EXISTS (SELECT 1 FROM \"BlogMedia\") OR EXISTS (SELECT 1 FROM \"BlogAudits\") " +
                "OR EXISTS (SELECT 1 FROM \"BlogCategories\" WHERE \"SystemKey\" IS DISTINCT FROM 'featured-destinations' OR \"Version\" > 1) " +
                "OR EXISTS (SELECT 1 FROM \"StaffAccounts\" WHERE \"CanEditBlog\" OR \"CanPublishBlog\") " +
                "THEN RAISE EXCEPTION 'Down refused: Blog content, pictures, edits or permissions exist.'; END IF; END $$;");

            migrationBuilder.DropForeignKey(
                name: "FK_BlogPostTranslations_BlogPosts_PostId",
                table: "BlogPostTranslations");

            migrationBuilder.DropForeignKey(
                name: "FK_BlogPostRevisions_BlogMedia_CoverMediaId",
                table: "BlogPostRevisions");

            migrationBuilder.DropForeignKey(
                name: "FK_BlogPostRevisions_BlogMedia_OgImageMediaId",
                table: "BlogPostRevisions");

            migrationBuilder.DropForeignKey(
                name: "FK_BlogPostRevisions_BlogPostTranslations_TranslationId",
                table: "BlogPostRevisions");

            migrationBuilder.DropTable(
                name: "BlogAudits");

            migrationBuilder.DropTable(
                name: "BlogCategoryPins");

            migrationBuilder.DropTable(
                name: "BlogCategorySlugs");

            migrationBuilder.DropTable(
                name: "BlogCategoryTranslations");

            migrationBuilder.DropTable(
                name: "BlogPostSlugs");

            migrationBuilder.DropTable(
                name: "BlogRevisionCategories");

            migrationBuilder.DropTable(
                name: "BlogRevisionMedia");

            migrationBuilder.DropTable(
                name: "BlogSettings");

            migrationBuilder.DropTable(
                name: "BlogCategories");

            migrationBuilder.DropTable(
                name: "BlogPosts");

            migrationBuilder.DropTable(
                name: "BlogMedia");

            migrationBuilder.DropTable(
                name: "BlogPostTranslations");

            migrationBuilder.DropTable(
                name: "BlogPostRevisions");

            migrationBuilder.DropColumn(
                name: "CanEditBlog",
                table: "StaffAccounts");

            migrationBuilder.DropColumn(
                name: "CanPublishBlog",
                table: "StaffAccounts");
        }
    }
}
