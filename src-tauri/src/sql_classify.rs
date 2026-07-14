//! SQL statement classification for role-based access control.
//!
//! Uses `sqlparser` to parse SQL into a typed AST, then classifies each
//! statement. The classification determines the minimum [`crate::auth::Role`]
//! required to execute the statement:
//!
//! | Class         | Min role | Examples                          |
//! |---------------|----------|-----------------------------------|
//! | `Read`        | Viewer   | `SELECT`                          |
//! | `Dml`         | Editor   | `INSERT`, `UPDATE`, `DELETE`      |
//! | `Ddl`         | Editor   | `CREATE TABLE`, `ALTER INDEX`     |
//! | `Destructive` | Admin    | `DROP`, `TRUNCATE`                |
//! | `Unknown`     | Admin    | parse failure, `CALL`, `GRANT`    |

use sqlparser::ast::Statement;
use sqlparser::dialect::GenericDialect;
use sqlparser::parser::Parser;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum SqlClass {
    Read,
    Dml,
    Ddl,
    Destructive,
    Unknown,
}

/// Classify a SQL string by parsing it and returning the highest
/// (most privileged) classification across all statements.
pub fn classify_sql(sql: &str) -> SqlClass {
    let dialect = GenericDialect {};
    let statements = match Parser::parse_sql(&dialect, sql) {
        Ok(stmts) if !stmts.is_empty() => stmts,
        _ => return SqlClass::Unknown,
    };

    statements
        .iter()
        .map(classify_statement)
        .max()
        .unwrap_or(SqlClass::Unknown)
}

