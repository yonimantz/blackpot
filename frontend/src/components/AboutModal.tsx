import { useEffect } from 'react';
import Icon from '../icons/Icon';

export default function AboutModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="confirm-overlay" onClick={onClose}>
      <div
        className="confirm-dialog about-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="about-title"
        aria-modal="true"
      >
        <button
          type="button"
          className="compositor-modal-close about-dialog-close"
          onClick={onClose}
          aria-label="Close"
          title="Close"
        >
          <Icon name="close-line" size={18} />
        </button>

        <img
          src="/SpotOn-Logo.svg"
          alt="SpotOn"
          className="about-dialog-logo"
        />

        <p id="about-title" className="about-dialog-credit">
          Made by Yonatan Mantzur
        </p>
        <p className="about-dialog-titles">
          Concept Lead, Game artist, Prototyper
        </p>
      </div>
    </div>
  );
}
