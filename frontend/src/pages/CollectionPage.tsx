import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listCollection,
  listCollectionFolders,
  createCollectionFolder,
  renameCollectionFolder,
  deleteCollectionFolder,
  moveCollectionItems,
  deleteCollectionItem,
  fetchCollectionImageBlob,
  type CollectionItem,
  type CollectionFolder,
} from '../utils/api';

function ShelfIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 19V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14" />
      <path d="M4 10h16" />
      <path d="M4 15h16" />
      <path d="M9 6v4" />
      <path d="M15 6v4" />
      <path d="M9 11v4" />
      <path d="M15 11v4" />
    </svg>
  );
}

function CollectionImage({
  imageId,
  className,
  alt = '',
}: {
  imageId: string;
  className?: string;
  alt?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      try {
        const blob = await fetchCollectionImageBlob(imageId);
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setSrc(objectUrl);
      } catch {
        if (!cancelled) setSrc(null);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imageId]);

  if (!src) {
    return (
      <div
        className={className ? `${className} collection-thumb-placeholder` : 'collection-thumb-placeholder'}
      />
    );
  }
  return <img src={src} alt={alt} className={className} loading="lazy" />;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function mimeFromFilename(filename: string): string | null {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  return null;
}

async function blobToPngBlob(blob: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas context');
    ctx.drawImage(bmp, 0, 0);
    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
    });
    return png;
  } finally {
    bmp.close();
  }
}

async function copyImageToClipboard(blob: Blob, filename: string): Promise<void> {
  let mime = blob.type;
  if (!mime?.startsWith('image/')) {
    mime = mimeFromFilename(filename) || 'image/png';
    blob = new Blob([await blob.arrayBuffer()], { type: mime });
  }

  const write = (b: Blob, type: string) =>
    navigator.clipboard.write([new ClipboardItem({ [type]: Promise.resolve(b) })]);

  try {
    await write(blob, mime);
    return;
  } catch {
    /* WebP / odd types often rejected; PNG is widely accepted */
  }

  if (mime !== 'image/png') {
    const png = await blobToPngBlob(blob);
    await write(png, 'image/png');
    return;
  }

  throw new Error('clipboard write failed');
}

