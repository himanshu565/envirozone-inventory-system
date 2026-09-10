-- Renames the Role enum value STAFF to ACCOUNTS in place.
--
-- Prisma's default diff (add ACCOUNTS, drop STAFF) is not safe here: existing
-- rows already use STAFF, and PostgreSQL has no DROP VALUE for enums, so that
-- migration would fail against live data. ALTER TYPE ... RENAME VALUE relabels
-- the existing enum value by its internal OID, so rows and the column default
-- referencing it are updated automatically with no data loss.
ALTER TYPE "Role" RENAME VALUE 'STAFF' TO 'ACCOUNTS';
