import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone

_BASE_DIR = os.path.dirname(__file__)
DB_PATH = os.path.join(_BASE_DIR, 'blackpot.db')
_LEGACY_DB = os.path.join(_BASE_DIR, 'weavy.db')
if not os.path.exists(DB_PATH) and os.path.exists(_LEGACY_DB):
    for suffix in ('', '-wal', '-shm'):
        old = _LEGACY_DB + suffix if suffix else _LEGACY_DB
        new = DB_PATH + suffix if suffix else DB_PATH
        if os.path.exists(old):
            os.replace(old, new)

COLLECTION_DIR = os.path.join(_BASE_DIR, 'collection')
os.makedirs(COLLECTION_DIR, exist_ok=True)

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


def _column_exists(conn: sqlite3.Connection, table: str, col: str) -> bool:
    rows = conn.execute(f'PRAGMA table_info({table})').fetchall()
    return any(r[1] == col for r in rows)


def init_db():
    conn = _get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS workflows (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL DEFAULT 'Untitled Workflow',
            data       TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS collection (
            id          TEXT PRIMARY KEY,
            workflow_id TEXT,
            filename    TEXT NOT NULL,
            width       INTEGER,
            height      INTEGER,
            created_at  TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS user_secrets (
            uid TEXT PRIMARY KEY,
            gemini_api_key TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS collection_folders (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            owner_uid  TEXT,
            created_at TEXT NOT NULL
        );
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
    if not _column_exists(conn, 'collection', 'folder_id'):
        conn.execute('ALTER TABLE collection ADD COLUMN folder_id TEXT')
    if not _column_exists(conn, 'user_secrets', 'openai_api_key'):
        conn.execute('ALTER TABLE user_secrets ADD COLUMN openai_api_key TEXT')
    conn.commit()
    conn.close()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _workflow_row_summary(r: sqlite3.Row) -> dict:
    d = dict(r)
    d['icon_id'] = d.get('icon_id') or DEFAULT_WORKFLOW_ICON_ID
    d['description'] = d.get('description') or ''
    ic = d.get('icon_color')
    d['icon_color'] = ic if ic else None
    return d


def _legacy_list_workflows() -> list[dict]:
    conn = _get_conn()
    rows = conn.execute(
        'SELECT id, name, icon_id, icon_color, description, updated_at, created_at FROM workflows '
        'ORDER BY updated_at DESC'
    ).fetchall()
    conn.close()
    return [_workflow_row_summary(r) for r in rows]


def list_workflows(owner_uid: str) -> list[dict]:
    if owner_uid == LEGACY_OWNER_SENTINEL:
        return _legacy_list_workflows()
    conn = _get_conn()
    rows = conn.execute(
        'SELECT id, name, icon_id, icon_color, description, updated_at, created_at FROM workflows '
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
        'UPDATE workflows SET name = ?, data = ?, icon_id = ?, icon_color = ?, description = ?, updated_at = ? '
        'WHERE id = ?',
        (new_name, new_data, new_icon_id, new_icon_color, new_description, now, wf_id),
    )
    conn.commit()
    conn.close()
    return {
        'id': wf_id,
        'name': new_name,
        'icon_id': new_icon_id,
        'icon_color': new_icon_color,
        'description': new_description,
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


def add_to_collection(
    image_bytes: bytes,
    ext: str = 'png',
    workflow_id: str | None = None,
    width: int | None = None,
    height: int | None = None,
    owner_uid: str | None = None,
) -> dict:
    img_id = str(uuid.uuid4())
    filename = f'{img_id}.{ext}'
    filepath = os.path.join(COLLECTION_DIR, filename)

    with open(filepath, 'wb') as f:
        f.write(image_bytes)

    now = _now_iso()
    conn = _get_conn()
    conn.execute(
        'INSERT INTO collection (id, workflow_id, filename, width, height, created_at, owner_uid, folder_id) '
        'VALUES (?, ?, ?, ?, ?, ?, ?, NULL)',
        (img_id, workflow_id, filename, width, height, now, owner_uid),
    )
    conn.commit()
    conn.close()
    return {
        'id': img_id,
        'filename': filename,
        'width': width,
        'height': height,
        'created_at': now,
    }


def _collection_row_public(d: dict) -> dict:
    """Normalize collection row for API."""
    return {
        'id': d['id'],
        'workflow_id': d.get('workflow_id'),
        'filename': d['filename'],
        'width': d.get('width'),
        'height': d.get('height'),
        'created_at': d['created_at'],
        'folder_id': d.get('folder_id'),
    }


def _legacy_list_collection(in_folder_id: str | None = None) -> list[dict]:
    conn = _get_conn()
    sel = (
        'SELECT id, workflow_id, filename, width, height, created_at, folder_id FROM collection '
    )
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
    sel = (
        'SELECT id, workflow_id, filename, width, height, created_at, folder_id FROM collection '
    )
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
        'SELECT filename, owner_uid FROM collection WHERE id = ?', (img_id,)
    ).fetchone()
    if not row:
        conn.close()
        return False
    if not _row_owner_ok(row['owner_uid'], owner_uid):
        conn.close()
        return False

    filepath = os.path.join(COLLECTION_DIR, row['filename'])
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


def _secret_nonempty(val: str | None) -> bool:
    return bool(val and str(val).strip())


def get_user_gemini_key_sqlite(uid: str) -> str | None:
    conn = _get_conn()
    row = conn.execute(
        'SELECT gemini_api_key FROM user_secrets WHERE uid = ?', (uid,)
    ).fetchone()
    conn.close()
    if not row:
        return None
    k = row['gemini_api_key']
    return k if _secret_nonempty(k) else None


def set_user_gemini_key_sqlite(uid: str, api_key: str) -> None:
    conn = _get_conn()
    row = conn.execute(
        'SELECT openai_api_key FROM user_secrets WHERE uid = ?', (uid,)
    ).fetchone()
    if row:
        conn.execute(
            'UPDATE user_secrets SET gemini_api_key = ? WHERE uid = ?',
            (api_key, uid),
        )
    else:
        conn.execute(
            'INSERT INTO user_secrets (uid, gemini_api_key, openai_api_key) VALUES (?, ?, NULL)',
            (uid, api_key),
        )
    conn.commit()
    conn.close()


def clear_user_gemini_key_sqlite(uid: str) -> None:
    conn = _get_conn()
    conn.execute(
        "UPDATE user_secrets SET gemini_api_key = '' WHERE uid = ?",
        (uid,),
    )
    conn.execute(
        """DELETE FROM user_secrets WHERE uid = ?
           AND IFNULL(TRIM(gemini_api_key), '') = ''
           AND IFNULL(TRIM(openai_api_key), '') = ''""",
        (uid,),
    )
    conn.commit()
    conn.close()


def get_user_openai_key_sqlite(uid: str) -> str | None:
    conn = _get_conn()
    row = conn.execute(
        'SELECT openai_api_key FROM user_secrets WHERE uid = ?', (uid,)
    ).fetchone()
    conn.close()
    if not row:
        return None
    k = row['openai_api_key']
    return k if _secret_nonempty(k) else None


def set_user_openai_key_sqlite(uid: str, api_key: str) -> None:
    conn = _get_conn()
    row = conn.execute(
        'SELECT gemini_api_key FROM user_secrets WHERE uid = ?', (uid,)
    ).fetchone()
    if row:
        conn.execute(
            'UPDATE user_secrets SET openai_api_key = ? WHERE uid = ?',
            (api_key, uid),
        )
    else:
        conn.execute(
            'INSERT INTO user_secrets (uid, gemini_api_key, openai_api_key) VALUES (?, ?, ?)',
            (uid, '', api_key),
        )
    conn.commit()
    conn.close()


def clear_user_openai_key_sqlite(uid: str) -> None:
    conn = _get_conn()
    conn.execute(
        'UPDATE user_secrets SET openai_api_key = NULL WHERE uid = ?',
        (uid,),
    )
    conn.execute(
        """DELETE FROM user_secrets WHERE uid = ?
           AND IFNULL(TRIM(gemini_api_key), '') = ''
           AND IFNULL(TRIM(openai_api_key), '') = ''""",
        (uid,),
    )
    conn.commit()
    conn.close()
