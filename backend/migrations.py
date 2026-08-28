"""Ordered, tracked schema changes for spoton.db.

Each entry in MIGRATIONS is (version, name, fn). `fn` receives an open
connection and makes its changes but never commits, rolls back, or closes it
- the runner in database.py wraps each migration in its own transaction and
records it in `schema_migrations` only once it commits cleanly, so a database
can never end up marked as migrated while its schema is actually still old.

Every migration must be safe to re-run against a database that already has
its changes. Migration 1 is a guarantee of that: it is today's `init_db` body,
verbatim, which was already re-run unconditionally on every single startup
for as long as this app has existed.

To add a schema change, append a new (version, name, fn) tuple with the next
version number. Never edit or renumber an existing entry once it has shipped
- a database that already recorded that version must not see it change shape.
"""

import sqlite3
from typing import Callable

Migration = Callable[[sqlite3.Connection], None]


def _column_exists(conn: sqlite3.Connection, table: str, col: str) -> bool:
    rows = conn.execute(f'PRAGMA table_info({table})').fetchall()
    return any(r[1] == col for r in rows)


def _migration_001_baseline(conn: sqlite3.Connection) -> None:
    # Plain execute() calls, not executescript(): executescript() implicitly
    # commits any open transaction before it runs, which would silently end
    # the transaction the runner started and break atomic rollback on error.
    conn.execute("""
        CREATE TABLE IF NOT EXISTS workflows (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL DEFAULT 'Untitled Workflow',
            data       TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS collection (
            id          TEXT PRIMARY KEY,
            workflow_id TEXT,
            filename    TEXT NOT NULL,
            width       INTEGER,
            height      INTEGER,
            created_at  TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS user_secrets (
            uid TEXT PRIMARY KEY,
            fal_api_key TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS collection_folders (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            owner_uid  TEXT,
            created_at TEXT NOT NULL
        )
    """)
    if not _column_exists(conn, 'workflows', 'owner_uid'):
        conn.execute('ALTER TABLE workflows ADD COLUMN owner_uid TEXT')
    if not _column_exists(conn, 'collection', 'owner_uid'):
        conn.execute('ALTER TABLE collection ADD COLUMN owner_uid TEXT')
    if not _column_exists(conn, 'workflows', 'icon_id'):
        conn.execute('ALTER TABLE workflows ADD COLUMN icon_id TEXT')
    if not _column_exists(conn, 'workflows', 'description'):
        conn.execute('ALTER TABLE workflows ADD COLUMN description TEXT')
    if not _column_exists(conn, 'workflows', 'icon_color'):
        conn.execute('ALTER TABLE workflows ADD COLUMN icon_color TEXT')
    if not _column_exists(conn, 'workflows', 'has_template'):
        conn.execute('ALTER TABLE workflows ADD COLUMN has_template INTEGER NOT NULL DEFAULT 0')
    if not _column_exists(conn, 'collection', 'folder_id'):
        conn.execute('ALTER TABLE collection ADD COLUMN folder_id TEXT')
    if not _column_exists(conn, 'user_secrets', 'fal_api_key'):
        conn.execute('ALTER TABLE user_secrets ADD COLUMN fal_api_key TEXT')
    # fal.ai is the only provider now, so the other keys are dead weight — and a
    # credential we have no reason to keep sitting on disk.
    for dead_key in ('gemini_api_key', 'openai_api_key'):
        if _column_exists(conn, 'user_secrets', dead_key):
            conn.execute(f'ALTER TABLE user_secrets DROP COLUMN {dead_key}')
    conn.execute("DELETE FROM user_secrets WHERE IFNULL(TRIM(fal_api_key), '') = ''")
    if not _column_exists(conn, 'collection', 'prompt'):
        conn.execute('ALTER TABLE collection ADD COLUMN prompt TEXT')
    if not _column_exists(conn, 'collection', 'seed'):
        conn.execute('ALTER TABLE collection ADD COLUMN seed INTEGER')
    if not _column_exists(conn, 'collection', 'model'):
        conn.execute('ALTER TABLE collection ADD COLUMN model TEXT')


def _migration_002_app_meta(conn: sqlite3.Connection) -> None:
    """Tracks small bits of app-level state across runs - currently just the
    last app version that started successfully against this database. See
    database.py::backup_database, which reads it to decide when to snapshot
    the database before migrating.
    """
    conn.execute("""
        CREATE TABLE IF NOT EXISTS app_meta (
            key   TEXT PRIMARY KEY,
            value TEXT
        )
    """)


def _migration_003_collection_meshes(conn: sqlite3.Connection) -> None:
    """Lets the collection hold generated GLBs beside generated images.

    `kind` is 'image' for every existing row and 'model3d' for a mesh, whose
    `filename` is the GLB itself. A mesh has no pixels of its own, so its tile
    is drawn from `thumb_filename` — the render the generator returned, i.e.
    the same picture the node shows on the canvas.
    """
    if not _column_exists(conn, 'collection', 'kind'):
        conn.execute(
            "ALTER TABLE collection ADD COLUMN kind TEXT NOT NULL DEFAULT 'image'"
        )
    if not _column_exists(conn, 'collection', 'thumb_filename'):
        conn.execute('ALTER TABLE collection ADD COLUMN thumb_filename TEXT')


MIGRATIONS: list[tuple[int, str, Migration]] = [
    (1, 'baseline', _migration_001_baseline),
    (2, 'app_meta', _migration_002_app_meta),
    (3, 'collection_meshes', _migration_003_collection_meshes),
]
