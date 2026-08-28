# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the SpotOn desktop build.

One folder rather than one file: a single-file build unpacks ~400 MB to a temp
directory on every launch, which is slow and trips antivirus scanners.

Build with packaging/build.bat, which also builds the frontend first.
"""

import os

from PyInstaller.utils.hooks import collect_all, copy_metadata

REPO_ROOT = os.path.abspath(os.path.join(SPECPATH, '..'))
BACKEND_DIR = os.path.join(REPO_ROOT, 'backend')
FRONTEND_DIST = os.path.join(REPO_ROOT, 'frontend', 'dist')

if not os.path.isfile(os.path.join(FRONTEND_DIST, 'index.html')):
    raise SystemExit(
        'frontend/dist is missing. Run "npm run build" in frontend/ first.'
    )

# The UI is served from here by backend/main.py; keep the name in sync with
# paths.py::_resolve_frontend_dist.
datas = [(FRONTEND_DIST, 'web')]
binaries = []
hiddenimports = [
    # uvicorn resolves these by string at runtime, so static analysis misses them.
    'uvicorn.lifespan.off',
    'uvicorn.lifespan.on',
    'uvicorn.logging',
    'uvicorn.loops.auto',
    'uvicorn.loops.asyncio',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.http.h11_impl',
    'uvicorn.protocols.http.httptools_impl',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.protocols.websockets.websockets_impl',
    'uvicorn.protocols.websockets.wsproto_impl',
    'truststore',
]

# Packages that load plugins, data files or compiled extensions dynamically.
for package in ('fal_client',):
    package_datas, package_binaries, package_hiddenimports = collect_all(package)
    datas += package_datas
    binaries += package_binaries
    hiddenimports += package_hiddenimports

# Several libraries read their own version through importlib.metadata and raise
# at import time when the dist-info is absent from the bundle.
for distribution in (
    'fal-client',
    'fastapi',
    'httpx',
    'numpy',
    'pillow',
    'python-dotenv',
    'uvicorn',
):
    datas += copy_metadata(distribution)

a = Analysis(
    [os.path.join(BACKEND_DIR, 'main.py')],
    pathex=[BACKEND_DIR],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Developer tooling and GUI toolkits that nothing in the app imports.
        'IPython',
        'PyQt5',
        'PySide2',
        'matplotlib',
        'notebook',
        'pytest',
        'setuptools',
        'tkinter',
        # Heavyweights that arrived with the old local background remover. Kept
        # in the exclude list so a stale virtualenv cannot drag them back in.
        'onnxruntime',
        'rembg',
        'pymatting',
        'scipy',
        'skimage',
        'pandas',
        'pyarrow',
        'lxml',
    ],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='SpotOn',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=os.path.join(SPECPATH, 'SpotOn.ico'),
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='SpotOn',
)
