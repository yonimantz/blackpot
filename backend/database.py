import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone

from migrations import MIGRATIONS
from paths import BACKUP_DIR, COLLECTION_DIR, DB_PATH
from version import __version__ as APP_VERSION

# Keep this many database backups (see backup_database) and prune older ones.
MAX_DB_BACKUPS = 3

# When API auth is off, persistence uses this sentinel for unrestricted access.
LEGACY_OWNER_SENTINEL = '*'

DEFAULT_WORKFLOW_ICON_ID = 'wf1'

# Allowed workflow icon tints (hex). Must stay in sync with frontend WORKFLOW_ICON_PALETTE.
_ALLOWED_WORKFLOW_ICON_COLORS = frozenset({
    '#ffffff',
    '#c4b5fd',
    '#6ee7b7',
    '#fcd34d',
    '#f9a8d4',
    '#7dd3fc',
    '#fca5a5',
    '#e5e7eb',
})

# Sentinel: update_workflow(..., icon_color=ICON_COLOR_UNSET) means "do not change stored color"
ICON_COLOR_UNSET = object()


def normalize_workflow_icon_color(raw: str | None) -> str | None:
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    if s not in _ALLOWED_WORKFLOW_ICON_COLORS:
        return None
    return s


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA foreign_keys=ON')
    return conn