export default function CollectionPage() {
  const [folders, setFolders] = useState<CollectionFolder[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState<CollectionItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CollectionItem | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [folderMenuOpenId, setFolderMenuOpenId] = useState<string | null>(null);
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  const moveMenuRef = useRef<HTMLDivElement | null>(null);

  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renameFolder, setRenameFolder] = useState<CollectionFolder | null>(null);
  const [renameName, setRenameName] = useState('');
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<CollectionFolder | null>(null);

  const loadFolders = useCallback(async () => {
    try {
      const data = await listCollectionFolders();
      setFolders(data);
    } catch {
      /* ignore */
    }
  }, []);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listCollection(activeFolderId);
      setItems(data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [activeFolderId]);

  useEffect(() => {
    loadFolders();
  }, [loadFolders]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (!selectMode) setSelectedIds(new Set());
  }, [selectMode]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (moveMenuRef.current && !moveMenuRef.current.contains(e.target as Node)) {
        setMoveMenuOpen(false);
      }
      const t = e.target as HTMLElement;
      if (folderMenuOpenId && !t.closest('.collection-folder-chip-wrap')) {
        setFolderMenuOpenId(null);
      }
    };
    if (moveMenuOpen || folderMenuOpenId) document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [moveMenuOpen, folderMenuOpenId]);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleCopy = useCallback(async (item: CollectionItem) => {
    try {
      const blob = await fetchCollectionImageBlob(item.id);
      await copyImageToClipboard(blob, item.filename);
    } catch {
      alert('Failed to copy image to clipboard');
    }
  }, []);

  const handleDownload = useCallback(async (item: CollectionItem) => {
    try {
      const blob = await fetchCollectionImageBlob(item.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = item.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      alert('Failed to download image');
    }
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteCollectionItem(deleteTarget.id);
      setItems((prev) => prev.filter((i) => i.id !== deleteTarget.id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(deleteTarget.id);
        return next;
      });
      if (lightbox?.id === deleteTarget.id) setLightbox(null);
      loadFolders();
    } catch {
      alert('Failed to delete image');
    }
    setDeleteTarget(null);
  }, [deleteTarget, lightbox, loadFolders]);

  const submitCreateFolder = useCallback(async () => {
    try {
      const f = await createCollectionFolder(newFolderName);
      setCreateFolderOpen(false);
      setNewFolderName('');
      await loadFolders();
      setActiveFolderId(f.id);
    } catch {
      alert('Failed to create folder');
    }
  }, [newFolderName, loadFolders]);

  const submitRenameFolder = useCallback(async () => {
    if (!renameFolder) return;
    try {
      await renameCollectionFolder(renameFolder.id, renameName);
      setRenameFolder(null);
      await loadFolders();
    } catch {
      alert('Failed to rename folder');
    }
  }, [renameFolder, renameName, loadFolders]);

  const runMove = useCallback(
    async (targetFolderId: string | null) => {
      const ids = Array.from(selectedIds);
      if (!ids.length) return;
      try {
        await moveCollectionItems(ids, targetFolderId);
        setMoveMenuOpen(false);
        setSelectedIds(new Set());
        setSelectMode(false);
        await loadItems();
        await loadFolders();
      } catch {
        alert('Failed to move images');
      }
    },
    [selectedIds, loadItems, loadFolders],
  );

  const activeFolder = activeFolderId ? folders.find((f) => f.id === activeFolderId) : null;

  return (
    <div className="collection-page">
      <div className="collection-header">
        <h1 className="collection-title">Collection</h1>
        <span className="collection-count">
          {items.length} image{items.length !== 1 ? 's' : ''}
          {activeFolder ? ` — ${activeFolder.name}` : ' — ALL'}
        </span>
        <div className="collection-header-actions">
          <button
            type="button"
            className={`collection-select-toggle ${selectMode ? 'active' : ''}`}
            onClick={() => setSelectMode((v) => !v)}
          >
            {selectMode ? 'Cancel select' : 'Select'}
          </button>
          {selectMode && selectedIds.size > 0 && (
            <div className="collection-move-wrap" ref={moveMenuRef}>
              <button
                type="button"
                className="collection-move-btn"
                onClick={() => setMoveMenuOpen((o) => !o)}
              >
                Move to…
              </button>
              {moveMenuOpen && (
                <div className="collection-move-menu">
                  <button type="button" className="collection-move-menu-item" onClick={() => runMove(null)}>
                    ALL (unfiled)
                  </button>
                  {folders.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      className="collection-move-menu-item"
                      onClick={() => runMove(f.id)}
                    >
                      <ShelfIcon className="collection-move-menu-icon" />
                      {f.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="collection-folder-bar">
        <button
          type="button"
          className={`collection-folder-chip ${activeFolderId === null ? 'active' : ''}`}
          onClick={() => {
            setActiveFolderId(null);
            setFolderMenuOpenId(null);
          }}
        >
          ALL
        </button>
        {folders.map((f) => (
          <div key={f.id} className="collection-folder-chip-wrap">
            <button
              type="button"
              className={`collection-folder-chip ${activeFolderId === f.id ? 'active' : ''}`}
              onClick={() => {
                setActiveFolderId(f.id);
                setFolderMenuOpenId(null);
              }}
            >
              <ShelfIcon className="collection-folder-chip-icon" />
              <span className="collection-folder-chip-label">{f.name}</span>
            </button>
            <button
              type="button"
              className="collection-folder-chip-menu-btn"
              title="Folder options"
              onClick={(e) => {
                e.stopPropagation();
                setFolderMenuOpenId((id) => (id === f.id ? null : f.id));
              }}
            >
              ⋯
            </button>
            {folderMenuOpenId === f.id && (
              <div className="collection-folder-dropdown">
                <button
                  type="button"
                  className="collection-folder-dropdown-item"
                  onClick={() => {
                    setRenameFolder(f);
                    setRenameName(f.name);
                    setFolderMenuOpenId(null);
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="collection-folder-dropdown-item danger"
                  onClick={() => {
                    setDeleteFolderTarget(f);
                    setFolderMenuOpenId(null);
                  }}
                >
                  Delete folder…
                </button>
              </div>
            )}
          </div>
        ))}
        <button
          type="button"
          className="collection-folder-chip collection-folder-new"
          onClick={() => {
            setNewFolderName('');
            setCreateFolderOpen(true);
            setFolderMenuOpenId(null);
          }}
          title="New folder"
        >
          <ShelfIcon className="collection-folder-chip-icon" />+
        </button>
      </div>

      {loading ? (
        <div className="projects-empty">Loading...</div>
      ) : items.length === 0 ? (
        <div className="projects-empty">
          <p>{activeFolderId ? 'This folder is empty.' : 'No images yet.'}</p>
          {!activeFolderId && <p>Generated images will appear here automatically.</p>}
        </div>
      ) : (
        <div className="collection-grid">
          {items.map((item) => {
            const selected = selectedIds.has(item.id);
            return (
              <div
                key={item.id}
                className={`collection-item ${selectMode ? 'select-mode' : ''} ${selected ? 'selected' : ''}`}
                onClick={() => {
                  if (selectMode) toggleSelected(item.id);
                  else setLightbox(item);
                }}
              >
                {selectMode && (
                  <label className="collection-select-hit" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="collection-select-checkbox"
                      checked={selected}
                      onChange={() => toggleSelected(item.id)}
                    />
                  </label>
                )}
                <CollectionImage imageId={item.id} className="collection-thumb" />
                <div className="collection-overlay">
                  <div className="collection-overlay-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="collection-action-btn"
                      title="Copy to clipboard"
                      onClick={() => handleCopy(item)}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                    </button>
                    <button
                      className="collection-action-btn"
                      title="Download"
                      onClick={() => handleDownload(item)}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                    </button>
                    <button
                      className="collection-action-btn danger"
                      title="Delete"
                      onClick={() => setDeleteTarget(item)}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                  {item.width && item.height && (
                    <span className="collection-dims">
                      {item.width} x {item.height}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {lightbox && (
        <div className="lightbox-overlay" onClick={() => setLightbox(null)}>
          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            <CollectionImage imageId={lightbox.id} className="lightbox-image" />
            <div className="lightbox-bar">
              <span className="lightbox-info">
                {lightbox.width && lightbox.height
                  ? `${lightbox.width} x ${lightbox.height}`
                  : lightbox.filename}
                {' — '}
                {formatDate(lightbox.created_at)}
              </span>
              <div className="lightbox-actions">
                <button className="lightbox-btn" onClick={() => handleCopy(lightbox)} title="Copy to clipboard">
                  Copy
                </button>
                <button className="lightbox-btn" onClick={() => handleDownload(lightbox)} title="Download">
                  Download
                </button>
                <button
                  className="lightbox-btn danger"
                  onClick={() => setDeleteTarget(lightbox)}
                  title="Delete"
                >
                  Delete
                </button>
              </div>
            </div>
            <button className="lightbox-close" onClick={() => setLightbox(null)}>
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="confirm-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <p>Delete this image? This cannot be undone.</p>
            <div className="confirm-buttons">
              <button className="confirm-btn confirm-btn-cancel" onClick={() => setDeleteTarget(null)}>
                Cancel
              </button>
              <button className="confirm-btn confirm-btn-danger" onClick={confirmDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {createFolderOpen && (
        <div className="confirm-overlay" onClick={() => setCreateFolderOpen(false)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <p className="collection-modal-title">New folder</p>
            <input
              type="text"
              className="collection-modal-input"
              placeholder="Folder name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitCreateFolder();
              }}
            />
            <div className="confirm-buttons">
              <button className="confirm-btn confirm-btn-cancel" onClick={() => setCreateFolderOpen(false)}>
                Cancel
              </button>
              <button className="confirm-btn confirm-btn-primary" onClick={submitCreateFolder}>
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {renameFolder && (
        <div className="confirm-overlay" onClick={() => setRenameFolder(null)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <p className="collection-modal-title">Rename folder</p>
            <input
              type="text"
              className="collection-modal-input"
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitRenameFolder();
              }}
            />
            <div className="confirm-buttons">
              <button className="confirm-btn confirm-btn-cancel" onClick={() => setRenameFolder(null)}>
                Cancel
              </button>
              <button className="confirm-btn confirm-btn-primary" onClick={submitRenameFolder}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteFolderTarget && (
        <div className="confirm-overlay" onClick={() => setDeleteFolderTarget(null)}>
          <div className="confirm-dialog collection-delete-folder-dialog" onClick={(e) => e.stopPropagation()}>
            <p className="collection-modal-title">Delete “{deleteFolderTarget.name}”?</p>
            <p className="collection-modal-hint">
              Remove the folder only — images go back to ALL — or delete the folder and every image inside it.
            </p>
            <div className="confirm-buttons collection-delete-folder-buttons">
              <button className="confirm-btn confirm-btn-cancel" onClick={() => setDeleteFolderTarget(null)}>
                Cancel
              </button>
              <button
                className="confirm-btn confirm-btn-primary"
                onClick={async () => {
                  const id = deleteFolderTarget.id;
                  const wasActive = activeFolderId === id;
                  try {
                    await deleteCollectionFolder(id, 'unlink');
                    setDeleteFolderTarget(null);
                    if (wasActive) setActiveFolderId(null);
                    await loadFolders();
                    await loadItems();
                  } catch {
                    alert('Failed to remove folder');
                  }
                }}
              >
                Folder only
              </button>
              <button
                className="confirm-btn confirm-btn-danger"
                onClick={async () => {
                  const id = deleteFolderTarget.id;
                  const wasActive = activeFolderId === id;
                  try {
                    await deleteCollectionFolder(id, 'delete_items');
                    setDeleteFolderTarget(null);
                    if (wasActive) setActiveFolderId(null);
                    await loadFolders();
                    await loadItems();
                  } catch {
                    alert('Failed to delete folder');
                  }
                }}
              >
                Delete all
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
