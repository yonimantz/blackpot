import json
import os
import uuid
from datetime import datetime, timezone
from typing import Any

import firebase_admin
from firebase_admin import firestore as admin_firestore
from firebase_admin import storage as admin_storage
from google.cloud.firestore_v1 import DELETE_FIELD, SERVER_TIMESTAMP

import database as db

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _db():
    try:
        firebase_admin.get_app()
    except ValueError:
        raise RuntimeError('Firebase app not initialized') from None
    return admin_firestore.client()


def _bucket_name() -> str:
    b = os.getenv('FIREBASE_STORAGE_BUCKET', '').strip()
    if b:
        return b
    pid = os.getenv('FIREBASE_PROJECT_ID', '').strip()
    if pid:
        return f'{pid}.appspot.com'
    raise RuntimeError('Set FIREBASE_STORAGE_BUCKET or FIREBASE_PROJECT_ID')


def _bucket():
    return admin_storage.bucket(_bucket_name())


def _dt_sort_key(val) -> float:
    if val is None:
        return 0.0
    if hasattr(val, 'timestamp'):
        return float(val.timestamp())
    return 0.0


def _fmt_ts(val) -> str:
    if val is not None and hasattr(val, 'isoformat'):
        return val.isoformat()
    return _now_iso()


_DEFAULT_WORKFLOW_ICON_ID = 'wf1'


