"""Firebase Auth ID token verification and invite allowlist."""

import os
from functools import lru_cache
from typing import Any

import firebase_admin
from firebase_admin import auth, credentials
from firebase_admin import firestore as admin_firestore

_project_id = os.getenv('FIREBASE_PROJECT_ID', '').strip()
_allowlist_skip = os.getenv('AUTH_SKIP_ALLOWLIST', '').lower() in ('1', 'true', 'yes')
_allowed_emails_env = os.getenv('ALLOWLIST_EMAILS', '').strip()


@lru_cache(maxsize=1)
def _ensure_app():
    if not _project_id:
        raise RuntimeError('FIREBASE_PROJECT_ID is not set')
    try:
        return firebase_admin.get_app()
    except ValueError:
        pass
    opts = {}
    sb = os.getenv('FIREBASE_STORAGE_BUCKET', '').strip()
    opts['storageBucket'] = sb if sb else f'{_project_id}.appspot.com'
    cred_path = os.getenv('GOOGLE_APPLICATION_CREDENTIALS', '').strip()
    if cred_path and os.path.isfile(cred_path):
        cred = credentials.Certificate(cred_path)
        return firebase_admin.initialize_app(cred, opts)
    return firebase_admin.initialize_app(options=opts)


def ensure_firebase_initialized() -> None:
    """Required for Firestore/Storage backends and Auth verification."""
    _ensure_app()


def auth_enabled() -> bool:
    return bool(_project_id)


def _normalize_email(email: str | None) -> str:
    return (email or '').strip().lower()


def _emails_from_env() -> set[str]:
    if not _allowed_emails_env:
        return set()
    return {x.strip().lower() for x in _allowed_emails_env.split(',') if x.strip()}


def _emails_from_firestore() -> set[str] | None:
    """None = skip Firestore; empty set = doc exists but no emails."""
    try:
        _ensure_app()
        db = admin_firestore.client()
        doc = db.collection('config').document('allowed_emails').get()
        if not doc.exists:
            return None
        data = doc.to_dict() or {}
        emails = data.get('emails')
        if not isinstance(emails, list):
            return set()
        return {str(e).strip().lower() for e in emails if str(e).strip()}
    except Exception:
        return None


def is_email_allowed(email: str | None) -> bool:
    if not email:
        return False
    norm = _normalize_email(email)
    if _allowlist_skip:
        return True
    env_set = _emails_from_env()
    if env_set:
        return norm in env_set
    fs_set = _emails_from_firestore()
    if fs_set is not None:
        return norm in fs_set
    return False


def verify_id_token(id_token: str) -> dict[str, Any]:
    if not auth_enabled():
        raise RuntimeError('Firebase Auth is not configured (set FIREBASE_PROJECT_ID)')
    _ensure_app()
    decoded = auth.verify_id_token(id_token)
    email = decoded.get('email')
    if not is_email_allowed(email):
        raise PermissionError('Your email is not on the invite list for this app.')
    return {
        'uid': decoded['uid'],
        'email': email,
    }
