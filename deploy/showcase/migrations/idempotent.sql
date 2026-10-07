CREATE TABLE IF NOT EXISTS "__EFMigrationsHistory" (
    "MigrationId" character varying(150) NOT NULL,
    "ProductVersion" character varying(32) NOT NULL,
    CONSTRAINT "PK___EFMigrationsHistory" PRIMARY KEY ("MigrationId")
);

START TRANSACTION;


DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260721175848_InitialPropertyRoomInventory') THEN
    CREATE TABLE "Amenities" (
        "Id" uuid NOT NULL,
        "Code" character varying(50) NOT NULL,
        "Name" character varying(200) NOT NULL,
        "Category" character varying(100) NOT NULL,
        "IsActive" boolean NOT NULL,
        CONSTRAINT "PK_Amenities" PRIMARY KEY ("Id")
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260721175848_InitialPropertyRoomInventory') THEN
    CREATE TABLE "Media" (
        "Id" uuid NOT NULL,
        "Url" character varying(2000) NOT NULL,
        "AltText" character varying(500),
        "MediaType" character varying(30) NOT NULL,
        "CreatedAt" timestamp with time zone NOT NULL,
        CONSTRAINT "PK_Media" PRIMARY KEY ("Id")
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260721175848_InitialPropertyRoomInventory') THEN
    CREATE TABLE "Properties" (
        "Id" uuid NOT NULL,
        "Name" character varying(200) NOT NULL,
        "Slug" character varying(200) NOT NULL,
        "Description" character varying(4000),
        "Address" character varying(500) NOT NULL,
        "City" character varying(120) NOT NULL,
        "Country" character varying(120) NOT NULL,
        "TimeZone" character varying(100) NOT NULL,
        "CheckInTime" time without time zone NOT NULL,
        "CheckOutTime" time without time zone NOT NULL,
        "IsActive" boolean NOT NULL,
        "CreatedAt" timestamp with time zone NOT NULL,
        "UpdatedAt" timestamp with time zone NOT NULL,
        CONSTRAINT "PK_Properties" PRIMARY KEY ("Id")
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260721175848_InitialPropertyRoomInventory') THEN
    CREATE TABLE "PropertyAmenities" (
        "PropertyId" uuid NOT NULL,
        "AmenityId" uuid NOT NULL,
        CONSTRAINT "PK_PropertyAmenities" PRIMARY KEY ("PropertyId", "AmenityId"),
        CONSTRAINT "FK_PropertyAmenities_Amenities_AmenityId" FOREIGN KEY ("AmenityId") REFERENCES "Amenities" ("Id") ON DELETE CASCADE,
        CONSTRAINT "FK_PropertyAmenities_Properties_PropertyId" FOREIGN KEY ("PropertyId") REFERENCES "Properties" ("Id") ON DELETE CASCADE
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260721175848_InitialPropertyRoomInventory') THEN
    CREATE TABLE "PropertyMedia" (
        "PropertyId" uuid NOT NULL,
        "MediaId" uuid NOT NULL,
        "SortOrder" integer NOT NULL,
        "IsCover" boolean NOT NULL,
        CONSTRAINT "PK_PropertyMedia" PRIMARY KEY ("PropertyId", "MediaId"),
        CONSTRAINT "CK_PropertyMedia_SortOrder" CHECK ("SortOrder" >= 0),
        CONSTRAINT "FK_PropertyMedia_Media_MediaId" FOREIGN KEY ("MediaId") REFERENCES "Media" ("Id") ON DELETE CASCADE,
        CONSTRAINT "FK_PropertyMedia_Properties_PropertyId" FOREIGN KEY ("PropertyId") REFERENCES "Properties" ("Id") ON DELETE CASCADE
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260721175848_InitialPropertyRoomInventory') THEN
    CREATE TABLE "RoomTypes" (
        "Id" uuid NOT NULL,
        "PropertyId" uuid NOT NULL,
        "Code" character varying(50) NOT NULL,
        "Name" character varying(200) NOT NULL,
        "Slug" character varying(200) NOT NULL,
        "Description" character varying(4000),
        "BaseOccupancy" integer NOT NULL,
        "MaxOccupancy" integer NOT NULL,
        "IsActive" boolean NOT NULL,
        "CreatedAt" timestamp with time zone NOT NULL,
        "UpdatedAt" timestamp with time zone NOT NULL,
        CONSTRAINT "PK_RoomTypes" PRIMARY KEY ("Id"),
        CONSTRAINT "AK_RoomTypes_PropertyId_Id" UNIQUE ("PropertyId", "Id"),
        CONSTRAINT "CK_RoomTypes_BaseOccupancy" CHECK ("BaseOccupancy" > 0),
        CONSTRAINT "CK_RoomTypes_MaxOccupancy" CHECK ("MaxOccupancy" >= "BaseOccupancy"),
        CONSTRAINT "FK_RoomTypes_Properties_PropertyId" FOREIGN KEY ("PropertyId") REFERENCES "Properties" ("Id") ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260721175848_InitialPropertyRoomInventory') THEN
    CREATE TABLE "PhysicalRooms" (
        "Id" uuid NOT NULL,
        "PropertyId" uuid NOT NULL,
        "RoomTypeId" uuid NOT NULL,
        "RoomNumber" character varying(50) NOT NULL,
        "Floor" integer NOT NULL,
        "OperationalStatus" character varying(30) NOT NULL,
        "CreatedAt" timestamp with time zone NOT NULL,
        "UpdatedAt" timestamp with time zone NOT NULL,
        CONSTRAINT "PK_PhysicalRooms" PRIMARY KEY ("Id"),
        CONSTRAINT "CK_PhysicalRooms_OperationalStatus" CHECK ("OperationalStatus" IN ('Active', 'Inactive', 'OutOfService')),
        CONSTRAINT "FK_PhysicalRooms_Properties_PropertyId" FOREIGN KEY ("PropertyId") REFERENCES "Properties" ("Id") ON DELETE RESTRICT,
        CONSTRAINT "FK_PhysicalRooms_RoomTypes_PropertyId_RoomTypeId" FOREIGN KEY ("PropertyId", "RoomTypeId") REFERENCES "RoomTypes" ("PropertyId", "Id") ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260721175848_InitialPropertyRoomInventory') THEN
    CREATE TABLE "RoomTypeAmenities" (
        "RoomTypeId" uuid NOT NULL,
        "AmenityId" uuid NOT NULL,
        CONSTRAINT "PK_RoomTypeAmenities" PRIMARY KEY ("RoomTypeId", "AmenityId"),
        CONSTRAINT "FK_RoomTypeAmenities_Amenities_AmenityId" FOREIGN KEY ("AmenityId") REFERENCES "Amenities" ("Id") ON DELETE CASCADE,
        CONSTRAINT "FK_RoomTypeAmenities_RoomTypes_RoomTypeId" FOREIGN KEY ("RoomTypeId") REFERENCES "RoomTypes" ("Id") ON DELETE CASCADE
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260721175848_InitialPropertyRoomInventory') THEN
    CREATE TABLE "RoomTypeMedia" (
        "RoomTypeId" uuid NOT NULL,
        "MediaId" uuid NOT NULL,
        "SortOrder" integer NOT NULL,
        "IsCover" boolean NOT NULL,
        CONSTRAINT "PK_RoomTypeMedia" PRIMARY KEY ("RoomTypeId", "MediaId"),
        CONSTRAINT "CK_RoomTypeMedia_SortOrder" CHECK ("SortOrder" >= 0),
        CONSTRAINT "FK_RoomTypeMedia_Media_MediaId" FOREIGN KEY ("MediaId") REFERENCES "Media" ("Id") ON DELETE CASCADE,
        CONSTRAINT "FK_RoomTypeMedia_RoomTypes_RoomTypeId" FOREIGN KEY ("RoomTypeId") REFERENCES "RoomTypes" ("Id") ON DELETE CASCADE
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260721175848_InitialPropertyRoomInventory') THEN
    CREATE UNIQUE INDEX "IX_Amenities_Code" ON "Amenities" ("Code");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260721175848_InitialPropertyRoomInventory') THEN
    CREATE UNIQUE INDEX "IX_PhysicalRooms_PropertyId_RoomNumber" ON "PhysicalRooms" ("PropertyId", "RoomNumber");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260721175848_InitialPropertyRoomInventory') THEN
    CREATE INDEX "IX_PhysicalRooms_PropertyId_RoomTypeId" ON "PhysicalRooms" ("PropertyId", "RoomTypeId");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260721175848_InitialPropertyRoomInventory') THEN
    CREATE UNIQUE INDEX "IX_Properties_Slug" ON "Properties" ("Slug");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260721175848_InitialPropertyRoomInventory') THEN
    CREATE INDEX "IX_PropertyAmenities_AmenityId" ON "PropertyAmenities" ("AmenityId");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260721175848_InitialPropertyRoomInventory') THEN
    CREATE INDEX "IX_PropertyMedia_MediaId" ON "PropertyMedia" ("MediaId");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260721175848_InitialPropertyRoomInventory') THEN
    CREATE UNIQUE INDEX "IX_PropertyMedia_PropertyId" ON "PropertyMedia" ("PropertyId") WHERE "IsCover";
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260721175848_InitialPropertyRoomInventory') THEN
    CREATE INDEX "IX_RoomTypeAmenities_AmenityId" ON "RoomTypeAmenities" ("AmenityId");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260721175848_InitialPropertyRoomInventory') THEN
    CREATE INDEX "IX_RoomTypeMedia_MediaId" ON "RoomTypeMedia" ("MediaId");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260721175848_InitialPropertyRoomInventory') THEN
    CREATE UNIQUE INDEX "IX_RoomTypeMedia_RoomTypeId" ON "RoomTypeMedia" ("RoomTypeId") WHERE "IsCover";
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260721175848_InitialPropertyRoomInventory') THEN
    CREATE UNIQUE INDEX "IX_RoomTypes_PropertyId_Code" ON "RoomTypes" ("PropertyId", "Code");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260721175848_InitialPropertyRoomInventory') THEN
    CREATE UNIQUE INDEX "IX_RoomTypes_PropertyId_Slug" ON "RoomTypes" ("PropertyId", "Slug");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260721175848_InitialPropertyRoomInventory') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20260721175848_InitialPropertyRoomInventory', '8.0.29');
    END IF;
END $EF$;
COMMIT;

START TRANSACTION;


DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260722102552_AddRatePlanFoundation') THEN
    CREATE TABLE "RatePlans" (
        "Id" uuid NOT NULL,
        "PropertyId" uuid NOT NULL,
        "Code" character varying(50) NOT NULL,
        "Name" character varying(200) NOT NULL,
        "Description" character varying(4000),
        "CurrencyCode" character varying(3) NOT NULL,
        "IsActive" boolean NOT NULL,
        "CreatedAt" timestamp with time zone NOT NULL,
        "UpdatedAt" timestamp with time zone NOT NULL,
        CONSTRAINT "PK_RatePlans" PRIMARY KEY ("Id"),
        CONSTRAINT "AK_RatePlans_PropertyId_Id" UNIQUE ("PropertyId", "Id"),
        CONSTRAINT "CK_RatePlans_Code_NotBlank" CHECK (btrim("Code") <> ''),
        CONSTRAINT "CK_RatePlans_CurrencyCode" CHECK ("CurrencyCode" ~ '^[A-Z]{3}$'),
        CONSTRAINT "CK_RatePlans_Name_NotBlank" CHECK (btrim("Name") <> ''),
        CONSTRAINT "CK_RatePlans_Timestamps" CHECK ("UpdatedAt" >= "CreatedAt"),
        CONSTRAINT "FK_RatePlans_Properties_PropertyId" FOREIGN KEY ("PropertyId") REFERENCES "Properties" ("Id") ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260722102552_AddRatePlanFoundation') THEN
    CREATE UNIQUE INDEX "IX_RatePlans_PropertyId_Code" ON "RatePlans" ("PropertyId", "Code");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260722102552_AddRatePlanFoundation') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20260722102552_AddRatePlanFoundation', '8.0.29');
    END IF;
END $EF$;
COMMIT;

START TRANSACTION;


DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260722112304_AddDailyRoomRates') THEN
    CREATE TABLE "DailyRoomRates" (
        "Id" uuid NOT NULL,
        "PropertyId" uuid NOT NULL,
        "RoomTypeId" uuid NOT NULL,
        "RatePlanId" uuid NOT NULL,
        "StayDate" date NOT NULL,
        "Amount" numeric(18,2) NOT NULL,
        "CreatedAt" timestamp with time zone NOT NULL,
        "UpdatedAt" timestamp with time zone NOT NULL,
        CONSTRAINT "PK_DailyRoomRates" PRIMARY KEY ("Id"),
        CONSTRAINT "CK_DailyRoomRates_Amount" CHECK ("Amount" > 0),
        CONSTRAINT "CK_DailyRoomRates_Timestamps" CHECK ("UpdatedAt" >= "CreatedAt"),
        CONSTRAINT "FK_DailyRoomRates_Properties_PropertyId" FOREIGN KEY ("PropertyId") REFERENCES "Properties" ("Id") ON DELETE RESTRICT,
        CONSTRAINT "FK_DailyRoomRates_RatePlans_PropertyId_RatePlanId" FOREIGN KEY ("PropertyId", "RatePlanId") REFERENCES "RatePlans" ("PropertyId", "Id") ON DELETE RESTRICT,
        CONSTRAINT "FK_DailyRoomRates_RoomTypes_PropertyId_RoomTypeId" FOREIGN KEY ("PropertyId", "RoomTypeId") REFERENCES "RoomTypes" ("PropertyId", "Id") ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260722112304_AddDailyRoomRates') THEN
    CREATE INDEX "IX_DailyRoomRates_PropertyId_RatePlanId_StayDate" ON "DailyRoomRates" ("PropertyId", "RatePlanId", "StayDate");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260722112304_AddDailyRoomRates') THEN
    CREATE UNIQUE INDEX "IX_DailyRoomRates_PropertyId_RoomTypeId_RatePlanId_StayDate" ON "DailyRoomRates" ("PropertyId", "RoomTypeId", "RatePlanId", "StayDate");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260722112304_AddDailyRoomRates') THEN
    CREATE INDEX "IX_DailyRoomRates_PropertyId_RoomTypeId_StayDate" ON "DailyRoomRates" ("PropertyId", "RoomTypeId", "StayDate");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260722112304_AddDailyRoomRates') THEN
    CREATE INDEX "IX_DailyRoomRates_PropertyId_StayDate" ON "DailyRoomRates" ("PropertyId", "StayDate");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260722112304_AddDailyRoomRates') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20260722112304_AddDailyRoomRates', '8.0.29');
    END IF;
END $EF$;
COMMIT;

START TRANSACTION;


DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260722121010_AddDailyInventoryControls') THEN
    CREATE TABLE "DailyInventoryControls" (
        "Id" uuid NOT NULL,
        "PropertyId" uuid NOT NULL,
        "RoomTypeId" uuid NOT NULL,
        "StayDate" date NOT NULL,
        "SellableLimit" integer,
        "IsStopSell" boolean NOT NULL,
        "CreatedAt" timestamp with time zone NOT NULL,
        "UpdatedAt" timestamp with time zone NOT NULL,
        CONSTRAINT "PK_DailyInventoryControls" PRIMARY KEY ("Id"),
        CONSTRAINT "CK_DailyInventoryControls_Effect" CHECK ("SellableLimit" IS NOT NULL OR "IsStopSell" = TRUE),
        CONSTRAINT "CK_DailyInventoryControls_SellableLimit" CHECK ("SellableLimit" IS NULL OR "SellableLimit" >= 0),
        CONSTRAINT "CK_DailyInventoryControls_Timestamps" CHECK ("UpdatedAt" >= "CreatedAt"),
        CONSTRAINT "FK_DailyInventoryControls_Properties_PropertyId" FOREIGN KEY ("PropertyId") REFERENCES "Properties" ("Id") ON DELETE RESTRICT,
        CONSTRAINT "FK_DailyInventoryControls_RoomTypes_PropertyId_RoomTypeId" FOREIGN KEY ("PropertyId", "RoomTypeId") REFERENCES "RoomTypes" ("PropertyId", "Id") ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260722121010_AddDailyInventoryControls') THEN
    CREATE UNIQUE INDEX "IX_DailyInventoryControls_PropertyId_RoomTypeId_StayDate" ON "DailyInventoryControls" ("PropertyId", "RoomTypeId", "StayDate");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260722121010_AddDailyInventoryControls') THEN
    CREATE INDEX "IX_DailyInventoryControls_PropertyId_StayDate" ON "DailyInventoryControls" ("PropertyId", "StayDate");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260722121010_AddDailyInventoryControls') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20260722121010_AddDailyInventoryControls', '8.0.29');
    END IF;
END $EF$;
COMMIT;

START TRANSACTION;


DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260723085814_CustomerBookingIdentity') THEN
    CREATE TABLE "AspNetUsers" (
        "Id" uuid NOT NULL,
        "UserName" character varying(256),
        "NormalizedUserName" character varying(256),
        "Email" character varying(256) NOT NULL,
        "NormalizedEmail" character varying(256) NOT NULL,
        "EmailConfirmed" boolean NOT NULL,
        "PasswordHash" text,
        "SecurityStamp" text,
        "ConcurrencyStamp" text,
        "PhoneNumber" text,
        "PhoneNumberConfirmed" boolean NOT NULL,
        "TwoFactorEnabled" boolean NOT NULL,
        "LockoutEnd" timestamp with time zone,
        "LockoutEnabled" boolean NOT NULL,
        "AccessFailedCount" integer NOT NULL,
        CONSTRAINT "PK_AspNetUsers" PRIMARY KEY ("Id")
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260723085814_CustomerBookingIdentity') THEN
    CREATE TABLE "AspNetUserClaims" (
        "Id" integer GENERATED BY DEFAULT AS IDENTITY,
        "UserId" uuid NOT NULL,
        "ClaimType" text,
        "ClaimValue" text,
        CONSTRAINT "PK_AspNetUserClaims" PRIMARY KEY ("Id"),
        CONSTRAINT "FK_AspNetUserClaims_AspNetUsers_UserId" FOREIGN KEY ("UserId") REFERENCES "AspNetUsers" ("Id") ON DELETE CASCADE
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260723085814_CustomerBookingIdentity') THEN
    CREATE TABLE "AspNetUserLogins" (
        "LoginProvider" text NOT NULL,
        "ProviderKey" text NOT NULL,
        "ProviderDisplayName" text,
        "UserId" uuid NOT NULL,
        CONSTRAINT "PK_AspNetUserLogins" PRIMARY KEY ("LoginProvider", "ProviderKey"),
        CONSTRAINT "FK_AspNetUserLogins_AspNetUsers_UserId" FOREIGN KEY ("UserId") REFERENCES "AspNetUsers" ("Id") ON DELETE CASCADE
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260723085814_CustomerBookingIdentity') THEN
    CREATE TABLE "AspNetUserTokens" (
        "UserId" uuid NOT NULL,
        "LoginProvider" text NOT NULL,
        "Name" text NOT NULL,
        "Value" text,
        CONSTRAINT "PK_AspNetUserTokens" PRIMARY KEY ("UserId", "LoginProvider", "Name"),
        CONSTRAINT "FK_AspNetUserTokens_AspNetUsers_UserId" FOREIGN KEY ("UserId") REFERENCES "AspNetUsers" ("Id") ON DELETE CASCADE
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260723085814_CustomerBookingIdentity') THEN
    CREATE INDEX "IX_AspNetUserClaims_UserId" ON "AspNetUserClaims" ("UserId");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260723085814_CustomerBookingIdentity') THEN
    CREATE INDEX "IX_AspNetUserLogins_UserId" ON "AspNetUserLogins" ("UserId");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260723085814_CustomerBookingIdentity') THEN
    CREATE UNIQUE INDEX "UserNameIndex" ON "AspNetUsers" ("NormalizedUserName");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260723085814_CustomerBookingIdentity') THEN
    CREATE UNIQUE INDEX "UX_CustomerAccounts_NormalizedEmail" ON "AspNetUsers" ("NormalizedEmail");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260723085814_CustomerBookingIdentity') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20260723085814_CustomerBookingIdentity', '8.0.29');
    END IF;
END $EF$;
COMMIT;

START TRANSACTION;


DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260723105404_AddBookingHoldReservationFoundation') THEN
    CREATE TABLE "BookingHolds" (
        "Id" uuid NOT NULL,
        "PropertyId" uuid NOT NULL,
        "RoomTypeId" uuid NOT NULL,
        "RatePlanId" uuid NOT NULL,
        "CustomerAccountId" uuid,
        "FullName" character varying(200) NOT NULL,
        "Email" character varying(256) NOT NULL,
        "Phone" character varying(32) NOT NULL,
        "CheckIn" date NOT NULL,
        "CheckOut" date NOT NULL,
        "Adults" integer NOT NULL,
        "Children" integer NOT NULL,
        "Rooms" integer NOT NULL,
        "CurrencyCode" character varying(3) NOT NULL,
        "TotalAmount" numeric(18,2) NOT NULL,
        "Status" character varying(20) NOT NULL,
        "CreatedAtUtc" timestamp with time zone NOT NULL,
        "ExpiresAtUtc" timestamp with time zone NOT NULL,
        "IdempotencyKeyHash" character(64) NOT NULL,
        "RequestFingerprint" character(64) NOT NULL,
        "GuestAccessTokenHash" character(64),
        CONSTRAINT "PK_BookingHolds" PRIMARY KEY ("Id"),
        CONSTRAINT "CK_BookingHolds_Contact" CHECK (btrim("FullName") <> '' AND btrim("Email") <> '' AND btrim("Phone") <> ''),
        CONSTRAINT "CK_BookingHolds_Currency" CHECK ("CurrencyCode" ~ '^[A-Z]{3}$'),
        CONSTRAINT "CK_BookingHolds_FixedLifetime" CHECK ("ExpiresAtUtc" = "CreatedAtUtc" + INTERVAL '15 minutes'),
        CONSTRAINT "CK_BookingHolds_Hashes" CHECK ("IdempotencyKeyHash" ~ '^[0-9a-f]{64}$' AND "RequestFingerprint" ~ '^[0-9a-f]{64}$' AND ("GuestAccessTokenHash" IS NULL OR "GuestAccessTokenHash" ~ '^[0-9a-f]{64}$')),
        CONSTRAINT "CK_BookingHolds_Ids" CHECK ("Id" <> '00000000-0000-0000-0000-000000000000'::uuid AND "PropertyId" <> '00000000-0000-0000-0000-000000000000'::uuid AND "RoomTypeId" <> '00000000-0000-0000-0000-000000000000'::uuid AND "RatePlanId" <> '00000000-0000-0000-0000-000000000000'::uuid AND ("CustomerAccountId" IS NULL OR "CustomerAccountId" <> '00000000-0000-0000-0000-000000000000'::uuid)),
        CONSTRAINT "CK_BookingHolds_Occupancy" CHECK ("Adults" >= 1 AND "Children" >= 0 AND "Rooms" >= 1),
        CONSTRAINT "CK_BookingHolds_Ownership" CHECK (("CustomerAccountId" IS NOT NULL AND "GuestAccessTokenHash" IS NULL) OR ("CustomerAccountId" IS NULL AND "GuestAccessTokenHash" IS NOT NULL)),
        CONSTRAINT "CK_BookingHolds_Status" CHECK ("Status" IN ('Active', 'Confirmed', 'Cancelled')),
        CONSTRAINT "CK_BookingHolds_Stay" CHECK ("CheckIn" < "CheckOut"),
        CONSTRAINT "CK_BookingHolds_TotalAmount" CHECK ("TotalAmount" > 0),
        CONSTRAINT "FK_BookingHolds_AspNetUsers_CustomerAccountId" FOREIGN KEY ("CustomerAccountId") REFERENCES "AspNetUsers" ("Id") ON DELETE RESTRICT,
        CONSTRAINT "FK_BookingHolds_Properties_PropertyId" FOREIGN KEY ("PropertyId") REFERENCES "Properties" ("Id") ON DELETE RESTRICT,
        CONSTRAINT "FK_BookingHolds_RatePlans_PropertyId_RatePlanId" FOREIGN KEY ("PropertyId", "RatePlanId") REFERENCES "RatePlans" ("PropertyId", "Id") ON DELETE RESTRICT,
        CONSTRAINT "FK_BookingHolds_RoomTypes_PropertyId_RoomTypeId" FOREIGN KEY ("PropertyId", "RoomTypeId") REFERENCES "RoomTypes" ("PropertyId", "Id") ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260723105404_AddBookingHoldReservationFoundation') THEN
    CREATE TABLE "BookingHoldNights" (
        "BookingHoldId" uuid NOT NULL,
        "StayDate" date NOT NULL,
        "Rooms" integer NOT NULL,
        "UnitAmount" numeric(18,2) NOT NULL,
        "NightTotal" numeric(18,2) NOT NULL,
        CONSTRAINT "PK_BookingHoldNights" PRIMARY KEY ("BookingHoldId", "StayDate"),
        CONSTRAINT "CK_BookingHoldNights_Amounts" CHECK ("UnitAmount" > 0 AND "NightTotal" > 0 AND "NightTotal" = "UnitAmount" * "Rooms"),
        CONSTRAINT "CK_BookingHoldNights_BookingHoldId" CHECK ("BookingHoldId" <> '00000000-0000-0000-0000-000000000000'::uuid),
        CONSTRAINT "CK_BookingHoldNights_Rooms" CHECK ("Rooms" >= 1),
        CONSTRAINT "FK_BookingHoldNights_BookingHolds_BookingHoldId" FOREIGN KEY ("BookingHoldId") REFERENCES "BookingHolds" ("Id") ON DELETE CASCADE
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260723105404_AddBookingHoldReservationFoundation') THEN
    CREATE TABLE "Reservations" (
        "Id" uuid NOT NULL,
        "ConfirmationNumber" character varying(32) NOT NULL,
        "SourceHoldId" uuid NOT NULL,
        "PropertyId" uuid NOT NULL,
        "RoomTypeId" uuid NOT NULL,
        "RatePlanId" uuid NOT NULL,
        "CustomerAccountId" uuid,
        "FullName" character varying(200) NOT NULL,
        "Email" character varying(256) NOT NULL,
        "Phone" character varying(32) NOT NULL,
        "CheckIn" date NOT NULL,
        "CheckOut" date NOT NULL,
        "Adults" integer NOT NULL,
        "Children" integer NOT NULL,
        "Rooms" integer NOT NULL,
        "CurrencyCode" character varying(3) NOT NULL,
        "TotalAmount" numeric(18,2) NOT NULL,
        "Status" character varying(20) NOT NULL,
        "ConfirmedAtUtc" timestamp with time zone NOT NULL,
        "CancelledAtUtc" timestamp with time zone,
        "CancellationReason" character varying(500),
        "GuestAccessTokenHash" character(64),
        CONSTRAINT "PK_Reservations" PRIMARY KEY ("Id"),
        CONSTRAINT "CK_Reservations_Cancellation" CHECK (("Status" = 'Confirmed' AND "CancelledAtUtc" IS NULL AND "CancellationReason" IS NULL) OR ("Status" = 'Cancelled' AND "CancelledAtUtc" IS NOT NULL AND "CancelledAtUtc" >= "ConfirmedAtUtc" AND "CancellationReason" IS NOT NULL AND btrim("CancellationReason") <> '')),
        CONSTRAINT "CK_Reservations_ConfirmationNumber" CHECK ("ConfirmationNumber" ~ '^[A-Z0-9-]+$'),
        CONSTRAINT "CK_Reservations_Contact" CHECK (btrim("FullName") <> '' AND btrim("Email") <> '' AND btrim("Phone") <> ''),
        CONSTRAINT "CK_Reservations_Currency" CHECK ("CurrencyCode" ~ '^[A-Z]{3}$'),
        CONSTRAINT "CK_Reservations_Hash" CHECK ("GuestAccessTokenHash" IS NULL OR "GuestAccessTokenHash" ~ '^[0-9a-f]{64}$'),
        CONSTRAINT "CK_Reservations_Ids" CHECK ("Id" <> '00000000-0000-0000-0000-000000000000'::uuid AND "SourceHoldId" <> '00000000-0000-0000-0000-000000000000'::uuid AND "PropertyId" <> '00000000-0000-0000-0000-000000000000'::uuid AND "RoomTypeId" <> '00000000-0000-0000-0000-000000000000'::uuid AND "RatePlanId" <> '00000000-0000-0000-0000-000000000000'::uuid AND ("CustomerAccountId" IS NULL OR "CustomerAccountId" <> '00000000-0000-0000-0000-000000000000'::uuid)),
        CONSTRAINT "CK_Reservations_Occupancy" CHECK ("Adults" >= 1 AND "Children" >= 0 AND "Rooms" >= 1),
        CONSTRAINT "CK_Reservations_Ownership" CHECK (("CustomerAccountId" IS NOT NULL AND "GuestAccessTokenHash" IS NULL) OR ("CustomerAccountId" IS NULL AND "GuestAccessTokenHash" IS NOT NULL)),
        CONSTRAINT "CK_Reservations_Status" CHECK ("Status" IN ('Confirmed', 'Cancelled')),
        CONSTRAINT "CK_Reservations_Stay" CHECK ("CheckIn" < "CheckOut"),
        CONSTRAINT "CK_Reservations_TotalAmount" CHECK ("TotalAmount" > 0),
        CONSTRAINT "FK_Reservations_AspNetUsers_CustomerAccountId" FOREIGN KEY ("CustomerAccountId") REFERENCES "AspNetUsers" ("Id") ON DELETE RESTRICT,
        CONSTRAINT "FK_Reservations_BookingHolds_SourceHoldId" FOREIGN KEY ("SourceHoldId") REFERENCES "BookingHolds" ("Id") ON DELETE RESTRICT,
        CONSTRAINT "FK_Reservations_Properties_PropertyId" FOREIGN KEY ("PropertyId") REFERENCES "Properties" ("Id") ON DELETE RESTRICT,
        CONSTRAINT "FK_Reservations_RatePlans_PropertyId_RatePlanId" FOREIGN KEY ("PropertyId", "RatePlanId") REFERENCES "RatePlans" ("PropertyId", "Id") ON DELETE RESTRICT,
        CONSTRAINT "FK_Reservations_RoomTypes_PropertyId_RoomTypeId" FOREIGN KEY ("PropertyId", "RoomTypeId") REFERENCES "RoomTypes" ("PropertyId", "Id") ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260723105404_AddBookingHoldReservationFoundation') THEN
    CREATE TABLE "ReservationNights" (
        "ReservationId" uuid NOT NULL,
        "StayDate" date NOT NULL,
        "Rooms" integer NOT NULL,
        "UnitAmount" numeric(18,2) NOT NULL,
        "NightTotal" numeric(18,2) NOT NULL,
        CONSTRAINT "PK_ReservationNights" PRIMARY KEY ("ReservationId", "StayDate"),
        CONSTRAINT "CK_ReservationNights_Amounts" CHECK ("UnitAmount" > 0 AND "NightTotal" > 0 AND "NightTotal" = "UnitAmount" * "Rooms"),
        CONSTRAINT "CK_ReservationNights_ReservationId" CHECK ("ReservationId" <> '00000000-0000-0000-0000-000000000000'::uuid),
        CONSTRAINT "CK_ReservationNights_Rooms" CHECK ("Rooms" >= 1),
        CONSTRAINT "FK_ReservationNights_Reservations_ReservationId" FOREIGN KEY ("ReservationId") REFERENCES "Reservations" ("Id") ON DELETE CASCADE
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260723105404_AddBookingHoldReservationFoundation') THEN
    CREATE INDEX "IX_BookingHoldNights_StayDate_BookingHoldId" ON "BookingHoldNights" ("StayDate", "BookingHoldId");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260723105404_AddBookingHoldReservationFoundation') THEN
    CREATE INDEX "IX_BookingHolds_CustomerAccountId" ON "BookingHolds" ("CustomerAccountId");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260723105404_AddBookingHoldReservationFoundation') THEN
    CREATE UNIQUE INDEX "IX_BookingHolds_IdempotencyKeyHash" ON "BookingHolds" ("IdempotencyKeyHash");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260723105404_AddBookingHoldReservationFoundation') THEN
    CREATE INDEX "IX_BookingHolds_PropertyId_RatePlanId" ON "BookingHolds" ("PropertyId", "RatePlanId");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260723105404_AddBookingHoldReservationFoundation') THEN
    CREATE INDEX "IX_BookingHolds_PropertyId_RoomTypeId_Status_ExpiresAtUtc" ON "BookingHolds" ("PropertyId", "RoomTypeId", "Status", "ExpiresAtUtc");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260723105404_AddBookingHoldReservationFoundation') THEN
    CREATE INDEX "IX_ReservationNights_StayDate_ReservationId" ON "ReservationNights" ("StayDate", "ReservationId");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260723105404_AddBookingHoldReservationFoundation') THEN
    CREATE UNIQUE INDEX "IX_Reservations_ConfirmationNumber" ON "Reservations" ("ConfirmationNumber");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260723105404_AddBookingHoldReservationFoundation') THEN
    CREATE INDEX "IX_Reservations_CustomerAccountId" ON "Reservations" ("CustomerAccountId");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260723105404_AddBookingHoldReservationFoundation') THEN
    CREATE INDEX "IX_Reservations_PropertyId_RatePlanId" ON "Reservations" ("PropertyId", "RatePlanId");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260723105404_AddBookingHoldReservationFoundation') THEN
    CREATE INDEX "IX_Reservations_PropertyId_RoomTypeId_Status" ON "Reservations" ("PropertyId", "RoomTypeId", "Status");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260723105404_AddBookingHoldReservationFoundation') THEN
    CREATE UNIQUE INDEX "IX_Reservations_SourceHoldId" ON "Reservations" ("SourceHoldId");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260723105404_AddBookingHoldReservationFoundation') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20260723105404_AddBookingHoldReservationFoundation', '8.0.29');
    END IF;
END $EF$;
COMMIT;

START TRANSACTION;


DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    CREATE FUNCTION pg_temp.thebha_v2_uuid(seed text) RETURNS uuid
    LANGUAGE sql IMMUTABLE AS $$
        SELECT (
            substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-' || substr(h, 13, 4) ||
            '-' || substr(h, 17, 4) || '-' || substr(h, 21, 12)
        )::uuid
        FROM (SELECT md5(seed) AS h) source
    $$;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    ALTER TABLE "Reservations" ADD CONSTRAINT "AK_Reservations_PropertyId_Id" UNIQUE ("PropertyId", "Id");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    CREATE TABLE "InventoryHolds" (
        "Id" uuid NOT NULL,
        "PropertyId" uuid NOT NULL,
        "CustomerAccountId" uuid,
        "FullName" character varying(200) NOT NULL,
        "Email" character varying(256) NOT NULL,
        "Phone" character varying(32) NOT NULL,
        "CheckIn" date NOT NULL,
        "CheckOut" date NOT NULL,
        "Adults" integer NOT NULL,
        "Children" integer NOT NULL,
        "CurrencyCode" character varying(3) NOT NULL,
        "TotalAmount" numeric(18,2) NOT NULL,
        "Status" character varying(20) NOT NULL,
        "CreatedAtUtc" timestamp with time zone NOT NULL,
        "ExpiresAtUtc" timestamp with time zone NOT NULL,
        "IdempotencyKeyHash" character(64) NOT NULL,
        "RequestFingerprint" character(64) NOT NULL,
        "GuestAccessTokenHash" character(64),
        CONSTRAINT "PK_InventoryHolds" PRIMARY KEY ("Id"),
        CONSTRAINT "AK_InventoryHolds_PropertyId_Id" UNIQUE ("PropertyId", "Id"),
        CONSTRAINT "CK_InventoryHolds_Contact" CHECK (btrim("FullName") <> '' AND btrim("Email") <> '' AND btrim("Phone") <> ''),
        CONSTRAINT "CK_InventoryHolds_Currency" CHECK ("CurrencyCode" ~ '^[A-Z]{3}$'),
        CONSTRAINT "CK_InventoryHolds_FixedLifetime" CHECK ("ExpiresAtUtc" = "CreatedAtUtc" + INTERVAL '15 minutes'),
        CONSTRAINT "CK_InventoryHolds_Hashes" CHECK ("IdempotencyKeyHash" ~ '^[0-9a-f]{64}$' AND "RequestFingerprint" ~ '^[0-9a-f]{64}$' AND ("GuestAccessTokenHash" IS NULL OR "GuestAccessTokenHash" ~ '^[0-9a-f]{64}$')),
        CONSTRAINT "CK_InventoryHolds_Ids" CHECK ("Id" <> '00000000-0000-0000-0000-000000000000'::uuid AND "PropertyId" <> '00000000-0000-0000-0000-000000000000'::uuid AND ("CustomerAccountId" IS NULL OR "CustomerAccountId" <> '00000000-0000-0000-0000-000000000000'::uuid)),
        CONSTRAINT "CK_InventoryHolds_Occupancy" CHECK ("Adults" >= 1 AND "Children" >= 0),
        CONSTRAINT "CK_InventoryHolds_Ownership" CHECK (("CustomerAccountId" IS NOT NULL AND "GuestAccessTokenHash" IS NULL) OR ("CustomerAccountId" IS NULL AND "GuestAccessTokenHash" IS NOT NULL)),
        CONSTRAINT "CK_InventoryHolds_Status" CHECK ("Status" IN ('Active', 'Confirmed', 'Cancelled')),
        CONSTRAINT "CK_InventoryHolds_Stay" CHECK ("CheckIn" < "CheckOut"),
        CONSTRAINT "CK_InventoryHolds_TotalAmount" CHECK ("TotalAmount" > 0),
        CONSTRAINT "FK_InventoryHolds_AspNetUsers_CustomerAccountId" FOREIGN KEY ("CustomerAccountId") REFERENCES "AspNetUsers" ("Id") ON DELETE RESTRICT,
        CONSTRAINT "FK_InventoryHolds_Properties_PropertyId" FOREIGN KEY ("PropertyId") REFERENCES "Properties" ("Id") ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    CREATE TABLE "InventoryHoldItems" (
        "Id" uuid NOT NULL,
        "InventoryHoldId" uuid NOT NULL,
        "PropertyId" uuid NOT NULL,
        "RoomTypeId" uuid NOT NULL,
        CONSTRAINT "PK_InventoryHoldItems" PRIMARY KEY ("Id"),
        CONSTRAINT "AK_InventoryHoldItems_PropertyId_Id" UNIQUE ("PropertyId", "Id"),
        CONSTRAINT "CK_InventoryHoldItems_Ids" CHECK ("Id" <> '00000000-0000-0000-0000-000000000000'::uuid AND "InventoryHoldId" <> '00000000-0000-0000-0000-000000000000'::uuid AND "PropertyId" <> '00000000-0000-0000-0000-000000000000'::uuid AND "RoomTypeId" <> '00000000-0000-0000-0000-000000000000'::uuid),
        CONSTRAINT "FK_InventoryHoldItems_InventoryHolds_PropertyId_InventoryHoldId" FOREIGN KEY ("PropertyId", "InventoryHoldId") REFERENCES "InventoryHolds" ("PropertyId", "Id") ON DELETE CASCADE,
        CONSTRAINT "FK_InventoryHoldItems_RoomTypes_PropertyId_RoomTypeId" FOREIGN KEY ("PropertyId", "RoomTypeId") REFERENCES "RoomTypes" ("PropertyId", "Id") ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    CREATE TABLE "InventoryHoldItemNights" (
        "InventoryHoldItemId" uuid NOT NULL,
        "StayDate" date NOT NULL,
        "PropertyId" uuid NOT NULL,
        "RatePlanId" uuid NOT NULL,
        "UnitAmount" numeric(18,2) NOT NULL,
        CONSTRAINT "PK_InventoryHoldItemNights" PRIMARY KEY ("InventoryHoldItemId", "StayDate"),
        CONSTRAINT "CK_InventoryHoldItemNights_Amount" CHECK ("UnitAmount" > 0),
        CONSTRAINT "CK_InventoryHoldItemNights_Ids" CHECK ("InventoryHoldItemId" <> '00000000-0000-0000-0000-000000000000'::uuid AND "PropertyId" <> '00000000-0000-0000-0000-000000000000'::uuid AND "RatePlanId" <> '00000000-0000-0000-0000-000000000000'::uuid),
        CONSTRAINT "FK_InventoryHoldItemNights_InventoryHoldItems_PropertyId_Inven~" FOREIGN KEY ("PropertyId", "InventoryHoldItemId") REFERENCES "InventoryHoldItems" ("PropertyId", "Id") ON DELETE CASCADE,
        CONSTRAINT "FK_InventoryHoldItemNights_RatePlans_PropertyId_RatePlanId" FOREIGN KEY ("PropertyId", "RatePlanId") REFERENCES "RatePlans" ("PropertyId", "Id") ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    CREATE TABLE "ReservationUnits" (
        "Id" uuid NOT NULL,
        "ReservationId" uuid NOT NULL,
        "PropertyId" uuid NOT NULL,
        "RoomTypeId" uuid NOT NULL,
        "SourceInventoryHoldItemId" uuid,
        "CommitmentStatus" character varying(20) NOT NULL,
        CONSTRAINT "PK_ReservationUnits" PRIMARY KEY ("Id"),
        CONSTRAINT "AK_ReservationUnits_PropertyId_Id" UNIQUE ("PropertyId", "Id"),
        CONSTRAINT "CK_ReservationUnits_CommitmentStatus" CHECK ("CommitmentStatus" IN ('Committed', 'Cancelled')),
        CONSTRAINT "CK_ReservationUnits_Ids" CHECK ("Id" <> '00000000-0000-0000-0000-000000000000'::uuid AND "ReservationId" <> '00000000-0000-0000-0000-000000000000'::uuid AND "PropertyId" <> '00000000-0000-0000-0000-000000000000'::uuid AND "RoomTypeId" <> '00000000-0000-0000-0000-000000000000'::uuid AND ("SourceInventoryHoldItemId" IS NULL OR "SourceInventoryHoldItemId" <> '00000000-0000-0000-0000-000000000000'::uuid)),
        CONSTRAINT "FK_ReservationUnits_InventoryHoldItems_PropertyId_SourceInvent~" FOREIGN KEY ("PropertyId", "SourceInventoryHoldItemId") REFERENCES "InventoryHoldItems" ("PropertyId", "Id") ON DELETE RESTRICT,
        CONSTRAINT "FK_ReservationUnits_Reservations_PropertyId_ReservationId" FOREIGN KEY ("PropertyId", "ReservationId") REFERENCES "Reservations" ("PropertyId", "Id") ON DELETE CASCADE,
        CONSTRAINT "FK_ReservationUnits_RoomTypes_PropertyId_RoomTypeId" FOREIGN KEY ("PropertyId", "RoomTypeId") REFERENCES "RoomTypes" ("PropertyId", "Id") ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    CREATE TABLE "ReservationUnitNights" (
        "ReservationUnitId" uuid NOT NULL,
        "StayDate" date NOT NULL,
        "PropertyId" uuid NOT NULL,
        "RatePlanId" uuid NOT NULL,
        "UnitAmount" numeric(18,2) NOT NULL,
        CONSTRAINT "PK_ReservationUnitNights" PRIMARY KEY ("ReservationUnitId", "StayDate"),
        CONSTRAINT "CK_ReservationUnitNights_Amount" CHECK ("UnitAmount" > 0),
        CONSTRAINT "CK_ReservationUnitNights_Ids" CHECK ("ReservationUnitId" <> '00000000-0000-0000-0000-000000000000'::uuid AND "PropertyId" <> '00000000-0000-0000-0000-000000000000'::uuid AND "RatePlanId" <> '00000000-0000-0000-0000-000000000000'::uuid),
        CONSTRAINT "FK_ReservationUnitNights_RatePlans_PropertyId_RatePlanId" FOREIGN KEY ("PropertyId", "RatePlanId") REFERENCES "RatePlans" ("PropertyId", "Id") ON DELETE RESTRICT,
        CONSTRAINT "FK_ReservationUnitNights_ReservationUnits_PropertyId_Reservati~" FOREIGN KEY ("PropertyId", "ReservationUnitId") REFERENCES "ReservationUnits" ("PropertyId", "Id") ON DELETE CASCADE
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    CREATE INDEX "IX_InventoryHoldItemNights_PropertyId_InventoryHoldItemId" ON "InventoryHoldItemNights" ("PropertyId", "InventoryHoldItemId");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    CREATE INDEX "IX_InventoryHoldItemNights_PropertyId_RatePlanId" ON "InventoryHoldItemNights" ("PropertyId", "RatePlanId");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    CREATE INDEX "IX_InventoryHoldItemNights_StayDate_InventoryHoldItemId" ON "InventoryHoldItemNights" ("StayDate", "InventoryHoldItemId");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    CREATE INDEX "IX_InventoryHoldItems_InventoryHoldId" ON "InventoryHoldItems" ("InventoryHoldId");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    CREATE INDEX "IX_InventoryHoldItems_PropertyId_InventoryHoldId" ON "InventoryHoldItems" ("PropertyId", "InventoryHoldId");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    CREATE INDEX "IX_InventoryHoldItems_PropertyId_RoomTypeId" ON "InventoryHoldItems" ("PropertyId", "RoomTypeId");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    CREATE INDEX "IX_InventoryHolds_CustomerAccountId" ON "InventoryHolds" ("CustomerAccountId");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    CREATE UNIQUE INDEX "IX_InventoryHolds_IdempotencyKeyHash" ON "InventoryHolds" ("IdempotencyKeyHash");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    CREATE INDEX "IX_InventoryHolds_Status_ExpiresAtUtc" ON "InventoryHolds" ("Status", "ExpiresAtUtc");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    CREATE INDEX "IX_ReservationUnitNights_PropertyId_RatePlanId" ON "ReservationUnitNights" ("PropertyId", "RatePlanId");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    CREATE INDEX "IX_ReservationUnitNights_PropertyId_ReservationUnitId" ON "ReservationUnitNights" ("PropertyId", "ReservationUnitId");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    CREATE INDEX "IX_ReservationUnitNights_StayDate_ReservationUnitId" ON "ReservationUnitNights" ("StayDate", "ReservationUnitId");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    CREATE INDEX "IX_ReservationUnits_PropertyId_ReservationId" ON "ReservationUnits" ("PropertyId", "ReservationId");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    CREATE INDEX "IX_ReservationUnits_PropertyId_RoomTypeId_CommitmentStatus" ON "ReservationUnits" ("PropertyId", "RoomTypeId", "CommitmentStatus");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    CREATE UNIQUE INDEX "IX_ReservationUnits_PropertyId_SourceInventoryHoldItemId" ON "ReservationUnits" ("PropertyId", "SourceInventoryHoldItemId");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    CREATE INDEX "IX_ReservationUnits_ReservationId" ON "ReservationUnits" ("ReservationId");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    CREATE UNIQUE INDEX "IX_ReservationUnits_SourceInventoryHoldItemId" ON "ReservationUnits" ("SourceInventoryHoldItemId");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    INSERT INTO "InventoryHolds"
        ("Id", "PropertyId", "CustomerAccountId", "FullName", "Email", "Phone",
         "CheckIn", "CheckOut", "Adults", "Children", "CurrencyCode", "TotalAmount",
         "Status", "CreatedAtUtc", "ExpiresAtUtc", "IdempotencyKeyHash",
         "RequestFingerprint", "GuestAccessTokenHash")
    SELECT
        "Id", "PropertyId", "CustomerAccountId", "FullName", "Email", "Phone",
        "CheckIn", "CheckOut", "Adults", "Children", "CurrencyCode", "TotalAmount",
        "Status", "CreatedAtUtc", "ExpiresAtUtc", "IdempotencyKeyHash",
        "RequestFingerprint", "GuestAccessTokenHash"
    FROM "BookingHolds";
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    INSERT INTO "InventoryHoldItems" ("Id", "InventoryHoldId", "PropertyId", "RoomTypeId")
    SELECT
        pg_temp.thebha_v2_uuid('thebha-v2-item:' || bh."Id"::text || ':' || ord::text),
        bh."Id", bh."PropertyId", bh."RoomTypeId"
    FROM "BookingHolds" bh
    CROSS JOIN LATERAL generate_series(1, bh."Rooms") AS ord;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    INSERT INTO "InventoryHoldItemNights"
        ("InventoryHoldItemId", "PropertyId", "StayDate", "RatePlanId", "UnitAmount")
    SELECT ihi."Id", bh."PropertyId", bhn."StayDate", bh."RatePlanId", bhn."UnitAmount"
    FROM "BookingHoldNights" bhn
    JOIN "BookingHolds" bh ON bh."Id" = bhn."BookingHoldId"
    JOIN "InventoryHoldItems" ihi ON ihi."InventoryHoldId" = bh."Id";
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    INSERT INTO "ReservationUnits"
        ("Id", "ReservationId", "PropertyId", "RoomTypeId", "SourceInventoryHoldItemId",
         "CommitmentStatus")
    SELECT
        pg_temp.thebha_v2_uuid('thebha-v2-unit:' || r."Id"::text || ':' || ord::text),
        r."Id", r."PropertyId", r."RoomTypeId",
        pg_temp.thebha_v2_uuid('thebha-v2-item:' || r."SourceHoldId"::text || ':' || ord::text),
        CASE WHEN r."Status" = 'Confirmed' THEN 'Committed' ELSE 'Cancelled' END
    FROM "Reservations" r
    CROSS JOIN LATERAL generate_series(1, r."Rooms") AS ord;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    INSERT INTO "ReservationUnitNights"
        ("ReservationUnitId", "PropertyId", "StayDate", "RatePlanId", "UnitAmount")
    SELECT ru."Id", r."PropertyId", rn."StayDate", r."RatePlanId", rn."UnitAmount"
    FROM "ReservationNights" rn
    JOIN "Reservations" r ON r."Id" = rn."ReservationId"
    JOIN "ReservationUnits" ru ON ru."ReservationId" = r."Id";
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    DO $$
    DECLARE
        expected_items bigint;
        actual_items bigint;
        expected_item_nights bigint;
        actual_item_nights bigint;
        expected_units bigint;
        actual_units bigint;
        expected_unit_nights bigint;
        actual_unit_nights bigint;
        duplicate_item_ids bigint;
        duplicate_unit_ids bigint;
        orphan_units bigint;
        duplicate_source_items bigint;
        legacy_hold_total numeric(18,2);
        normalized_hold_total numeric(18,2);
        legacy_reservation_total numeric(18,2);
        normalized_reservation_total numeric(18,2);
        mismatch_count bigint;
    BEGIN
        SELECT COALESCE(SUM("Rooms"), 0) INTO expected_items FROM "BookingHolds";
        SELECT COUNT(*) INTO actual_items FROM "InventoryHoldItems";
        IF expected_items <> actual_items THEN
            RAISE EXCEPTION
                'CommercialCommitmentV2Foundation: InventoryHoldItems count % does not match expected % (sum of legacy BookingHolds.Rooms)',
                actual_items, expected_items;
        END IF;

        SELECT COUNT(*) INTO duplicate_item_ids
        FROM (SELECT "Id" FROM "InventoryHoldItems" GROUP BY "Id" HAVING COUNT(*) > 1) d;
        IF duplicate_item_ids > 0 THEN
            RAISE EXCEPTION
                'CommercialCommitmentV2Foundation: % duplicate InventoryHoldItem ids were generated',
                duplicate_item_ids;
        END IF;

        SELECT COALESCE(SUM(bh."Rooms"), 0) INTO expected_item_nights
        FROM "BookingHoldNights" bhn JOIN "BookingHolds" bh ON bh."Id" = bhn."BookingHoldId";
        SELECT COUNT(*) INTO actual_item_nights FROM "InventoryHoldItemNights";
        IF expected_item_nights <> actual_item_nights THEN
            RAISE EXCEPTION
                'CommercialCommitmentV2Foundation: InventoryHoldItemNights count % does not match expected % — a missing or duplicate legacy night would surface here',
                actual_item_nights, expected_item_nights;
        END IF;

        SELECT COALESCE(SUM("Rooms"), 0) INTO expected_units FROM "Reservations";
        SELECT COUNT(*) INTO actual_units FROM "ReservationUnits";
        IF expected_units <> actual_units THEN
            RAISE EXCEPTION
                'CommercialCommitmentV2Foundation: ReservationUnits count % does not match expected % (sum of legacy Reservations.Rooms)',
                actual_units, expected_units;
        END IF;

        SELECT COUNT(*) INTO duplicate_unit_ids
        FROM (SELECT "Id" FROM "ReservationUnits" GROUP BY "Id" HAVING COUNT(*) > 1) d;
        IF duplicate_unit_ids > 0 THEN
            RAISE EXCEPTION
                'CommercialCommitmentV2Foundation: % duplicate ReservationUnit ids were generated',
                duplicate_unit_ids;
        END IF;

        SELECT COALESCE(SUM(r."Rooms"), 0) INTO expected_unit_nights
        FROM "ReservationNights" rn JOIN "Reservations" r ON r."Id" = rn."ReservationId";
        SELECT COUNT(*) INTO actual_unit_nights FROM "ReservationUnitNights";
        IF expected_unit_nights <> actual_unit_nights THEN
            RAISE EXCEPTION
                'CommercialCommitmentV2Foundation: ReservationUnitNights count % does not match expected %',
                actual_unit_nights, expected_unit_nights;
        END IF;

        SELECT COUNT(*) INTO orphan_units
        FROM "ReservationUnits" ru
        LEFT JOIN "InventoryHoldItems" ihi ON ihi."Id" = ru."SourceInventoryHoldItemId"
        WHERE ihi."Id" IS NULL;
        IF orphan_units > 0 THEN
            RAISE EXCEPTION
                'CommercialCommitmentV2Foundation: % ReservationUnits reference a missing source InventoryHoldItem',
                orphan_units;
        END IF;

        SELECT COUNT(*) INTO duplicate_source_items FROM (
            SELECT "SourceInventoryHoldItemId" FROM "ReservationUnits"
            GROUP BY "SourceInventoryHoldItemId" HAVING COUNT(*) > 1
        ) d;
        IF duplicate_source_items > 0 THEN
            RAISE EXCEPTION
                'CommercialCommitmentV2Foundation: % source InventoryHoldItems are claimed by more than one ReservationUnit (uniqueness rule 9 violated)',
                duplicate_source_items;
        END IF;

        SELECT COALESCE(SUM("TotalAmount"), 0) INTO legacy_hold_total FROM "BookingHolds";
        SELECT COALESCE(SUM("UnitAmount"), 0) INTO normalized_hold_total FROM "InventoryHoldItemNights";
        IF legacy_hold_total <> normalized_hold_total THEN
            RAISE EXCEPTION
                'CommercialCommitmentV2Foundation: normalized Hold accepted-money total % does not match legacy total %',
                normalized_hold_total, legacy_hold_total;
        END IF;

        SELECT COALESCE(SUM("TotalAmount"), 0) INTO legacy_reservation_total FROM "Reservations";
        SELECT COALESCE(SUM("UnitAmount"), 0) INTO normalized_reservation_total FROM "ReservationUnitNights";
        IF legacy_reservation_total <> normalized_reservation_total THEN
            RAISE EXCEPTION
                'CommercialCommitmentV2Foundation: normalized Reservation accepted-money total % does not match legacy total %',
                normalized_reservation_total, legacy_reservation_total;
        END IF;

        SELECT COUNT(*) INTO mismatch_count
        FROM "InventoryHoldItemNights" ihn
        JOIN "InventoryHoldItems" ihi ON ihi."Id" = ihn."InventoryHoldItemId"
        WHERE ihn."PropertyId" <> ihi."PropertyId";
        IF mismatch_count > 0 THEN
            RAISE EXCEPTION
                'CommercialCommitmentV2Foundation: % InventoryHoldItemNights have a PropertyId inconsistent with their Item',
                mismatch_count;
        END IF;

        SELECT COUNT(*) INTO mismatch_count
        FROM "ReservationUnitNights" run
        JOIN "ReservationUnits" ru ON ru."Id" = run."ReservationUnitId"
        WHERE run."PropertyId" <> ru."PropertyId";
        IF mismatch_count > 0 THEN
            RAISE EXCEPTION
                'CommercialCommitmentV2Foundation: % ReservationUnitNights have a PropertyId inconsistent with their Unit',
                mismatch_count;
        END IF;

        SELECT COUNT(*) INTO mismatch_count
        FROM "InventoryHoldItems" ihi
        JOIN "InventoryHolds" ih ON ih."Id" = ihi."InventoryHoldId"
        WHERE ihi."PropertyId" <> ih."PropertyId";
        IF mismatch_count > 0 THEN
            RAISE EXCEPTION
                'CommercialCommitmentV2Foundation: % InventoryHoldItems have a PropertyId inconsistent with their Hold',
                mismatch_count;
        END IF;

        SELECT COUNT(*) INTO mismatch_count
        FROM "ReservationUnits" ru
        JOIN "Reservations" r ON r."Id" = ru."ReservationId"
        WHERE ru."PropertyId" <> r."PropertyId";
        IF mismatch_count > 0 THEN
            RAISE EXCEPTION
                'CommercialCommitmentV2Foundation: % ReservationUnits have a PropertyId inconsistent with their Reservation',
                mismatch_count;
        END IF;
    END $$;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    ALTER TABLE "Reservations" DROP CONSTRAINT "FK_Reservations_BookingHolds_SourceHoldId";
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    ALTER TABLE "Reservations" DROP CONSTRAINT "FK_Reservations_RatePlans_PropertyId_RatePlanId";
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    ALTER TABLE "Reservations" DROP CONSTRAINT "FK_Reservations_RoomTypes_PropertyId_RoomTypeId";
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    DROP INDEX "IX_Reservations_PropertyId_RatePlanId";
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    DROP INDEX "IX_Reservations_PropertyId_RoomTypeId_Status";
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    ALTER TABLE "Reservations" DROP CONSTRAINT "CK_Reservations_Ids";
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    ALTER TABLE "Reservations" DROP CONSTRAINT "CK_Reservations_Occupancy";
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    ALTER TABLE "Reservations" DROP COLUMN "RatePlanId";
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    ALTER TABLE "Reservations" DROP COLUMN "RoomTypeId";
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    ALTER TABLE "Reservations" DROP COLUMN "Rooms";
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    ALTER TABLE "Reservations" ADD CONSTRAINT "CK_Reservations_Ids" CHECK ("Id" <> '00000000-0000-0000-0000-000000000000'::uuid AND "SourceHoldId" <> '00000000-0000-0000-0000-000000000000'::uuid AND "PropertyId" <> '00000000-0000-0000-0000-000000000000'::uuid AND ("CustomerAccountId" IS NULL OR "CustomerAccountId" <> '00000000-0000-0000-0000-000000000000'::uuid));
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    ALTER TABLE "Reservations" ADD CONSTRAINT "CK_Reservations_Occupancy" CHECK ("Adults" >= 1 AND "Children" >= 0);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    CREATE UNIQUE INDEX "IX_Reservations_PropertyId_SourceHoldId" ON "Reservations" ("PropertyId", "SourceHoldId");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    ALTER TABLE "Reservations" ADD CONSTRAINT "FK_Reservations_InventoryHolds_PropertyId_SourceHoldId" FOREIGN KEY ("PropertyId", "SourceHoldId") REFERENCES "InventoryHolds" ("PropertyId", "Id") ON DELETE RESTRICT;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    DROP TABLE "BookingHoldNights";
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    DROP TABLE "ReservationNights";
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    DROP TABLE "BookingHolds";
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260823084717_CommercialCommitmentV2Foundation') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20260823084717_CommercialCommitmentV2Foundation', '8.0.29');
    END IF;
END $EF$;
COMMIT;

START TRANSACTION;


DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260826035254_PhysicalRoomScheduleAvailabilityAuthority') THEN
    ALTER TABLE "PhysicalRooms" ADD CONSTRAINT "AK_PhysicalRooms_PropertyId_Id" UNIQUE ("PropertyId", "Id");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260826035254_PhysicalRoomScheduleAvailabilityAuthority') THEN
    CREATE TABLE "RoomBlocks" (
        "Id" uuid NOT NULL,
        "PropertyId" uuid NOT NULL,
        "Reason" character varying(500) NOT NULL,
        "CreatedByActorReference" character varying(200) NOT NULL,
        "CreatedAtUtc" timestamp with time zone NOT NULL,
        CONSTRAINT "PK_RoomBlocks" PRIMARY KEY ("Id"),
        CONSTRAINT "AK_RoomBlocks_PropertyId_Id" UNIQUE ("PropertyId", "Id"),
        CONSTRAINT "CK_RoomBlocks_CreatedByActorReference" CHECK (btrim("CreatedByActorReference") <> ''),
        CONSTRAINT "CK_RoomBlocks_Ids" CHECK ("Id" <> '00000000-0000-0000-0000-000000000000'::uuid AND "PropertyId" <> '00000000-0000-0000-0000-000000000000'::uuid),
        CONSTRAINT "CK_RoomBlocks_Reason" CHECK (btrim("Reason") <> ''),
        CONSTRAINT "FK_RoomBlocks_Properties_PropertyId" FOREIGN KEY ("PropertyId") REFERENCES "Properties" ("Id") ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260826035254_PhysicalRoomScheduleAvailabilityAuthority') THEN
    CREATE TABLE "RoomOccupancySegments" (
        "Id" uuid NOT NULL,
        "PropertyId" uuid NOT NULL,
        "PhysicalRoomId" uuid NOT NULL,
        "Type" character varying(30) NOT NULL,
        "Status" character varying(20) NOT NULL,
        "StartDate" date NOT NULL,
        "EndDate" date NOT NULL,
        "ReservationUnitId" uuid,
        "RoomBlockId" uuid,
        "CreatedAtUtc" timestamp with time zone NOT NULL,
        CONSTRAINT "PK_RoomOccupancySegments" PRIMARY KEY ("Id"),
        CONSTRAINT "AK_RoomOccupancySegments_PropertyId_Id" UNIQUE ("PropertyId", "Id"),
        CONSTRAINT "CK_RoomOccupancySegments_DateRange" CHECK ("StartDate" < "EndDate"),
        CONSTRAINT "CK_RoomOccupancySegments_Ids" CHECK ("Id" <> '00000000-0000-0000-0000-000000000000'::uuid AND "PropertyId" <> '00000000-0000-0000-0000-000000000000'::uuid AND "PhysicalRoomId" <> '00000000-0000-0000-0000-000000000000'::uuid AND ("ReservationUnitId" IS NULL OR "ReservationUnitId" <> '00000000-0000-0000-0000-000000000000'::uuid) AND ("RoomBlockId" IS NULL OR "RoomBlockId" <> '00000000-0000-0000-0000-000000000000'::uuid)),
        CONSTRAINT "CK_RoomOccupancySegments_Status" CHECK ("Status" IN ('Effective', 'Cancelled')),
        CONSTRAINT "CK_RoomOccupancySegments_Type" CHECK ("Type" IN ('ReservationAssignment', 'OperationalBlock')),
        CONSTRAINT "CK_RoomOccupancySegments_TypeReference" CHECK (("Type" = 'ReservationAssignment' AND "ReservationUnitId" IS NOT NULL AND "RoomBlockId" IS NULL) OR ("Type" = 'OperationalBlock' AND "RoomBlockId" IS NOT NULL AND "ReservationUnitId" IS NULL)),
        CONSTRAINT "FK_RoomOccupancySegments_PhysicalRooms_PropertyId_PhysicalRoom~" FOREIGN KEY ("PropertyId", "PhysicalRoomId") REFERENCES "PhysicalRooms" ("PropertyId", "Id") ON DELETE RESTRICT,
        CONSTRAINT "FK_RoomOccupancySegments_ReservationUnits_PropertyId_Reservati~" FOREIGN KEY ("PropertyId", "ReservationUnitId") REFERENCES "ReservationUnits" ("PropertyId", "Id") ON DELETE RESTRICT,
        CONSTRAINT "FK_RoomOccupancySegments_RoomBlocks_PropertyId_RoomBlockId" FOREIGN KEY ("PropertyId", "RoomBlockId") REFERENCES "RoomBlocks" ("PropertyId", "Id") ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260826035254_PhysicalRoomScheduleAvailabilityAuthority') THEN
    CREATE TABLE "RoomOccupancySegmentAudits" (
        "Id" uuid NOT NULL,
        "PropertyId" uuid NOT NULL,
        "SegmentId" uuid NOT NULL,
        "MutationGroupId" uuid NOT NULL,
        "EventType" character varying(20) NOT NULL,
        "ActorReference" character varying(200) NOT NULL,
        "AuthorizationEvidence" character varying(500),
        "Reason" character varying(500),
        "OccurredAtUtc" timestamp with time zone NOT NULL,
        CONSTRAINT "PK_RoomOccupancySegmentAudits" PRIMARY KEY ("Id"),
        CONSTRAINT "AK_RoomOccupancySegmentAudits_PropertyId_Id" UNIQUE ("PropertyId", "Id"),
        CONSTRAINT "CK_RoomOccupancySegmentAudits_ActorReference" CHECK (btrim("ActorReference") <> ''),
        CONSTRAINT "CK_RoomOccupancySegmentAudits_EventType" CHECK ("EventType" IN ('Created', 'Cancelled')),
        CONSTRAINT "CK_RoomOccupancySegmentAudits_Ids" CHECK ("Id" <> '00000000-0000-0000-0000-000000000000'::uuid AND "PropertyId" <> '00000000-0000-0000-0000-000000000000'::uuid AND "SegmentId" <> '00000000-0000-0000-0000-000000000000'::uuid AND "MutationGroupId" <> '00000000-0000-0000-0000-000000000000'::uuid),
        CONSTRAINT "FK_RoomOccupancySegmentAudits_RoomOccupancySegments_PropertyId~" FOREIGN KEY ("PropertyId", "SegmentId") REFERENCES "RoomOccupancySegments" ("PropertyId", "Id") ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260826035254_PhysicalRoomScheduleAvailabilityAuthority') THEN
    CREATE INDEX "IX_RoomBlocks_PropertyId_CreatedAtUtc" ON "RoomBlocks" ("PropertyId", "CreatedAtUtc");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260826035254_PhysicalRoomScheduleAvailabilityAuthority') THEN
    CREATE INDEX "IX_RoomOccupancySegmentAudits_MutationGroupId" ON "RoomOccupancySegmentAudits" ("MutationGroupId");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260826035254_PhysicalRoomScheduleAvailabilityAuthority') THEN
    CREATE INDEX "IX_RoomOccupancySegmentAudits_PropertyId_OccurredAtUtc" ON "RoomOccupancySegmentAudits" ("PropertyId", "OccurredAtUtc");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260826035254_PhysicalRoomScheduleAvailabilityAuthority') THEN
    CREATE INDEX "IX_RoomOccupancySegmentAudits_PropertyId_SegmentId" ON "RoomOccupancySegmentAudits" ("PropertyId", "SegmentId");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260826035254_PhysicalRoomScheduleAvailabilityAuthority') THEN
    CREATE INDEX "IX_RoomOccupancySegmentAudits_SegmentId" ON "RoomOccupancySegmentAudits" ("SegmentId");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260826035254_PhysicalRoomScheduleAvailabilityAuthority') THEN
    CREATE INDEX "IX_RoomOccupancySegments_PropertyId_PhysicalRoomId_Status" ON "RoomOccupancySegments" ("PropertyId", "PhysicalRoomId", "Status");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260826035254_PhysicalRoomScheduleAvailabilityAuthority') THEN
    CREATE INDEX "IX_RoomOccupancySegments_PropertyId_ReservationUnitId_Status" ON "RoomOccupancySegments" ("PropertyId", "ReservationUnitId", "Status");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260826035254_PhysicalRoomScheduleAvailabilityAuthority') THEN
    CREATE INDEX "IX_RoomOccupancySegments_PropertyId_RoomBlockId_Status" ON "RoomOccupancySegments" ("PropertyId", "RoomBlockId", "Status");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260826035254_PhysicalRoomScheduleAvailabilityAuthority') THEN
    CREATE INDEX "IX_RoomOccupancySegments_PropertyId_Type_Status" ON "RoomOccupancySegments" ("PropertyId", "Type", "Status");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260826035254_PhysicalRoomScheduleAvailabilityAuthority') THEN
    CREATE EXTENSION IF NOT EXISTS btree_gist;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260826035254_PhysicalRoomScheduleAvailabilityAuthority') THEN
    ALTER TABLE "RoomOccupancySegments"
        ADD CONSTRAINT "EX_RoomOccupancySegments_EffectiveRoomOverlap"
        EXCLUDE USING gist (
            "PropertyId" WITH =,
            "PhysicalRoomId" WITH =,
            daterange("StartDate", "EndDate", '[)') WITH &&
        )
        WHERE ("Status" = 'Effective')
        DEFERRABLE INITIALLY DEFERRED;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260826035254_PhysicalRoomScheduleAvailabilityAuthority') THEN
    ALTER TABLE "RoomOccupancySegments"
        ADD CONSTRAINT "EX_RoomOccupancySegments_EffectiveUnitOverlap"
        EXCLUDE USING gist (
            "PropertyId" WITH =,
            "ReservationUnitId" WITH =,
            daterange("StartDate", "EndDate", '[)') WITH &&
        )
        WHERE ("Status" = 'Effective' AND "Type" = 'ReservationAssignment')
        DEFERRABLE INITIALLY DEFERRED;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260826035254_PhysicalRoomScheduleAvailabilityAuthority') THEN
    CREATE FUNCTION thebha_check_booked_night_coverage() RETURNS trigger AS $$
    DECLARE
        affected_unit_id uuid;
        bad_date date;
    BEGIN
        IF TG_TABLE_NAME = 'RoomOccupancySegments' THEN
            affected_unit_id := COALESCE(NEW."ReservationUnitId", OLD."ReservationUnitId");
        ELSIF TG_TABLE_NAME = 'ReservationUnitNights' THEN
            -- ReservationUnitNight.ReservationUnitId is immutable commercial
            -- evidence (it participates in the row's primary key together with
            -- StayDate): no approved operation transfers a booked night between
            -- ReservationUnits. Reject the transfer outright rather than
            -- re-validating coverage for only one of the two affected Units.
            IF TG_OP = 'UPDATE' AND OLD."ReservationUnitId" IS DISTINCT FROM NEW."ReservationUnitId" THEN
                RAISE EXCEPTION
                    'thebha_booked_night_coverage_violation: ReservationUnitNight (%, %) cannot change ReservationUnitId from % to % — ownership is immutable',
                    OLD."ReservationUnitId", OLD."StayDate", OLD."ReservationUnitId", NEW."ReservationUnitId"
                    USING ERRCODE = 'XBHA1';
            END IF;
            affected_unit_id := COALESCE(NEW."ReservationUnitId", OLD."ReservationUnitId");
        END IF;

        IF affected_unit_id IS NULL THEN
            RETURN NULL;
        END IF;

        SELECT d::date INTO bad_date
        FROM "RoomOccupancySegments" s
        CROSS JOIN LATERAL generate_series(
            s."StartDate"::timestamp,
            (s."EndDate" - 1)::timestamp,
            interval '1 day'
        ) AS d
        WHERE s."ReservationUnitId" = affected_unit_id
            AND s."Type" = 'ReservationAssignment'
            AND s."Status" = 'Effective'
            AND NOT EXISTS (
                SELECT 1 FROM "ReservationUnitNights" n
                WHERE n."ReservationUnitId" = affected_unit_id
                    AND n."StayDate" = d::date
            )
        LIMIT 1;

        IF bad_date IS NOT NULL THEN
            RAISE EXCEPTION
                'thebha_booked_night_coverage_violation: ReservationUnit % has an Effective assignment segment covering % with no ReservationUnitNight row',
                affected_unit_id, bad_date
                USING ERRCODE = 'XBHA1';
        END IF;

        RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260826035254_PhysicalRoomScheduleAvailabilityAuthority') THEN
    CREATE CONSTRAINT TRIGGER trg_room_occupancy_segments_booked_night_coverage
        AFTER INSERT OR UPDATE ON "RoomOccupancySegments"
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW
        EXECUTE FUNCTION thebha_check_booked_night_coverage();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260826035254_PhysicalRoomScheduleAvailabilityAuthority') THEN
    CREATE CONSTRAINT TRIGGER trg_reservation_unit_nights_booked_night_coverage
        AFTER INSERT OR UPDATE OR DELETE ON "ReservationUnitNights"
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW
        EXECUTE FUNCTION thebha_check_booked_night_coverage();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260826035254_PhysicalRoomScheduleAvailabilityAuthority') THEN
    CREATE FUNCTION thebha_check_unit_commitment_consistency() RETURNS trigger AS $$
    DECLARE
        affected_unit_id uuid;
        affected_reservation_id uuid;
        violating_segment_id uuid;
        violating_unit_id uuid;
    BEGIN
        IF TG_TABLE_NAME = 'RoomOccupancySegments' THEN
            affected_unit_id := COALESCE(NEW."ReservationUnitId", OLD."ReservationUnitId");
            IF affected_unit_id IS NOT NULL THEN
                SELECT "ReservationId" INTO affected_reservation_id
                FROM "ReservationUnits" WHERE "Id" = affected_unit_id;
            END IF;
        ELSIF TG_TABLE_NAME = 'ReservationUnits' THEN
            affected_unit_id := COALESCE(NEW."Id", OLD."Id");
            affected_reservation_id := COALESCE(NEW."ReservationId", OLD."ReservationId");
        ELSIF TG_TABLE_NAME = 'Reservations' THEN
            affected_reservation_id := COALESCE(NEW."Id", OLD."Id");
        END IF;

        IF affected_unit_id IS NOT NULL THEN
            SELECT s."Id" INTO violating_segment_id
            FROM "RoomOccupancySegments" s
            JOIN "ReservationUnits" u ON u."Id" = s."ReservationUnitId"
            WHERE s."ReservationUnitId" = affected_unit_id
                AND s."Type" = 'ReservationAssignment'
                AND s."Status" = 'Effective'
                AND u."CommitmentStatus" <> 'Committed'
            LIMIT 1;

            IF violating_segment_id IS NOT NULL THEN
                RAISE EXCEPTION
                    'thebha_unit_commitment_consistency_violation: RoomOccupancySegment % is Effective but references a non-Committed ReservationUnit %',
                    violating_segment_id, affected_unit_id
                    USING ERRCODE = 'XBHA2';
            END IF;
        END IF;

        IF affected_reservation_id IS NOT NULL THEN
            SELECT u."Id" INTO violating_unit_id
            FROM "ReservationUnits" u
            JOIN "Reservations" r ON r."Id" = u."ReservationId"
            WHERE u."ReservationId" = affected_reservation_id
                AND r."Status" = 'Cancelled'
                AND u."CommitmentStatus" = 'Committed'
            LIMIT 1;

            IF violating_unit_id IS NOT NULL THEN
                RAISE EXCEPTION
                    'thebha_unit_commitment_consistency_violation: Reservation % is Cancelled but ReservationUnit % remains Committed',
                    affected_reservation_id, violating_unit_id
                    USING ERRCODE = 'XBHA2';
            END IF;
        END IF;

        RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260826035254_PhysicalRoomScheduleAvailabilityAuthority') THEN
    CREATE CONSTRAINT TRIGGER trg_room_occupancy_segments_unit_commitment
        AFTER INSERT OR UPDATE ON "RoomOccupancySegments"
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW
        EXECUTE FUNCTION thebha_check_unit_commitment_consistency();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260826035254_PhysicalRoomScheduleAvailabilityAuthority') THEN
    CREATE CONSTRAINT TRIGGER trg_reservation_units_commitment_status
        AFTER UPDATE ON "ReservationUnits"
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW
        WHEN (OLD."CommitmentStatus" IS DISTINCT FROM NEW."CommitmentStatus")
        EXECUTE FUNCTION thebha_check_unit_commitment_consistency();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260826035254_PhysicalRoomScheduleAvailabilityAuthority') THEN
    CREATE CONSTRAINT TRIGGER trg_reservations_status
        AFTER UPDATE ON "Reservations"
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW
        WHEN (OLD."Status" IS DISTINCT FROM NEW."Status")
        EXECUTE FUNCTION thebha_check_unit_commitment_consistency();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260826035254_PhysicalRoomScheduleAvailabilityAuthority') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20260826035254_PhysicalRoomScheduleAvailabilityAuthority', '8.0.29');
    END IF;
END $EF$;
COMMIT;

START TRANSACTION;


DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261001141847_AddStaffIdentityFoundation') THEN
    CREATE TABLE "StaffAccounts" (
        "Id" uuid NOT NULL,
        "IsActive" boolean NOT NULL,
        "CreatedAtUtc" timestamp with time zone NOT NULL,
        "DisabledAtUtc" timestamp with time zone,
        "UserName" character varying(256) NOT NULL,
        "NormalizedUserName" character varying(256) NOT NULL,
        "Email" character varying(256) NOT NULL,
        "NormalizedEmail" character varying(256) NOT NULL,
        "EmailConfirmed" boolean NOT NULL,
        "PasswordHash" text,
        "SecurityStamp" text,
        "ConcurrencyStamp" text,
        "PhoneNumber" text,
        "PhoneNumberConfirmed" boolean NOT NULL,
        "TwoFactorEnabled" boolean NOT NULL,
        "LockoutEnd" timestamp with time zone,
        "LockoutEnabled" boolean NOT NULL,
        "AccessFailedCount" integer NOT NULL,
        CONSTRAINT "PK_StaffAccounts" PRIMARY KEY ("Id"),
        CONSTRAINT "CK_StaffAccounts_DisabledAtUtc" CHECK (("IsActive" AND "DisabledAtUtc" IS NULL) OR (NOT "IsActive" AND "DisabledAtUtc" IS NOT NULL))
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261001141847_AddStaffIdentityFoundation') THEN
    CREATE TABLE "StaffPropertyMemberships" (
        "StaffAccountId" uuid NOT NULL,
        "PropertyId" uuid NOT NULL,
        "Role" character varying(32) NOT NULL,
        "CreatedAtUtc" timestamp with time zone NOT NULL,
        CONSTRAINT "PK_StaffPropertyMemberships" PRIMARY KEY ("StaffAccountId", "PropertyId"),
        CONSTRAINT "CK_StaffPropertyMemberships_Role" CHECK ("Role" IN ('FrontDesk', 'Manager')),
        CONSTRAINT "FK_StaffPropertyMemberships_Properties_PropertyId" FOREIGN KEY ("PropertyId") REFERENCES "Properties" ("Id") ON DELETE RESTRICT,
        CONSTRAINT "FK_StaffPropertyMemberships_StaffAccounts_StaffAccountId" FOREIGN KEY ("StaffAccountId") REFERENCES "StaffAccounts" ("Id") ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261001141847_AddStaffIdentityFoundation') THEN
    CREATE UNIQUE INDEX "UX_StaffAccounts_NormalizedEmail" ON "StaffAccounts" ("NormalizedEmail");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261001141847_AddStaffIdentityFoundation') THEN
    CREATE UNIQUE INDEX "UX_StaffAccounts_NormalizedUserName" ON "StaffAccounts" ("NormalizedUserName");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261001141847_AddStaffIdentityFoundation') THEN
    CREATE INDEX "IX_StaffPropertyMemberships_PropertyId" ON "StaffPropertyMemberships" ("PropertyId");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261001141847_AddStaffIdentityFoundation') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261001141847_AddStaffIdentityFoundation', '8.0.29');
    END IF;
END $EF$;
COMMIT;
