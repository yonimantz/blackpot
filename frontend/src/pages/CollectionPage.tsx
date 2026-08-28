import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  getCollectionImageObjectUrl,
  invalidateCollectionImageCache,
} from '../utils/collectionImageCache';
import { copyImageToClipboard, downloadBlob } from '../utils/imageObjectUrl';
import { GenerationMetaInfo } from '../components/GenerationMetaInfo';
import Icon from '../icons/Icon';

type SortKey = 'newest' | 'oldest' | 'largest' | 'smallest';
type OrientationFilter = 'all' | 'landscape' | 'portrait' | 'square';
type KindFilter = 'all' | 'image' | 'model3d';
type Density = 'comfortable' | 'compact';

type DateSectionKey = 'today' | 'yesterday' | 'week' | 'earlier';

const DATE_SECTION_LABELS: Record<DateSectionKey, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'This week',
  earlier: 'Earlier',
};

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
    getCollectionImageObjectUrl(imageId)
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
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

function isModel3d(item: CollectionItem): boolean {
  return item.kind === 'model3d';
}

/** Tile stand-in for a mesh whose generator returned no render. */
function Model3dTilePlaceholder({ className }: { className?: string }) {
  return (
    <div className={className ? `${className} collection-thumb-3d` : 'collection-thumb-3d'}>
      <Icon name="vector-group-line" size={40} />
      <span>3D model</span>
    </div>
  );
}

function CollectionThumb({ item, className }: { item: CollectionItem; className?: string }) {
  if (isModel3d(item) && item.has_thumb === false) {
    return <Model3dTilePlaceholder className={className} />;
  }
  return <CollectionImage imageId={item.id} className={className} />;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function pixelArea(item: CollectionItem): number {
  if (item.width && item.height) return item.width * item.height;
  return 0;
}

function itemOrientation(item: CollectionItem): OrientationFilter | 'unknown' {
  const { width, height } = item;
  if (!width || !height) return 'unknown';
  if (width === height) return 'square';
  return width > height ? 'landscape' : 'portrait';
}

function matchesOrientation(item: CollectionItem, filter: OrientationFilter): boolean {
  if (filter === 'all') return true;
  const o = itemOrientation(item);
  if (o === 'unknown') return true;
  return o === filter;
}

function matchesKind(item: CollectionItem, filter: KindFilter): boolean {
  if (filter === 'all') return true;
  return (item.kind ?? 'image') === filter;
}

function sortItems(list: CollectionItem[], sortKey: SortKey): CollectionItem[] {
  const copy = [...list];
  copy.sort((a, b) => {
    if (sortKey === 'newest') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    if (sortKey === 'oldest') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    if (sortKey === 'largest') return pixelArea(b) - pixelArea(a);
    return pixelArea(a) - pixelArea(b);
  });
  return copy;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function dateSectionKey(iso: string): DateSectionKey {
  const created = new Date(iso);
  const now = new Date();
  const today = startOfDay(now);
  const createdDay = startOfDay(created);
  const diffDays = Math.floor((today.getTime() - createdDay.getTime()) / 86400000);
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return 'week';
  return 'earlier';
}

function groupByDateSection(items: CollectionItem[]): { key: DateSectionKey; items: CollectionItem[] }[] {
  const order: DateSectionKey[] = ['today', 'yesterday', 'week', 'earlier'];
  const buckets = new Map<DateSectionKey, CollectionItem[]>();
  for (const key of order) buckets.set(key, []);
  for (const item of items) {
    const key = dateSectionKey(item.created_at);
    buckets.get(key)!.push(item);
  }
  return order
    .map((key) => ({ key, items: buckets.get(key)! }))
    .filter((g) => g.items.length > 0);
}

const DRAG_MIME = 'application/x-spoton-collection-ids';

function CollectionSkeletonGrid({ density }: { density: Density }) {
  const n = density === 'compact' ? 16 : 12;
  return (
    <div className={`collection-grid collection-grid--${density}`}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="collection-item collection-skeleton-tile" aria-hidden />
      ))}
    </div>
  );
}

