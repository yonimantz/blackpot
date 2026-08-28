from typing import Any

import database as db

_MIME_BY_EXT = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'webp': 'image/webp',
    'glb': 'model/gltf-binary',
}


def _read_with_mime(path: str | None) -> tuple[bytes, str] | None:
    if not path:
        return None
    with open(path, 'rb') as f:
        raw = f.read()
    ext = path.rsplit('.', 1)[-1].lower()
    return raw, _MIME_BY_EXT.get(ext, 'image/png')


class SqliteBackend:
    def list_workflows(self, owner_uid: str) -> list[dict]:
        return db.list_workflows(owner_uid)

    def create_workflow(
        self,
        owner_uid: str,
        name: str,
        icon_id: str | None = None,
        description: str | None = None,
        icon_color: str | None = None,
    ) -> dict:
        ouid = None if owner_uid == db.LEGACY_OWNER_SENTINEL else owner_uid
        return db.create_workflow(
            name,
            owner_uid=ouid,
            icon_id=icon_id,
            description=description,
            icon_color=icon_color,
        )

    def get_workflow(self, owner_uid: str, wf_id: str) -> dict | None:
        return db.get_workflow(wf_id, owner_uid)

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
        return db.update_workflow(
            wf_id,
            owner_uid,
            name=name,
            data=data,
            icon_id=icon_id,
            description=description,
            icon_color=icon_color,
        )

    def delete_workflow(self, owner_uid: str, wf_id: str) -> bool:
        return db.delete_workflow(wf_id, owner_uid)

    def list_collection(self, owner_uid: str, in_folder_id: str | None = None) -> list[dict]:
        return db.list_collection(owner_uid, in_folder_id)

    def add_to_collection(
        self,
        owner_uid: str,
        image_bytes: bytes,
        ext: str,
        workflow_id: str | None,
        width: int | None,
        height: int | None,
        prompt: str | None = None,
        seed: int | None = None,
        model: str | None = None,
    ) -> dict:
        ouid = None if owner_uid == db.LEGACY_OWNER_SENTINEL else owner_uid
        return db.add_to_collection(
            image_bytes,
            ext=ext,
            workflow_id=workflow_id,
            width=width,
            height=height,
            owner_uid=ouid,
            prompt=prompt,
            seed=seed,
            model=model,
        )

    def add_model_to_collection(
        self,
        owner_uid: str,
        model_bytes: bytes,
        ext: str = 'glb',
        thumb_bytes: bytes | None = None,
        thumb_ext: str = 'png',
        workflow_id: str | None = None,
        prompt: str | None = None,
        seed: int | None = None,
        model: str | None = None,
    ) -> dict:
        ouid = None if owner_uid == db.LEGACY_OWNER_SENTINEL else owner_uid
        return db.add_model_to_collection(
            model_bytes,
            ext=ext,
            thumb_bytes=thumb_bytes,
            thumb_ext=thumb_ext,
            workflow_id=workflow_id,
            owner_uid=ouid,
            prompt=prompt,
            seed=seed,
            model=model,
        )

    def delete_collection_item(self, owner_uid: str, img_id: str) -> bool:
        return db.delete_collection_item(img_id, owner_uid)

    def get_collection_bytes(self, owner_uid: str, img_id: str) -> tuple[bytes, str] | None:
        return _read_with_mime(db.get_collection_filepath(img_id, owner_uid))

    def get_collection_thumb_bytes(
        self, owner_uid: str, img_id: str
    ) -> tuple[bytes, str] | None:
        return _read_with_mime(db.get_collection_thumb_filepath(img_id, owner_uid))

    def get_collection_folder(self, owner_uid: str, folder_id: str) -> dict | None:
        return db.get_collection_folder(folder_id, owner_uid)

    def list_collection_folders(self, owner_uid: str) -> list[dict]:
        return db.list_collection_folders(owner_uid)

    def create_collection_folder(self, owner_uid: str, name: str) -> dict:
        return db.create_collection_folder(name, owner_uid)

    def rename_collection_folder(self, owner_uid: str, folder_id: str, name: str) -> dict | None:
        return db.rename_collection_folder(folder_id, name, owner_uid)

    def delete_collection_folder_unlink(self, owner_uid: str, folder_id: str) -> bool:
        return db.delete_collection_folder_unlink(folder_id, owner_uid)

    def delete_collection_folder_and_items(self, owner_uid: str, folder_id: str) -> bool:
        return db.delete_collection_folder_and_items(folder_id, owner_uid)

    def set_collection_items_folder(
        self, owner_uid: str, img_ids: list[str], folder_id: str | None
    ) -> bool:
        return db.set_collection_items_folder(img_ids, folder_id, owner_uid)

    def get_user_fal_key(self, owner_uid: str) -> str | None:
        if owner_uid == db.LEGACY_OWNER_SENTINEL:
            return None
        return db.get_user_fal_key_sqlite(owner_uid)

    def set_user_fal_key(self, owner_uid: str, api_key: str) -> None:
        if owner_uid == db.LEGACY_OWNER_SENTINEL:
            raise ValueError('Cannot store API key without a signed-in user')
        db.set_user_fal_key_sqlite(owner_uid, api_key)

    def clear_user_fal_key(self, owner_uid: str) -> None:
        if owner_uid == db.LEGACY_OWNER_SENTINEL:
            return
        db.clear_user_fal_key_sqlite(owner_uid)
