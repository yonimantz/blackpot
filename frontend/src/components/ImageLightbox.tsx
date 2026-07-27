import { useCallback, useEffect } from 'react';
import {
  copyImageToClipboard,
  downloadBlob,
  imageSrcToBlob,
} from '../utils/imageObjectUrl';

export interface LightboxImage {
  src: string;
  label: string;
  filename: string;
}

export default function ImageLightbox({
  images,
  index,
  onIndexChange,
  onClose,
}: {
  images: LightboxImage[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
}) {
  const current = images[index];
  const count = images.length;

  const navigate = useCallback(
    (delta: number) => {
      if (count === 0) return;
      const next = (index + delta + count) % count;
      onIndexChange(next);
    },
    [count, index, onIndexChange],
  );

  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (count < 2) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        navigate(-1);
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        navigate(1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, count, navigate, onClose]);

  if (!current) return null;

  const handleCopy = async () => {
    try {
      const blob = await imageSrcToBlob(current.src, current.filename);
      await copyImageToClipboard(blob, current.filename);
    } catch {
      alert('Failed to copy image to clipboard');
    }
  };

  const handleDownload = async () => {
    try {
      const blob = await imageSrcToBlob(current.src, current.filename);
      downloadBlob(blob, current.filename);
    } catch {
      alert('Failed to download image');
    }
  };

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      {count > 1 && (
        <button
          type="button"
          className="lightbox-nav lightbox-nav-prev"
          aria-label="Previous image"
          onClick={(e) => {
            e.stopPropagation();
            navigate(-1);
          }}
        >
          ‹
        </button>
      )}
      <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
        <img src={current.src} alt={current.label} className="lightbox-image" />
        <div className="lightbox-bar">
          <span className="lightbox-info">
            {current.label}
            {count > 1 ? ` — ${index + 1} / ${count}` : ''}
          </span>
          <div className="lightbox-actions">
            <button type="button" className="lightbox-btn" onClick={() => void handleCopy()} title="Copy to clipboard">
              Copy
            </button>
            <button type="button" className="lightbox-btn" onClick={() => void handleDownload()} title="Download">
              Download
            </button>
          </div>
        </div>
        <button type="button" className="lightbox-close" onClick={onClose} aria-label="Close">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      {count > 1 && (
        <button
          type="button"
          className="lightbox-nav lightbox-nav-next"
          aria-label="Next image"
          onClick={(e) => {
            e.stopPropagation();
            navigate(1);
          }}
        >
          ›
        </button>
      )}
    </div>
  );
}