fn classify_statement(stmt: &Statement) -> SqlClass {
    match stmt {
        // ── Read ──────────────────────────────────────────────────────────
        Statement::Query(_) => SqlClass::Read,

        // ── DML ───────────────────────────────────────────────────────────
        Statement::Insert(_)
        | Statement::Update { .. }
        | Statement::Delete(_)
        | Statement::Merge { .. }
        | Statement::Copy { .. } => SqlClass::Dml,

        // ── Non-destructive DDL (editor can create / alter) ──────────────
        Statement::CreateTable(_)
        | Statement::CreateIndex(_)
        | Statement::CreateView { .. }
        | Statement::CreateSchema { .. }
        | Statement::CreateDatabase { .. }
        | Statement::CreateSequence { .. }
        | Statement::CreateVirtualTable { .. }
        | Statement::CreateMacro { .. }
        | Statement::AlterTable { .. }
        | Statement::AlterIndex { .. }
        | Statement::AlterView { .. }
        | Statement::Comment { .. } => SqlClass::Ddl,

        // ── Destructive DDL (admin only) ─────────────────────────────────
        Statement::Drop { .. }
        | Statement::DropFunction { .. }
        | Statement::DropProcedure { .. }
        | Statement::DropExtension { .. }
        | Statement::DropTrigger { .. }
        | Statement::DropPolicy { .. }
        | Statement::DropSecret { .. }
        | Statement::Truncate { .. }
        | Statement::Discard { .. } => SqlClass::Destructive,

        // ── Recurse into wrapper statements ──────────────────────────────
        Statement::Explain { statement, .. } => classify_statement(statement),
        Statement::Prepare { statement, .. } => classify_statement(statement),

        // ── Everything else: Unknown (restrictive) ───────────────────────
        // Covers: CALL, EXECUTE, GRANT, REVOKE, CREATE ROLE/FUNCTION/TRIGGER,
        // ATTACH, DETACH (non-DuckDB), SET, LOCK, etc.
        _ => SqlClass::Unknown,
    }
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_select() {
        assert_eq!(classify_sql("SELECT 1"), SqlClass::Read);
        assert_eq!(classify_sql("SELECT * FROM users WHERE id = $1"), SqlClass::Read);
        assert_eq!(
            classify_sql("WITH cte AS (SELECT 1) SELECT * FROM cte"),
            SqlClass::Read
        );
    }

    #[test]
    fn test_insert_update_delete() {
        assert_eq!(classify_sql("INSERT INTO t VALUES (1)"), SqlClass::Dml);
        assert_eq!(classify_sql("UPDATE t SET x = 1"), SqlClass::Dml);
        assert_eq!(classify_sql("DELETE FROM t WHERE x = 1"), SqlClass::Dml);
    }

    #[test]
    fn test_merge() {
        assert_eq!(
            classify_sql("MERGE INTO target USING src ON target.id = src.id WHEN MATCHED THEN UPDATE SET val = src.val"),
            SqlClass::Dml
        );
    }

    #[test]
    fn test_create() {
        assert_eq!(
            classify_sql("CREATE TABLE t (id INTEGER)"),
            SqlClass::Ddl
        );
        assert_eq!(
            classify_sql("CREATE INDEX idx ON t (col)"),
            SqlClass::Ddl
        );
        assert_eq!(
            classify_sql("CREATE VIEW v AS SELECT 1"),
            SqlClass::Ddl
        );
        assert_eq!(
            classify_sql("CREATE SCHEMA s"),
            SqlClass::Ddl
        );
    }

    #[test]
    fn test_alter() {
        assert_eq!(
            classify_sql("ALTER TABLE t ADD COLUMN x INTEGER"),
            SqlClass::Ddl
        );
        assert_eq!(
            classify_sql("ALTER INDEX idx RENAME TO idx2"),
            SqlClass::Ddl
        );
    }

    #[test]
    fn test_drop() {
        assert_eq!(classify_sql("DROP TABLE t"), SqlClass::Destructive);
        assert_eq!(classify_sql("DROP TABLE IF EXISTS t CASCADE"), SqlClass::Destructive);
        assert_eq!(classify_sql("DROP INDEX idx"), SqlClass::Destructive);
        assert_eq!(classify_sql("DROP VIEW v"), SqlClass::Destructive);
        assert_eq!(classify_sql("DROP SCHEMA s"), SqlClass::Destructive);
    }

    #[test]
    fn test_truncate() {
        assert_eq!(classify_sql("TRUNCATE TABLE t"), SqlClass::Destructive);
        assert_eq!(
            classify_sql("TRUNCATE TABLE t RESTART IDENTITY CASCADE"),
            SqlClass::Destructive
        );
    }

    #[test]
    fn test_multi_statement_takes_max() {
        assert_eq!(
            classify_sql("SELECT 1; DROP TABLE t"),
            SqlClass::Destructive
        );
        assert_eq!(
            classify_sql("INSERT INTO t VALUES (1); SELECT 1"),
            SqlClass::Dml
        );
    }

    #[test]
    fn test_explain_recurse() {
        assert_eq!(
            classify_sql("EXPLAIN DELETE FROM t"),
            SqlClass::Dml
        );
        assert_eq!(
            classify_sql("EXPLAIN ANALYZE SELECT * FROM t"),
            SqlClass::Read
        );
    }

    #[test]
    fn test_prepare_recurse() {
        assert_eq!(
            classify_sql("PREPARE p AS DROP TABLE t"),
            SqlClass::Destructive
        );
    }

    #[test]
    fn test_unknown_statements() {
        assert_eq!(classify_sql("CALL my_proc()"), SqlClass::Unknown);
        assert_eq!(
            classify_sql("GRANT SELECT ON t TO user"),
            SqlClass::Unknown
        );
        assert_eq!(classify_sql("VACUUM"), SqlClass::Unknown);
    }

    #[test]
    fn test_parse_failure() {
        assert_eq!(classify_sql("this is not sql"), SqlClass::Unknown);
        assert_eq!(classify_sql(""), SqlClass::Unknown);
    }

    #[test]
    fn test_comment_does_not_bypass() {
        // Comments before keyword should still parse correctly
        assert_eq!(
            classify_sql("/* harmless */ DROP TABLE t"),
            SqlClass::Destructive
        );
    }
}
