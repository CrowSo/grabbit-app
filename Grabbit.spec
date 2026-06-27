# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all

ph_datas, ph_binaries, ph_hiddenimports = collect_all('pillow_heif')

a = Analysis(
    ['launcher.py'],
    pathex=[],
    binaries=ph_binaries,
    datas=[('templates', 'templates'), ('static', 'static')] + ph_datas,
    hiddenimports=['flask', 'werkzeug', 'jinja2', 'PIL', 'PIL.Image', 'pystray', 'pystray._win32'] + ph_hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='Grabbit',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=['grabbit.ico'],
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='Grabbit',
)
