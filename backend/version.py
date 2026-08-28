"""The single source of truth for SpotOn's version.

A frozen PyInstaller build carries this module the same as any other, so it
needs no entry in spoton.spec. Everything else that needs the version —
packaging\\build.bat (which feeds packaging\\spoton.iss), /api/health, and the
Settings page — reads it from here, directly or indirectly.

frontend/package.json also carries a `version` field, only because npm requires
one to exist. packaging\\build.bat checks it against this file and refuses to
build on a mismatch, so it cannot silently drift the way it did before (it sat
at "0.0.0" while this project shipped several releases).
"""

__version__ = '1.2.0'