def _ensure_schema_migrations_table(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version    INTEGER PRIMARY KEY,
            name       TEXT NOT NULL,
            applied_at TEXT NOT NULL
        )
    """)


def applied_migration_versions(conn: sqlite3.Connection) -> set[int]:
    _ensure_schema_migrations_table(conn)
    rows = conn.execute('SELECT version FROM schema_migrations').fetchall()
    return {row[0] for row in rows}


def pending_migrations(conn: sqlite3.Connection) -> list[tuple[int, str, object]]:
    applied = applied_migration_versions(conn)
    return [m for m in MIGRATIONS if m[0] not in applied]


def run_migrations(conn: sqlite3.Connection) -> list[int]:
    """Apply every migration not yet recorded, in order.

    Each migration runs in its own transaction and is recorded in
    schema_migrations only once that transaction commits, so a failure
    partway through a migration never leaves it marked as applied.
    """
    applied_now = []
    for version, name, fn in pending_migrations(conn):
        conn.execute('BEGIN')
        try:
            fn(conn)
            conn.execute(
                'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
                (version, name, datetime.now(timezone.utc).isoformat()),
            )
        except Exception:
            conn.execute('ROLLBACK')
            raise
        else:
            conn.execute('COMMIT')
        applied_now.append(version)
    return applied_now


def _get_app_meta(conn: sqlite3.Connection, key: str) -> str | None:
    # app_meta itself ships as migration 2 (see migrations.py), so a database
    # upgrading from before this existed may not have the table yet. This
    # bootstrap create is idempotent and does not race with that migration -
    # both are CREATE TABLE IF NOT EXISTS.
    conn.execute('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT)')
    row = conn.execute('SELECT value FROM app_meta WHERE key = ?', (key,)).fetchone()
    return row[0] if row else None


def _set_app_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        'INSERT INTO app_meta (key, value) VALUES (?, ?) '
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        (key, value),
    )


def _prune_old_backups(keep: int = MAX_DB_BACKUPS) -> None:
    try:
        names = sorted(
            f for f in os.listdir(BACKUP_DIR) if f.startswith('spoton-') and f.endswith('.db')
        )
    except OSError:
        return
    # Sortable timestamp suffix means lexical order is chronological order.
    for stale in names[:-keep] if keep > 0 else names:
        try:
            os.remove(os.path.join(BACKUP_DIR, stale))
        except OSError:
            pass


def backup_database(from_version: str) -> str | None:
    """Snapshot spoton.db before a risky change, via SQLite's own backup API
    rather than a plain file copy - a file copy can miss data that is still
    sitting in the -wal file under WAL mode, which this database always
    runs in. Returns the backup path, or None if there is no real database
    yet to protect (a brand-new, still-empty install).
    """
    if not os.path.exists(DB_PATH) or os.path.getsize(DB_PATH) == 0:
        return None
    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    safe_version = ''.join(c if c.isalnum() or c in '.-' else '_' for c in from_version)
    dest_path = os.path.join(BACKUP_DIR, f'spoton-{safe_version}-{stamp}.db')
    src = sqlite3.connect(DB_PATH)
    try:
        dest = sqlite3.connect(dest_path)
        try:
            src.backup(dest)
        finally:
            dest.close()
    finally:
        src.close()
    _prune_old_backups()
    return dest_path


def init_db():
    conn = _get_conn()
    # Manual BEGIN/COMMIT below needs autocommit off; sqlite3's own implicit
    # transaction handling does not wrap DDL the way this runner needs.
    conn.isolation_level = None
    try:
        stored_version = _get_app_meta(conn, 'app_version')
        if stored_version != APP_VERSION or pending_migrations(conn):
            backup_database(stored_version or 'unknown')
        run_migrations(conn)
        _set_app_meta(conn, 'app_version', APP_VERSION)
    finally:
        conn.close()


def vacuum_if_bloated(min_free_pages: int = 256) -> bool:
    """Reclaim disk space left behind when large inline image blobs are removed
    from `workflows.data` (e.g. by the client-side image-externalization
    migration). VACUUM rewrites the DB file without the freed pages.

    Only runs when the free-page list is large enough to be worth it, so it
    stays cheap on a healthy DB and isn't paid on every startup. Uses an
    autocommit connection because VACUUM cannot run inside a transaction.
    """
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.isolation_level = None
        row = conn.execute('PRAGMA freelist_count').fetchone()
        free = row[0] if row else 0
        if free and free >= min_free_pages:
            conn.execute('VACUUM')
            return True
        return False
    finally:
        conn.close()


def sweep_orphaned_uploads(upload_dir: str, prefix: str) -> int:
    """Delete prefixed upload files that no saved workflow references any more.

    Preview assets are named after the workflow and node that own them, so
    deleting a node or a whole workflow leaves its file behind with nothing to
    clean it up. Only files carrying `prefix` are considered, which keeps
    imported images — whose ids are plain uuids — permanently out of scope.

    Startup-only: it assumes no workflow is mid-edit with an uploaded preview
    that hasn't been autosaved yet.
    """
    if not os.path.isdir(upload_dir):
        return 0
    try:
        names = [n for n in os.listdir(upload_dir) if n.startswith(prefix)]
    except OSError:
        return 0
    if not names:
        return 0

    conn = _get_conn()
    try:
        graphs = [row[0] or '' for row in conn.execute('SELECT data FROM workflows')]
    finally:
        conn.close()

    removed = 0
    for name in names:
        stem = name.split('.', 1)[0]
        if any(stem in graph for graph in graphs):
            continue
        try:
            os.remove(os.path.join(upload_dir, name))
            removed += 1
        except OSError:
            pass
    return removed


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _workflow_row_summary(r: sqlite3.Row) -> dict:
    d = dict(r)
    d['icon_id'] = d.get('icon_id') or DEFAULT_WORKFLOW_ICON_ID
    d['description'] = d.get('description') or ''
    ic = d.get('icon_color')
    d['icon_color'] = ic if ic else None
    d['has_template'] = bool(d.get('has_template'))
    return d


_WORKFLOW_SUMMARY_COLUMNS = (
    'id, name, icon_id, icon_color, description, has_template, updated_at, created_at'
)


def _has_template(data: dict | None) -> int:
    """A workflow is a template when its graph carries a `template` object."""
    if not isinstance(data, dict):
        return 0
    return 1 if isinstance(data.get('template'), dict) else 0


def _legacy_list_workflows() -> list[dict]:
    conn = _get_conn()
    rows = conn.execute(
        f'SELECT {_WORKFLOW_SUMMARY_COLUMNS} FROM workflows ORDER BY updated_at DESC'
    ).fetchall()
    conn.close()
    return [_workflow_row_summary(r) for r in rows]


def list_workflows(owner_uid: str) -> list[dict]:
    if owner_uid == LEGACY_OWNER_SENTINEL:
        return _legacy_list_workflows()
    conn = _get_conn()
    rows = conn.execute(
        f'SELECT {_WORKFLOW_SUMMARY_COLUMNS} FROM workflows '
        'WHERE owner_uid = ? ORDER BY updated_at DESC',
        (owner_uid,),
    ).fetchall()
    conn.close()
    return [_workflow_row_summary(r) for r in rows]


def create_workflow(
    name: str = 'Untitled Workflow',
    owner_uid: str | None = None,
    icon_id: str | None = None,
    description: str | None = None,
    icon_color: str | None = None,
) -> dict:
    wf_id = str(uuid.uuid4())
    now = _now_iso()
    empty_data = json.dumps({'nodes': [], 'edges': [], 'groups': []})
    iid = (icon_id or '').strip() or DEFAULT_WORKFLOW_ICON_ID
    desc = description if description is not None else ''
    icol = normalize_workflow_icon_color(icon_color)
    conn = _get_conn()
    conn.execute(
        'INSERT INTO workflows (id, name, data, created_at, updated_at, owner_uid, icon_id, icon_color, description) '
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        (wf_id, name, empty_data, now, now, owner_uid, iid, icol, desc),
    )
    conn.commit()
    conn.close()
    return {
        'id': wf_id,
        'name': name,
        'data': json.loads(empty_data),
        'icon_id': iid,
        'icon_color': icol,
        'description': desc,
        'has_template': False,
        'created_at': now,
        'updated_at': now,
    }


def _row_owner_ok(row_owner: str | None, expected: str) -> bool:
    if expected == LEGACY_OWNER_SENTINEL:
        return True
    return (row_owner or '') == expected


def get_workflow(wf_id: str, owner_uid: str = LEGACY_OWNER_SENTINEL) -> dict | None:
    conn = _get_conn()
    row = conn.execute('SELECT * FROM workflows WHERE id = ?', (wf_id,)).fetchone()
    conn.close()
    if not row:
        return None
    d = dict(row)
    if not _row_owner_ok(d.get('owner_uid'), owner_uid):
        return None
    d['data'] = json.loads(d['data'])
    d['icon_id'] = d.get('icon_id') or DEFAULT_WORKFLOW_ICON_ID
    d['description'] = d.get('description') or ''
    ic = d.get('icon_color')
    d['icon_color'] = ic if ic else None
    d['has_template'] = bool(d.get('has_template'))
    return d


def update_workflow(
    wf_id: str,
    owner_uid: str = LEGACY_OWNER_SENTINEL,
    name: str | None = None,
    data: dict | None = None,
    icon_id: str | None = None,
    description: str | None = None,
    icon_color: str | None | object = ICON_COLOR_UNSET,
) -> dict | None:
    conn = _get_conn()
    existing = conn.execute('SELECT * FROM workflows WHERE id = ?', (wf_id,)).fetchone()
    if not existing:
        conn.close()
        return None
    ex = dict(existing)
    if not _row_owner_ok(ex.get('owner_uid'), owner_uid):
        conn.close()
        return None

    now = _now_iso()
    new_name = name if name is not None else ex['name']
    new_data = json.dumps(data) if data is not None else ex['data']
    new_has_template = (
        _has_template(data) if data is not None else int(bool(ex.get('has_template')))
    )
    cur_icon = ex.get('icon_id') or DEFAULT_WORKFLOW_ICON_ID
    new_icon_id = cur_icon if icon_id is None else ((icon_id or '').strip() or DEFAULT_WORKFLOW_ICON_ID)
    cur_desc = ex.get('description')
    if cur_desc is None:
        cur_desc = ''
    new_description = cur_desc if description is None else description
    stored_ic = ex.get('icon_color')
    if icon_color is ICON_COLOR_UNSET:
        new_icon_color = stored_ic if stored_ic else None
    else:
        new_icon_color = normalize_workflow_icon_color(icon_color)  # type: ignore[arg-type]

    conn.execute(
        'UPDATE workflows SET name = ?, data = ?, icon_id = ?, icon_color = ?, description = ?, '
        'has_template = ?, updated_at = ? WHERE id = ?',
        (
            new_name,
            new_data,
            new_icon_id,
            new_icon_color,
            new_description,
            new_has_template,
            now,
            wf_id,
        ),
    )
    conn.commit()
    conn.close()
    return {
        'id': wf_id,
        'name': new_name,
        'icon_id': new_icon_id,
        'icon_color': new_icon_color,
        'description': new_description,
        'has_template': bool(new_has_template),
        'updated_at': now,
    }


def delete_workflow(wf_id: str, owner_uid: str = LEGACY_OWNER_SENTINEL) -> bool:
    conn = _get_conn()
    row = conn.execute('SELECT owner_uid FROM workflows WHERE id = ?', (wf_id,)).fetchone()
    if not row:
        conn.close()
        return False
    if not _row_owner_ok(row['owner_uid'], owner_uid):
        conn.close()
        return False
    cursor = conn.execute('DELETE FROM workflows WHERE id = ?', (wf_id,))
    conn.commit()
    conn.close()
    return cursor.rowcount > 0


def _insert_collection_row(
    item_id: str,
    filename: str,
    kind: str,
    thumb_filename: str | None,
    workflow_id: str | None,
    width: int | None,
    height: int | None,
    owner_uid: str | None,
    prompt: str | None,
    seed: int | None,
    model: str | None,
) -> dict:
    now = _now_iso()
    conn = _get_conn()
    conn.execute(
        'INSERT INTO collection (id, workflow_id, filename, width, height, created_at, owner_uid, folder_id, prompt, seed, model, kind, thumb_filename) '
        'VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)',
        (
            item_id, workflow_id, filename, width, height, now, owner_uid,
            prompt, seed, model, kind, thumb_filename,
        ),
    )
    conn.commit()
    conn.close()
    return {
        'id': item_id,
        'filename': filename,
        'kind': kind,
        'has_thumb': bool(thumb_filename),
        'width': width,
        'height': height,
        'created_at': now,
        'prompt': prompt,
        'seed': seed,
        'model': model,
    }


def add_to_collection(
    image_bytes: bytes,
    ext: str = 'png',
    workflow_id: str | None = None,
    width: int | None = None,
    height: int | None = None,
    owner_uid: str | None = None,
    prompt: str | None = None,
    seed: int | None = None,
    model: str | None = None,
) -> dict:
    img_id = str(uuid.uuid4())
    filename = f'{img_id}.{ext}'
    filepath = os.path.join(COLLECTION_DIR, filename)

    with open(filepath, 'wb') as f:
        f.write(image_bytes)

    return _insert_collection_row(
        img_id, filename, 'image', None, workflow_id, width, height,
        owner_uid, prompt, seed, model,
    )


def add_model_to_collection(
    model_bytes: bytes,
    ext: str = 'glb',
    thumb_bytes: bytes | None = None,
    thumb_ext: str = 'png',
    workflow_id: str | None = None,
    owner_uid: str | None = None,
    prompt: str | None = None,
    seed: int | None = None,
    model: str | None = None,
) -> dict:
    """Store a generated mesh as a collection item.

    The mesh is copied into the collection rather than referenced in
    `MODELS_DIR`, so deleting a collection item can never pull the GLB out from
    under a saved workflow that still renders it.
    """
    item_id = str(uuid.uuid4())
    filename = f'{item_id}.{ext}'
    with open(os.path.join(COLLECTION_DIR, filename), 'wb') as f:
        f.write(model_bytes)

    thumb_filename = None
    if thumb_bytes:
        thumb_filename = f'{item_id}_thumb.{thumb_ext}'
        with open(os.path.join(COLLECTION_DIR, thumb_filename), 'wb') as f:
            f.write(thumb_bytes)

    return _insert_collection_row(
        item_id, filename, 'model3d', thumb_filename, workflow_id, None, None,
        owner_uid, prompt, seed, model,
    )


def _collection_row_public(d: dict) -> dict:
    """Normalize collection row for API."""
    return {
        'id': d['id'],
        'workflow_id': d.get('workflow_id'),
        'filename': d['filename'],
        'kind': d.get('kind') or 'image',
        'has_thumb': bool(d.get('thumb_filename')),
        'width': d.get('width'),
        'height': d.get('height'),
        'created_at': d['created_at'],
        'folder_id': d.get('folder_id'),
        'prompt': d.get('prompt'),
        'seed': d.get('seed'),
        'model': d.get('model'),
    }


_COLLECTION_SELECT = (
    'SELECT id, workflow_id, filename, width, height, created_at, folder_id, '
    'prompt, seed, model, kind, thumb_filename FROM collection '
)


def _legacy_list_collection(in_folder_id: str | None = None) -> list[dict]:
    conn = _get_conn()
    sel = _COLLECTION_SELECT
    if in_folder_id is None:
        rows = conn.execute(sel + 'WHERE folder_id IS NULL ORDER BY created_at DESC').fetchall()
    else:
        rows = conn.execute(
            sel + 'WHERE folder_id = ? ORDER BY created_at DESC', (in_folder_id,)
        ).fetchall()
    conn.close()
    return [_collection_row_public(dict(r)) for r in rows]


def list_collection(
    owner_uid: str = LEGACY_OWNER_SENTINEL,
    in_folder_id: str | None = None,
) -> list[dict]:
    """List collection items. in_folder_id None = unfiled only; else items in that folder."""
    if owner_uid == LEGACY_OWNER_SENTINEL:
        return _legacy_list_collection(in_folder_id)
    conn = _get_conn()
    sel = _COLLECTION_SELECT
    if in_folder_id is None:
        rows = conn.execute(
            sel + 'WHERE owner_uid = ? AND folder_id IS NULL ORDER BY created_at DESC',
            (owner_uid,),
        ).fetchall()
    else:
        rows = conn.execute(
            sel + 'WHERE owner_uid = ? AND folder_id = ? ORDER BY created_at DESC',
            (owner_uid, in_folder_id),
        ).fetchall()
    conn.close()
    return [_collection_row_public(dict(r)) for r in rows]


def get_collection_folder(
    folder_id: str, owner_uid: str = LEGACY_OWNER_SENTINEL
) -> dict | None:
    conn = _get_conn()
    row = conn.execute(
        'SELECT id, name, owner_uid, created_at FROM collection_folders WHERE id = ?',
        (folder_id,),
    ).fetchone()
    conn.close()
    if not row:
        return None
    d = dict(row)
    if not _row_owner_ok(d.get('owner_uid'), owner_uid):
        return None
    return {'id': d['id'], 'name': d['name'], 'created_at': d['created_at']}


def list_collection_folders(owner_uid: str = LEGACY_OWNER_SENTINEL) -> list[dict]:
    conn = _get_conn()
    if owner_uid == LEGACY_OWNER_SENTINEL:
        rows = conn.execute(
            'SELECT id, name, created_at FROM collection_folders WHERE owner_uid IS NULL '
            'ORDER BY created_at ASC'
        ).fetchall()
    else:
        rows = conn.execute(
            'SELECT id, name, created_at FROM collection_folders WHERE owner_uid = ? '
            'ORDER BY created_at ASC',
            (owner_uid,),
        ).fetchall()
    out = []
    for r in rows:
        fid = r['id']
        if owner_uid == LEGACY_OWNER_SENTINEL:
            n = conn.execute(
                'SELECT COUNT(*) AS c FROM collection WHERE folder_id = ?', (fid,)
            ).fetchone()
        else:
            n = conn.execute(
                'SELECT COUNT(*) AS c FROM collection WHERE folder_id = ? AND owner_uid = ?',
                (fid, owner_uid),
            ).fetchone()
        out.append({
            'id': fid,
            'name': r['name'],
            'created_at': r['created_at'],
            'item_count': int(n['c']) if n else 0,
        })
    conn.close()
    return out


def create_collection_folder(
    name: str, owner_uid: str = LEGACY_OWNER_SENTINEL
) -> dict:
    trimmed = (name or '').strip() or 'Untitled folder'
    folder_id = str(uuid.uuid4())
    now = _now_iso()
    ouid = None if owner_uid == LEGACY_OWNER_SENTINEL else owner_uid
    conn = _get_conn()
    conn.execute(
        'INSERT INTO collection_folders (id, name, owner_uid, created_at) VALUES (?, ?, ?, ?)',
        (folder_id, trimmed, ouid, now),
    )
    conn.commit()
    conn.close()
    return {'id': folder_id, 'name': trimmed, 'created_at': now, 'item_count': 0}


def rename_collection_folder(
    folder_id: str, name: str, owner_uid: str = LEGACY_OWNER_SENTINEL
) -> dict | None:
    if not get_collection_folder(folder_id, owner_uid):
        return None
    trimmed = (name or '').strip() or 'Untitled folder'
    conn = _get_conn()
    conn.execute(
        'UPDATE collection_folders SET name = ? WHERE id = ?', (trimmed, folder_id)
    )
    conn.commit()
    conn.close()
    row = get_collection_folder(folder_id, owner_uid)
    if not row:
        return None
    conn = _get_conn()
    if owner_uid == LEGACY_OWNER_SENTINEL:
        n = conn.execute(
            'SELECT COUNT(*) AS c FROM collection WHERE folder_id = ?', (folder_id,)
        ).fetchone()
    else:
        n = conn.execute(
            'SELECT COUNT(*) AS c FROM collection WHERE folder_id = ? AND owner_uid = ?',
            (folder_id, owner_uid),
        ).fetchone()
    conn.close()
    ic = int(n['c']) if n else 0
    return {**row, 'item_count': ic}


def delete_collection_folder_unlink(
    folder_id: str, owner_uid: str = LEGACY_OWNER_SENTINEL
) -> bool:
    if not get_collection_folder(folder_id, owner_uid):
        return False
    conn = _get_conn()
    if owner_uid == LEGACY_OWNER_SENTINEL:
        conn.execute(
            'UPDATE collection SET folder_id = NULL WHERE folder_id = ?', (folder_id,)
        )
    else:
        conn.execute(
            'UPDATE collection SET folder_id = NULL WHERE folder_id = ? AND owner_uid = ?',
            (folder_id, owner_uid),
        )
    conn.execute('DELETE FROM collection_folders WHERE id = ?', (folder_id,))
    conn.commit()
    conn.close()
    return True


def delete_collection_folder_and_items(
    folder_id: str, owner_uid: str = LEGACY_OWNER_SENTINEL
) -> bool:
    if not get_collection_folder(folder_id, owner_uid):
        return False
    conn = _get_conn()
    if owner_uid == LEGACY_OWNER_SENTINEL:
        ids = [
            r['id']
            for r in conn.execute(
                'SELECT id FROM collection WHERE folder_id = ?', (folder_id,)
            ).fetchall()
        ]
    else:
        ids = [
            r['id']
            for r in conn.execute(
                'SELECT id FROM collection WHERE folder_id = ? AND owner_uid = ?',
                (folder_id, owner_uid),
            ).fetchall()
        ]
    conn.close()
    for img_id in ids:
        delete_collection_item(img_id, owner_uid)
    conn = _get_conn()
    conn.execute('DELETE FROM collection_folders WHERE id = ?', (folder_id,))
    conn.commit()
    conn.close()
    return True


def set_collection_items_folder(
    img_ids: list[str],
    folder_id: str | None,
    owner_uid: str = LEGACY_OWNER_SENTINEL,
) -> bool:
    """Move items to folder (None = ALL / unfiled). Returns False if folder invalid when non-null."""
    if folder_id is not None and not get_collection_folder(folder_id, owner_uid):
        return False
    conn = _get_conn()
    try:
        for img_id in img_ids:
            row = conn.execute(
                'SELECT owner_uid FROM collection WHERE id = ?', (img_id,)
            ).fetchone()
            if not row or not _row_owner_ok(row['owner_uid'], owner_uid):
                continue
            conn.execute(
                'UPDATE collection SET folder_id = ? WHERE id = ?',
                (folder_id, img_id),
            )
        conn.commit()
    finally:
        conn.close()
    return True


def get_collection_item(img_id: str, owner_uid: str = LEGACY_OWNER_SENTINEL) -> dict | None:
    conn = _get_conn()
    row = conn.execute('SELECT * FROM collection WHERE id = ?', (img_id,)).fetchone()
    conn.close()
    if not row:
        return None
    d = dict(row)
    if not _row_owner_ok(d.get('owner_uid'), owner_uid):
        return None
    return d


def delete_collection_item(img_id: str, owner_uid: str = LEGACY_OWNER_SENTINEL) -> bool:
    conn = _get_conn()
    row = conn.execute(
        'SELECT filename, thumb_filename, owner_uid FROM collection WHERE id = ?', (img_id,)
    ).fetchone()
    if not row:
        conn.close()
        return False
    if not _row_owner_ok(row['owner_uid'], owner_uid):
        conn.close()
        return False

    for name in (row['filename'], row['thumb_filename']):
        if not name:
            continue
        filepath = os.path.join(COLLECTION_DIR, name)
        if os.path.exists(filepath):
            os.remove(filepath)

    conn.execute('DELETE FROM collection WHERE id = ?', (img_id,))
    conn.commit()
    conn.close()
    return True


def get_collection_filepath(img_id: str, owner_uid: str = LEGACY_OWNER_SENTINEL) -> str | None:
    row = get_collection_item(img_id, owner_uid)
    if not row:
        return None
    path = os.path.join(COLLECTION_DIR, row['filename'])
    return path if os.path.exists(path) else None


def get_collection_thumb_filepath(
    img_id: str, owner_uid: str = LEGACY_OWNER_SENTINEL
) -> str | None:
    """Path to the picture that represents an item in the grid: the separate
    thumbnail when there is one (meshes), otherwise the item file itself."""
    row = get_collection_item(img_id, owner_uid)
    if not row:
        return None
    name = row.get('thumb_filename')
    if not name:
        # A mesh without a thumbnail has no picture at all — never fall back to
        # its GLB, which the caller would try to decode as an image.
        if (row.get('kind') or 'image') != 'image':
            return None
        name = row['filename']
    path = os.path.join(COLLECTION_DIR, name)
    return path if os.path.exists(path) else None


def _secret_nonempty(val: str | None) -> bool:
    return bool(val and str(val).strip())


def get_user_fal_key_sqlite(uid: str) -> str | None:
    conn = _get_conn()
    row = conn.execute(
        'SELECT fal_api_key FROM user_secrets WHERE uid = ?', (uid,)
    ).fetchone()
    conn.close()
    if not row:
        return None
    k = row['fal_api_key']
    return k if _secret_nonempty(k) else None


def set_user_fal_key_sqlite(uid: str, api_key: str) -> None:
    conn = _get_conn()
    row = conn.execute(
        'SELECT uid FROM user_secrets WHERE uid = ?', (uid,)
    ).fetchone()
    if row:
        conn.execute(
            'UPDATE user_secrets SET fal_api_key = ? WHERE uid = ?',
            (api_key, uid),
        )
    else:
        conn.execute(
            'INSERT INTO user_secrets (uid, fal_api_key) VALUES (?, ?)',
            (uid, api_key),
        )
    conn.commit()
    conn.close()


def clear_user_fal_key_sqlite(uid: str) -> None:
    conn = _get_conn()
    conn.execute('DELETE FROM user_secrets WHERE uid = ?', (uid,))
    conn.commit()
    conn.close()
