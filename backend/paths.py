"""Filesystem locations for everything SpotOn writes at runtime.

The app is distributed as an installer, so it cannot assume its own directory is
writable — an install under Program Files is not. All user data therefore lives
in a per-user data directory (``%APPDATA%\\SpotOn`` on Windows) and this module
is the only place that decides where that is.

Set ``SPOTON_DATA_DIR`` to relocate the whole tree, e.g. for a portable copy on
a USB stick or for tests that must not touch real data.

Earlier versions kept everything next to the code, so importing this module also
moves any data found there into the new location. Moves within the same volume
are renames, so this is fast even for a large collection.
"""

import os
import shutil
import sys

APP_NAME = 'SpotOn'

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))


def _resolve_data_dir() -> str:
    override = (os.getenv('SPOTON_DATA_DIR') or '').strip()
    if override:
        return os.path.abspath(os.path.expanduser(override))
    if sys.platform == 'win32':
        base = os.getenv('APPDATA') or os.path.expanduser('~')
    elif sys.platform == 'darwin':
        base = os.path.join(os.path.expanduser('~'), 'Library', 'Application Support')
    else:
        base = (
            os.getenv('XDG_DATA_HOME')
            or os.path.join(os.path.expanduser('~'), '.local', 'share')
        )
    return os.path.join(base, APP_NAME)


DATA_DIR = _resolve_data_dir()

DB_PATH = os.path.join(DATA_DIR, 'spoton.db')
COLLECTION_DIR = os.path.join(DATA_DIR, 'collection')
UPLOAD_DIR = os.path.join(DATA_DIR, 'uploads')
EXPORT_DIR = os.path.join(DATA_DIR, 'exports')

# Optional key file for an installed copy, which has no .env beside the code.
ENV_FILE = os.path.join(DATA_DIR, '.env')

# Database filenames used by earlier releases, newest first.
_LEGACY_DB_NAMES = ('spoton.db', 'blackpot.db', 'weavy.db')

# SQLite writes these alongside the database in WAL mode.
_DB_SUFFIXES = ('', '-wal', '-shm')


def _adopt_legacy_db() -> None:
    if os.path.exists(DB_PATH):
        return
    for name in _LEGACY_DB_NAMES:
        legacy = os.path.join(BACKEND_DIR, name)
        if not os.path.exists(legacy) or os.path.normcase(legacy) == os.path.normcase(DB_PATH):
            continue
        for suffix in _DB_SUFFIXES:
            src = legacy + suffix
            if os.path.exists(src):
                shutil.move(src, DB_PATH + suffix)
        return


def _adopt_legacy_dir(name: str, target: str) -> None:
    legacy = os.path.join(BACKEND_DIR, name)
    if not os.path.isdir(legacy) or os.path.normcase(legacy) == os.path.normcase(target):
        return
    if not os.path.exists(target):
        shutil.move(legacy, target)
        return
    # A target already exists (a partial migration, or a fresh empty folder), so
    # merge instead of clobbering it.
    for entry in os.listdir(legacy):
        dest = os.path.join(target, entry)
        if not os.path.exists(dest):
            shutil.move(os.path.join(legacy, entry), dest)
    if not os.listdir(legacy):
        os.rmdir(legacy)


def _prepare() -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    if os.path.isdir(BACKEND_DIR):
        try:
            _adopt_legacy_db()
            for name, target in (
                ('collection', COLLECTION_DIR),
                ('uploads', UPLOAD_DIR),
                ('exports', EXPORT_DIR),
            ):
                _adopt_legacy_dir(name, target)
        except OSError:
            # A failed migration must not stop the app from starting; the worst
            # case is that the old data stays put and the app starts empty.
            pass
    for directory in (COLLECTION_DIR, UPLOAD_DIR, EXPORT_DIR):
        os.makedirs(directory, exist_ok=True)


_prepare()
