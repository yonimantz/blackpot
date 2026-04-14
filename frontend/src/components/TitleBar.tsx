import { NavLink, useMatch, useNavigate } from 'react-router-dom';
import { useWorkflowStore } from '../store/workflowStore';
import { useCallback, useRef, useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';

export default function TitleBar() {
  const { firebaseEnabled, user, signOutUser } = useAuth();
  const isWorkflowRoute = useMatch('/workflow/:id');
  const navigate = useNavigate();
  const workflowName = useWorkflowStore((s) => s.workflowName);
  const workflowDescription = useWorkflowStore((s) => s.workflowDescription);
  const saveNow = useWorkflowStore((s) => s.saveNow);
  const setWorkflowName = useWorkflowStore((s) => s.setWorkflowName);

  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const [descOpen, setDescOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const descPopoverRef = useRef<HTMLDivElement>(null);
  const descBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (renaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renaming]);

  useEffect(() => {
    if (!descOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (descPopoverRef.current?.contains(t)) return;
      if (descBtnRef.current?.contains(t)) return;
      setDescOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDescOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [descOpen]);

  const handleBack = useCallback(async () => {
    if (saveNow) await saveNow();
    navigate('/');
  }, [navigate, saveNow]);

  const commitName = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== workflowName && setWorkflowName) {
      setWorkflowName(trimmed);
    }
    setRenaming(false);
  }, [draft, workflowName, setWorkflowName]);

  const descText = (workflowDescription || '').trim();
  const descPreview =
    descText ||
    'No description. Double-click the workflow name to rename. To set an icon or this note, open Details on this workflow’s card in Projects.';

  return (
    <div className="title-bar">
      <div className="title-bar-left">
        {isWorkflowRoute ? (
          <>
            <button className="title-bar-back" onClick={handleBack} title="Back to Projects">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <div className="title-bar-workflow-row">
              <div className="title-bar-workflow-actions">
                <div className="title-bar-desc-anchor">
                  <button
                    ref={descBtnRef}
                    type="button"
                    className="title-bar-icon-btn"
                    title="Workflow description"
                    aria-expanded={descOpen}
                    aria-label="Show workflow description"
                    onClick={() => setDescOpen((o) => !o)}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 16v-4M12 8h.01" />
                    </svg>
                  </button>
                  {descOpen && (
                    <div ref={descPopoverRef} className="title-bar-desc-popover" role="note">
                      {descPreview}
                    </div>
                  )}
                </div>
              </div>
              {renaming ? (
                <input
                  ref={inputRef}
                  className="title-bar-name-input"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitName}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitName();
                    if (e.key === 'Escape') setRenaming(false);
                  }}
                />
              ) : (
                <span
                  className="title-bar-workflow-name"
                  onDoubleClick={() => {
                    setDraft(workflowName || '');
                    setRenaming(true);
                  }}
                  title="Double-click to rename"
                >
                  {workflowName || 'Untitled Workflow'}
                </span>
              )}
            </div>
          </>
        ) : (
          <NavLink
            to="/"
            end
            aria-label="Home"
            className={({ isActive }) =>
              `title-bar-brand-link${isActive ? ' title-bar-brand-link--active' : ''}`
            }
            onClick={async (e) => {
              if (isWorkflowRoute && saveNow) {
                e.preventDefault();
                await saveNow();
                navigate('/');
              }
            }}
          >
            <img
              src="/Logo2.svg"
              alt=""
              className="title-bar-logo"
              height={28}
            />
          </NavLink>
        )}
      </div>

      <nav className="title-bar-nav">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `title-bar-tab${isActive && !isWorkflowRoute ? ' active' : ''}`
          }
          onClick={async (e) => {
            if (isWorkflowRoute && saveNow) {
              e.preventDefault();
              await saveNow();
              navigate('/');
            }
          }}
        >
          Projects
        </NavLink>
        <NavLink
          to="/collection"
          className={({ isActive }) =>
            `title-bar-tab${isActive ? ' active' : ''}`
          }
          onClick={async (e) => {
            if (isWorkflowRoute && saveNow) {
              e.preventDefault();
              await saveNow();
              navigate('/collection');
            }
          }}
        >
          Collection
        </NavLink>
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `title-bar-tab${isActive ? ' active' : ''}`
          }
          onClick={async (e) => {
            if (isWorkflowRoute && saveNow) {
              e.preventDefault();
              await saveNow();
              navigate('/settings');
            }
          }}
        >
          Settings
        </NavLink>
      </nav>

      <div className="title-bar-right">
        {firebaseEnabled && user && (
          <button
            type="button"
            className="title-bar-signout"
            onClick={() => signOutUser()}
            title="Sign out"
          >
            Sign out
          </button>
        )}
      </div>
    </div>
  );
}