class FirestoreBackend:
    def list_workflows(self, owner_uid: str) -> list[dict]:
        q = _db().collection('workflows').where('ownerUid', '==', owner_uid).stream()
        rows = []
        for doc in q:
            d = doc.to_dict() or {}
            ic = d.get('iconColor')
            rows.append({
                'id': doc.id,
                'name': d.get('name', 'Untitled Workflow'),
                'icon_id': d.get('iconId') or _DEFAULT_WORKFLOW_ICON_ID,
                'icon_color': ic if ic else None,
                'description': d.get('description') or '',
                'created_at': _fmt_ts(d.get('createdAt')),
                'updated_at': _fmt_ts(d.get('updatedAt')),
                '_sort': _dt_sort_key(d.get('updatedAt')),
            })
        rows.sort(key=lambda x: x['_sort'], reverse=True)
        for r in rows:
            del r['_sort']
        return rows

    def create_workflow(
        self,
        owner_uid: str,
        name: str,
        icon_id: str | None = None,
        description: str | None = None,
        icon_color: str | None = None,
    ) -> dict:
        wf_id = str(uuid.uuid4())
        now = _now_iso()
        empty = {'nodes': [], 'edges': [], 'groups': []}
        iid = (icon_id or '').strip() or _DEFAULT_WORKFLOW_ICON_ID
        desc = description if description is not None else ''
        icol = db.normalize_workflow_icon_color(icon_color)
        ref = _db().collection('workflows').document(wf_id)
        doc: dict = {
            'ownerUid': owner_uid,
            'name': name,
            'iconId': iid,
            'description': desc,
            'dataJson': json.dumps(empty),
            'createdAt': SERVER_TIMESTAMP,
            'updatedAt': SERVER_TIMESTAMP,
        }
        if icol:
            doc['iconColor'] = icol
        ref.set(doc)
        return {
            'id': wf_id,
            'name': name,
            'data': empty,
            'icon_id': iid,
            'icon_color': icol,
            'description': desc,
            'created_at': now,
            'updated_at': now,
        }

    def get_workflow(self, owner_uid: str, wf_id: str) -> dict | None:
        doc = _db().collection('workflows').document(wf_id).get()
        if not doc.exists:
            return None
        d = doc.to_dict() or {}
        if d.get('ownerUid') != owner_uid:
            return None
        data_raw = d.get('dataJson')
        if isinstance(data_raw, str):
            data = json.loads(data_raw)
        else:
            data = data_raw or {}
        ic = d.get('iconColor')
        return {
            'id': doc.id,
            'name': d.get('name', 'Untitled Workflow'),
            'data': data,
            'icon_id': d.get('iconId') or _DEFAULT_WORKFLOW_ICON_ID,
            'icon_color': ic if ic else None,
            'description': d.get('description') or '',
            'created_at': _fmt_ts(d.get('createdAt')),
            'updated_at': _fmt_ts(d.get('updatedAt')),
        }

    def update_workflow(
        self,
        owner_uid: str,
        wf_id: str,
        name: str | None,
        data: dict | None,
        icon_id: str | None = None,
        description: str | None = None,
        icon_color: str | None | Any = db.ICON_COLOR_UNSET,
    ) -> dict | None:
        ref = _db().collection('workflows').document(wf_id)
        doc = ref.get()
        if not doc.exists:
            return None
        d = doc.to_dict() or {}
        if d.get('ownerUid') != owner_uid:
            return None
        updates: dict = {'updatedAt': SERVER_TIMESTAMP}
        if name is not None:
            updates['name'] = name
        if data is not None:
            updates['dataJson'] = json.dumps(data)
        if icon_id is not None:
            updates['iconId'] = (icon_id or '').strip() or _DEFAULT_WORKFLOW_ICON_ID
        if description is not None:
            updates['description'] = description
        if icon_color is not db.ICON_COLOR_UNSET:
            norm = db.normalize_workflow_icon_color(icon_color)  # type: ignore[arg-type]
            if norm:
                updates['iconColor'] = norm
            else:
                updates['iconColor'] = DELETE_FIELD
        ref.update(updates)
        snap = ref.get().to_dict() or {}
        ic = snap.get('iconColor')
        return {
            'id': wf_id,
            'name': snap.get('name', 'Untitled Workflow'),
            'icon_id': snap.get('iconId') or _DEFAULT_WORKFLOW_ICON_ID,
            'icon_color': ic if ic else None,
            'description': snap.get('description') or '',
            'updated_at': _fmt_ts(snap.get('updatedAt')),
        }

    def delete_workflow(self, owner_uid: str, wf_id: str) -> bool:
        ref = _db().collection('workflows').document(wf_id)
        doc = ref.get()
        if not doc.exists:
            return False
        if (doc.to_dict() or {}).get('ownerUid') != owner_uid:
            return False
        ref.delete()
        return True

    def list_collection(self, owner_uid: str, in_folder_id: str | None = None) -> list[dict]:
        q = _db().collection('collectionItems').where('ownerUid', '==', owner_uid).stream()
        rows = []
        for doc in q:
            d = doc.to_dict() or {}
            fid = d.get('folderId')
            if in_folder_id is None:
                if fid is not None and fid != '':
                    continue
            else:
                if fid != in_folder_id:
                    continue
            rows.append({
                'id': doc.id,
                'workflow_id': d.get('workflowId'),
                'filename': d.get('filename', ''),
                'width': d.get('width'),
                'height': d.get('height'),
                'created_at': _fmt_ts(d.get('createdAt')),
                'folder_id': fid if fid else None,
                '_sort': _dt_sort_key(d.get('createdAt')),
            })
        rows.sort(key=lambda x: x['_sort'], reverse=True)
        for r in rows:
            del r['_sort']
        return rows

    def add_to_collection(
        self,
        owner_uid: str,
        image_bytes: bytes,
        ext: str,
        workflow_id: str | None,
        width: int | None,
        height: int | None,
    ) -> dict:
        img_id = str(uuid.uuid4())
        path = f'users/{owner_uid}/collection/{img_id}.{ext}'
        mime = 'image/png'
        if ext in ('jpg', 'jpeg'):
            mime = 'image/jpeg'
        elif ext == 'webp':
            mime = 'image/webp'
        blob = _bucket().blob(path)
        blob.upload_from_string(image_bytes, content_type=mime)

        now = _now_iso()
        ref = _db().collection('collectionItems').document(img_id)
        ref.set({
            'ownerUid': owner_uid,
            'workflowId': workflow_id,
            'storagePath': path,
            'filename': f'{img_id}.{ext}',
            'width': width,
            'height': height,
            'createdAt': SERVER_TIMESTAMP,
        })
        return {
            'id': img_id,
            'filename': f'{img_id}.{ext}',
            'width': width,
            'height': height,
            'created_at': now,
            'folder_id': None,
        }

    def _get_collection_folder_fs(self, owner_uid: str, folder_id: str) -> dict | None:
        ref = _db().collection('collectionFolders').document(folder_id)
        doc = ref.get()
        if not doc.exists:
            return None
        d = doc.to_dict() or {}
        if d.get('ownerUid') != owner_uid:
            return None
        return {
            'id': doc.id,
            'name': d.get('name', 'Folder'),
            'created_at': _fmt_ts(d.get('createdAt')),
        }

    def get_collection_folder(self, owner_uid: str, folder_id: str) -> dict | None:
        return self._get_collection_folder_fs(owner_uid, folder_id)

    def list_collection_folders(self, owner_uid: str) -> list[dict]:
        q = _db().collection('collectionFolders').where('ownerUid', '==', owner_uid).stream()
        rows = []
        for doc in q:
            d = doc.to_dict() or {}
            fid = doc.id
            rows.append({
                'id': fid,
                'name': d.get('name', 'Folder'),
                'created_at': _fmt_ts(d.get('createdAt')),
                '_sort': _dt_sort_key(d.get('createdAt')),
            })
        counts: dict[str, int] = {}
        for doc in _db().collection('collectionItems').where('ownerUid', '==', owner_uid).stream():
            fd = (doc.to_dict() or {}).get('folderId')
            if fd:
                counts[fd] = counts.get(fd, 0) + 1
        for r in rows:
            r['item_count'] = counts.get(r['id'], 0)
        rows.sort(key=lambda x: x['_sort'], reverse=False)
        for r in rows:
            del r['_sort']
        return rows

    def create_collection_folder(self, owner_uid: str, name: str) -> dict:
        trimmed = (name or '').strip() or 'Untitled folder'
        folder_id = str(uuid.uuid4())
        now = _now_iso()
        ref = _db().collection('collectionFolders').document(folder_id)
        ref.set({
            'ownerUid': owner_uid,
            'name': trimmed,
            'createdAt': SERVER_TIMESTAMP,
        })
        return {'id': folder_id, 'name': trimmed, 'created_at': now, 'item_count': 0}

    def rename_collection_folder(self, owner_uid: str, folder_id: str, name: str) -> dict | None:
        if not self._get_collection_folder_fs(owner_uid, folder_id):
            return None
        trimmed = (name or '').strip() or 'Untitled folder'
        ref = _db().collection('collectionFolders').document(folder_id)
        ref.update({'name': trimmed})
        row = self._get_collection_folder_fs(owner_uid, folder_id)
        if not row:
            return None
        item_count = 0
        for doc in _db().collection('collectionItems').where('ownerUid', '==', owner_uid).stream():
            if (doc.to_dict() or {}).get('folderId') == folder_id:
                item_count += 1
        return {**row, 'item_count': item_count}

    def delete_collection_folder_unlink(self, owner_uid: str, folder_id: str) -> bool:
        if not self._get_collection_folder_fs(owner_uid, folder_id):
            return False
        batch = _db().batch()
        n = 0
        for doc in _db().collection('collectionItems').where('ownerUid', '==', owner_uid).stream():
            if (doc.to_dict() or {}).get('folderId') != folder_id:
                continue
            batch.update(doc.reference, {'folderId': DELETE_FIELD})
            n += 1
            if n >= 450:
                batch.commit()
                batch = _db().batch()
                n = 0
        if n:
            batch.commit()
        _db().collection('collectionFolders').document(folder_id).delete()
        return True

    def delete_collection_folder_and_items(self, owner_uid: str, folder_id: str) -> bool:
        if not self._get_collection_folder_fs(owner_uid, folder_id):
            return False
        to_delete: list[str] = []
        for doc in _db().collection('collectionItems').where('ownerUid', '==', owner_uid).stream():
            if (doc.to_dict() or {}).get('folderId') == folder_id:
                to_delete.append(doc.id)
        for img_id in to_delete:
            self.delete_collection_item(owner_uid, img_id)
        _db().collection('collectionFolders').document(folder_id).delete()
        return True

    def set_collection_items_folder(
        self, owner_uid: str, img_ids: list[str], folder_id: str | None
    ) -> bool:
        if folder_id is not None and not self._get_collection_folder_fs(owner_uid, folder_id):
            return False
        for img_id in img_ids:
            ref = _db().collection('collectionItems').document(img_id)
            doc = ref.get()
            if not doc.exists:
                continue
            d = doc.to_dict() or {}
            if d.get('ownerUid') != owner_uid:
                continue
            if folder_id is None:
                ref.update({'folderId': DELETE_FIELD})
            else:
                ref.update({'folderId': folder_id})
        return True

    def delete_collection_item(self, owner_uid: str, img_id: str) -> bool:
        ref = _db().collection('collectionItems').document(img_id)
        doc = ref.get()
        if not doc.exists:
            return False
        d = doc.to_dict() or {}
        if d.get('ownerUid') != owner_uid:
            return False
        sp = d.get('storagePath')
        if sp:
            try:
                _bucket().blob(sp).delete()
            except Exception:
                pass
        ref.delete()
        return True

    def get_collection_bytes(self, owner_uid: str, img_id: str) -> tuple[bytes, str] | None:
        ref = _db().collection('collectionItems').document(img_id)
        doc = ref.get()
        if not doc.exists:
            return None
        d = doc.to_dict() or {}
        if d.get('ownerUid') != owner_uid:
            return None
        sp = d.get('storagePath')
        if not sp:
            return None
        blob = _bucket().blob(sp)
        raw = blob.download_as_bytes()
        mime = blob.content_type or 'image/png'
        return raw, mime

    def get_user_gemini_key(self, owner_uid: str) -> str | None:
        doc = _db().collection('userSecrets').document(owner_uid).get()
        if not doc.exists:
            return None
        key = (doc.to_dict() or {}).get('geminiApiKey')
        return key if isinstance(key, str) else None

    def set_user_gemini_key(self, owner_uid: str, api_key: str) -> None:
        _db().collection('userSecrets').document(owner_uid).set(
            {'geminiApiKey': api_key}, merge=True,
        )

    def clear_user_gemini_key(self, owner_uid: str) -> None:
        ref = _db().collection('userSecrets').document(owner_uid)
        doc = ref.get()
        if not doc.exists:
            return
        ref.update({'geminiApiKey': DELETE_FIELD})

    def get_user_openai_key(self, owner_uid: str) -> str | None:
        doc = _db().collection('userSecrets').document(owner_uid).get()
        if not doc.exists:
            return None
        key = (doc.to_dict() or {}).get('openaiApiKey')
        return key if isinstance(key, str) and key.strip() else None

    def set_user_openai_key(self, owner_uid: str, api_key: str) -> None:
        _db().collection('userSecrets').document(owner_uid).set(
            {'openaiApiKey': api_key}, merge=True,
        )

    def clear_user_openai_key(self, owner_uid: str) -> None:
        ref = _db().collection('userSecrets').document(owner_uid)
        doc = ref.get()
        if not doc.exists:
            return
        ref.update({'openaiApiKey': DELETE_FIELD})