function EmptyCollectionState({ inFolder }: { inFolder: boolean }) {
  return (
    <div className="collection-empty">
      <div className="collection-empty-icon" aria-hidden>
        <Icon name="pic-2-line" size={48} />
      </div>
      {inFolder ? (
        <>
          <p className="collection-empty-title">This folder is empty</p>
          <p className="collection-empty-hint">Move items here from Unfiled or other folders.</p>
        </>
      ) : (
        <>
          <p className="collection-empty-title">No unfiled items</p>
          <p className="collection-empty-hint">
            Generated images and 3D models land here until you organize them into folders.
          </p>
        </>
      )}
    </div>
  );
}

export default function CollectionPage() {
  const [folders, setFolders] = useState<CollectionFolder[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [unfiledCount, setUnfiledCount] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('newest');
  const [orientationFilter, setOrientationFilter] = useState<OrientationFilter>('all');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [density, setDensity] = useState<Density>('comfortable');
  const [lightbox, setLightbox] = useState<CollectionItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CollectionItem | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [folderMenuOpenId, setFolderMenuOpenId] = useState<string | null>(null);
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  const [dropTargetFolderId, setDropTargetFolderId] = useState<string | 'unfiled' | null>(null);
  const moveMenuRef = useRef<HTMLDivElement | null>(null);
  const lastSelectIndexRef = useRef<number | null>(null);

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
      if (activeFolderId === null) setUnfiledCount(data.length);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [activeFolderId]);

  const displayItems = useMemo(() => {
    const filtered = items.filter(
      (i) => matchesKind(i, kindFilter) && matchesOrientation(i, orientationFilter),
    );
    return sortItems(filtered, sortKey);
  }, [items, kindFilter, orientationFilter, sortKey]);

  const groupedSections = useMemo(() => groupByDateSection(displayItems), [displayItems]);

  const lightboxIndex = lightbox ? displayItems.findIndex((i) => i.id === lightbox.id) : -1;

  useEffect(() => {
    loadFolders();
  }, [loadFolders]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (!selectMode) {
      setSelectedIds(new Set());
      lastSelectIndexRef.current = null;
    }
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

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLightbox(null);
        return;
      }
      if (displayItems.length < 2) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const idx = lightboxIndex <= 0 ? displayItems.length - 1 : lightboxIndex - 1;
        setLightbox(displayItems[idx]);
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        const idx = lightboxIndex < 0 || lightboxIndex >= displayItems.length - 1 ? 0 : lightboxIndex + 1;
        setLightbox(displayItems[idx]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox, displayItems, lightboxIndex]);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleItemSelectClick = useCallback(
    (item: CollectionItem, flatIndex: number, shiftKey: boolean) => {
      if (!selectMode) return;
      if (shiftKey && lastSelectIndexRef.current != null) {
        const from = Math.min(lastSelectIndexRef.current, flatIndex);
        const to = Math.max(lastSelectIndexRef.current, flatIndex);
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (let i = from; i <= to; i++) next.add(displayItems[i].id);
          return next;
        });
      } else {
        toggleSelected(item.id);
        lastSelectIndexRef.current = flatIndex;
      }
    },
    [selectMode, displayItems, toggleSelected],
  );

  const selectAllVisible = useCallback(() => {
    setSelectedIds(new Set(displayItems.map((i) => i.id)));
  }, [displayItems]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    lastSelectIndexRef.current = null;
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
      downloadBlob(blob, item.filename);
    } catch {
      alert(isModel3d(item) ? 'Failed to download 3D model' : 'Failed to download image');
    }
  }, []);

  const handleBulkDownload = useCallback(async () => {
    const ids = Array.from(selectedIds);
    for (const id of ids) {
      const item = items.find((i) => i.id === id);
      if (item) await handleDownload(item);
    }
  }, [selectedIds, items, handleDownload]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteCollectionItem(deleteTarget.id);
      invalidateCollectionImageCache(deleteTarget.id);
      setItems((prev) => prev.filter((i) => i.id !== deleteTarget.id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(deleteTarget.id);
        return next;
      });
      if (lightbox?.id === deleteTarget.id) setLightbox(null);
      loadFolders();
    } catch {
      alert('Failed to delete item');
    }
    setDeleteTarget(null);
  }, [deleteTarget, lightbox, loadFolders]);

  const confirmBulkDelete = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    try {
      for (const id of ids) {
        await deleteCollectionItem(id);
        invalidateCollectionImageCache(id);
      }
      setItems((prev) => prev.filter((i) => !selectedIds.has(i.id)));
      if (lightbox && selectedIds.has(lightbox.id)) setLightbox(null);
      setSelectedIds(new Set());
      setSelectMode(false);
      setBulkDeleteOpen(false);
      await loadFolders();
      await loadItems();
    } catch {
      alert('Failed to delete some items');
    }
  }, [selectedIds, lightbox, loadFolders, loadItems]);

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
    async (targetFolderId: string | null, idsOverride?: string[]) => {
      const ids = idsOverride ?? Array.from(selectedIds);
      if (!ids.length) return;
      try {
        await moveCollectionItems(ids, targetFolderId);
        setMoveMenuOpen(false);
        setSelectedIds(new Set());
        setSelectMode(false);
        await loadItems();
        await loadFolders();
      } catch {
        alert('Failed to move items');
      }
    },
    [selectedIds, loadItems, loadFolders],
  );

  const parseDragIds = (e: React.DragEvent): string[] => {
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as string[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const onItemDragStart = (e: React.DragEvent, item: CollectionItem) => {
    const ids =
      selectMode && selectedIds.has(item.id) && selectedIds.size > 0
        ? Array.from(selectedIds)
        : [item.id];
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'move';
  };

  const folderDropHandlers = (targetFolderId: string | null, dropKey: string | 'unfiled') => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropTargetFolderId(dropKey);
    },
    onDragLeave: () => {
      setDropTargetFolderId((cur) => (cur === dropKey ? null : cur));
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDropTargetFolderId(null);
      const ids = parseDragIds(e);
      if (ids.length) void runMove(targetFolderId, ids);
    },
  });

  const activeFolder = activeFolderId ? folders.find((f) => f.id === activeFolderId) : null;
  let flatIndex = 0;

  const navigateLightbox = (delta: number) => {
    if (displayItems.length === 0) return;
    const idx = lightboxIndex < 0 ? 0 : (lightboxIndex + delta + displayItems.length) % displayItems.length;
    setLightbox(displayItems[idx]);
  };

  return (
    <div className="collection-page">
      <div className="collection-header">
        <h1 className="collection-title">Collection</h1>
        <span className="collection-count">
          {loading ? '…' : `${displayItems.length} shown`}
          {!loading && items.length !== displayItems.length ? ` of ${items.length}` : ''}
          {activeFolder ? ` — ${activeFolder.name}` : ' — Unfiled'}
        </span>
        <div className="collection-header-actions">
          {selectMode && (
            <>
              <span className="collection-selected-count">{selectedIds.size} selected</span>
              <button type="button" className="collection-toolbar-btn" onClick={selectAllVisible}>
                Select all
              </button>
              <button type="button" className="collection-toolbar-btn" onClick={clearSelection}>
                Clear
              </button>
            </>
          )}
          <button
            type="button"
            className={`collection-select-toggle ${selectMode ? 'active' : ''}`}
            onClick={() => setSelectMode((v) => !v)}
          >
            {selectMode ? 'Cancel select' : 'Select'}
          </button>
          {selectMode && selectedIds.size > 0 && (
            <>
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
                      Unfiled
                    </button>
                    {folders.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        className="collection-move-menu-item"
                        onClick={() => runMove(f.id)}
                      >
                        <Icon name="folder-line" size={14} className="collection-move-menu-icon" />
                        {f.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button type="button" className="collection-toolbar-btn" onClick={() => void handleBulkDownload()}>
                Download
              </button>
              <button
                type="button"
                className="collection-toolbar-btn collection-toolbar-btn-danger"
                onClick={() => setBulkDeleteOpen(true)}
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      <div className="collection-toolbar">
        <label className="collection-toolbar-field">
          <span className="collection-toolbar-label">Sort</span>
          <select
            className="collection-toolbar-select"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="largest">Largest</option>
            <option value="smallest">Smallest</option>
          </select>
        </label>
        <label className="collection-toolbar-field">
          <span className="collection-toolbar-label">Type</span>
          <select
            className="collection-toolbar-select"
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as KindFilter)}
          >
            <option value="all">All</option>
            <option value="image">Images</option>
            <option value="model3d">3D models</option>
          </select>
        </label>
        <label className="collection-toolbar-field">
          <span className="collection-toolbar-label">Orientation</span>
          <select
            className="collection-toolbar-select"
            value={orientationFilter}
            onChange={(e) => setOrientationFilter(e.target.value as OrientationFilter)}
          >
            <option value="all">All</option>
            <option value="landscape">Landscape</option>
            <option value="portrait">Portrait</option>
            <option value="square">Square</option>
          </select>
        </label>
        <div className="collection-density-toggle" role="group" aria-label="Grid density">
          <button
            type="button"
            className={`collection-density-btn ${density === 'comfortable' ? 'active' : ''}`}
            onClick={() => setDensity('comfortable')}
          >
            Comfortable
          </button>
          <button
            type="button"
            className={`collection-density-btn ${density === 'compact' ? 'active' : ''}`}
            onClick={() => setDensity('compact')}
          >
            Compact
          </button>
        </div>
      </div>

      <div className="collection-folder-bar">
        <button
          type="button"
          className={`collection-folder-chip ${activeFolderId === null ? 'active' : ''} ${dropTargetFolderId === 'unfiled' ? 'drop-target' : ''}`}
          title="Items not in any folder"
          onClick={() => {
            setActiveFolderId(null);
            setFolderMenuOpenId(null);
          }}
          {...folderDropHandlers(null, 'unfiled')}
        >
          Unfiled
          {unfiledCount != null && <span className="collection-folder-count">{unfiledCount}</span>}
        </button>
        {folders.map((f) => (
          <div key={f.id} className="collection-folder-chip-wrap">
            <button
              type="button"
              className={`collection-folder-chip ${activeFolderId === f.id ? 'active' : ''} ${dropTargetFolderId === f.id ? 'drop-target' : ''}`}
              onClick={() => {
                setActiveFolderId(f.id);
                setFolderMenuOpenId(null);
              }}
              {...folderDropHandlers(f.id, f.id)}
            >
              <Icon name="folder-line" size={14} className="collection-folder-chip-icon" />
              <span className="collection-folder-chip-label">{f.name}</span>
              <span className="collection-folder-count">{f.item_count}</span>
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
              <Icon name="more-1-line" size={14} />
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
          <Icon name="new-folder-line" size={14} className="collection-folder-chip-icon" />
        </button>
      </div>

      {loading ? (
        <CollectionSkeletonGrid density={density} />
      ) : items.length === 0 ? (
        <EmptyCollectionState inFolder={activeFolderId != null} />
      ) : displayItems.length === 0 ? (
        <div className="collection-empty">
          <p className="collection-empty-title">Nothing matches these filters</p>
          <p className="collection-empty-hint">Try a different type or orientation filter.</p>
        </div>
      ) : (
        <div className="collection-sections">
          {groupedSections.map((section) => (
            <section key={section.key} className="collection-date-section">
              <h2 className="collection-date-section-title">{DATE_SECTION_LABELS[section.key]}</h2>
              <div className={`collection-grid collection-grid--${density}`}>
                {section.items.map((item) => {
                  const idx = flatIndex++;
                  const selected = selectedIds.has(item.id);
                  return (
                    <div
                      key={item.id}
                      className={`collection-item ${selectMode ? 'select-mode' : ''} ${selected ? 'selected' : ''}`}
                      draggable
                      onDragStart={(e) => onItemDragStart(e, item)}
                      onClick={(e) => {
                        if (selectMode) handleItemSelectClick(item, idx, e.shiftKey);
                        else setLightbox(item);
                      }}
                    >
                      {selectMode && (
                        <label className="collection-select-hit" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="collection-select-checkbox"
                            checked={selected}
                            onChange={() => {
                              toggleSelected(item.id);
                              lastSelectIndexRef.current = idx;
                            }}
                          />
                        </label>
                      )}
                      <CollectionThumb item={item} className="collection-thumb" />
                      {isModel3d(item) && <span className="collection-kind-badge">GLB</span>}
                      <div className="collection-overlay">
                        <div className="collection-overlay-actions" onClick={(e) => e.stopPropagation()}>
                          {!isModel3d(item) && (
                            <button
                              className="collection-action-btn"
                              title="Copy to clipboard"
                              onClick={() => handleCopy(item)}
                            >
                              <Icon name="copy-2-line" size={16} />
                            </button>
                          )}
                          <button
                            className="collection-action-btn"
                            title={isModel3d(item) ? 'Download GLB' : 'Download'}
                            onClick={() => handleDownload(item)}
                          >
                            <Icon name="download-2-line" size={16} />
                          </button>
                          <button
                            className="collection-action-btn danger"
                            title="Delete"
                            onClick={() => setDeleteTarget(item)}
                          >
                            <Icon name="delete-2-line" size={16} />
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
            </section>
          ))}
        </div>
      )}

      {lightbox && (
        <div className="lightbox-overlay" onClick={() => setLightbox(null)}>
          {displayItems.length > 1 && (
            <button
              type="button"
              className="lightbox-nav lightbox-nav-prev"
              aria-label="Previous image"
              onClick={(e) => {
                e.stopPropagation();
                navigateLightbox(-1);
              }}
            >
              <Icon name="left-line" size={22} />
            </button>
          )}
          <div className="lightbox-content-wrap" onClick={(e) => e.stopPropagation()}>
            <div className="lightbox-content">
              <CollectionThumb item={lightbox} className="lightbox-image" />
              <GenerationMetaInfo
                className="lightbox-gen-meta"
                meta={{
                  prompt: lightbox.prompt,
                  seed: lightbox.seed,
                  model: lightbox.model,
                }}
              />
              <div className="lightbox-bar">
                <span className="lightbox-info">
                  {isModel3d(lightbox)
                    ? '3D model (GLB)'
                    : lightbox.width && lightbox.height
                      ? `${lightbox.width} x ${lightbox.height}`
                      : lightbox.filename}
                  {' — '}
                  {formatDate(lightbox.created_at)}
                  {displayItems.length > 1 && lightboxIndex >= 0 && (
                    <> · {lightboxIndex + 1} / {displayItems.length}</>
                  )}
                </span>
                <div className="lightbox-actions">
                  {!isModel3d(lightbox) && (
                    <button className="lightbox-btn" onClick={() => handleCopy(lightbox)} title="Copy to clipboard">
                      Copy
                    </button>
                  )}
                  <button
                    className="lightbox-btn"
                    onClick={() => handleDownload(lightbox)}
                    title={isModel3d(lightbox) ? 'Download GLB' : 'Download'}
                  >
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
            </div>
            <button className="lightbox-close" onClick={() => setLightbox(null)} aria-label="Close" title="Close">
              <Icon name="close-line" size={24} />
            </button>
          </div>
          {displayItems.length > 1 && (
            <button
              type="button"
              className="lightbox-nav lightbox-nav-next"
              aria-label="Next image"
              onClick={(e) => {
                e.stopPropagation();
                navigateLightbox(1);
              }}
            >
              <Icon name="right-line" size={22} />
            </button>
          )}
        </div>
      )}

      {deleteTarget && (
        <div className="confirm-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <p>
              Delete this {isModel3d(deleteTarget) ? '3D model' : 'image'}? This cannot be undone.
            </p>
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

      {bulkDeleteOpen && (
        <div className="confirm-overlay" onClick={() => setBulkDeleteOpen(false)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <p>
              Delete {selectedIds.size} item{selectedIds.size !== 1 ? 's' : ''}? This cannot be undone.
            </p>
            <div className="confirm-buttons">
              <button className="confirm-btn confirm-btn-cancel" onClick={() => setBulkDeleteOpen(false)}>
                Cancel
              </button>
              <button className="confirm-btn confirm-btn-danger" onClick={() => void confirmBulkDelete()}>
                Delete all
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
              Remove the folder only — items go back to Unfiled — or delete the folder and everything inside it.
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
