import { useCallback, useRef, useState, useEffect } from 'react';
import { NavLink, useMatch, useNavigate } from 'react-router-dom';
import { useWorkflowStore } from '../store/workflowStore';
import AboutModal from './AboutModal';
import EditTemplateModal from './EditTemplateModal';
import {
  pinnedInputNodes,
  pinnedOutputNodes,
  suggestPinnedNodeIds,
} from '../types/templateTypes';
import Icon from '../icons/Icon';

export default function TitleBar() {
  const isWorkflowRoute = useMatch('/workflow/:id');
  const navigate = useNavigate();
  const workflowName = useWorkflowStore((s) => s.workflowName);
  const workflowDescription = useWorkflowStore((s) => s.workflowDescription);
  const saveNow = useWorkflowStore((s) => s.saveNow);
  const setWorkflowName = useWorkflowStore((s) => s.setWorkflowName);
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const template = useWorkflowStore((s) => s.template);

  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const [descOpen, setDescOpen] = useState(false);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
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

  const hasPinnedInputs = pinnedInputNodes(nodes).length > 0;
  const hasPinnedOutputs = pinnedOutputNodes(nodes).length > 0;
  const canSuggestPins = suggestPinnedNodeIds(nodes, edges).length > 0;
  const canOpenTemplateEditor =
    hasPinnedInputs || hasPinnedOutputs || canSuggestPins || template != null;
  const templateBtnTitle = !canOpenTemplateEditor
    ? 'Pin at least one node first'
    : template
      ? 'Edit template'
      : 'Set template';

  return (
    <div className="title-bar">
      <div className="title-bar-left">
        {isWorkflowRoute ? (
          <>
            <button
              type="button"
              className="title-bar-back icon-btn"
              onClick={handleBack}
              title="Back to Projects"
              aria-label="Back to Projects"
            >
              <Icon name="arrow-left-line" size={18} />
            </button>
            <div className="title-bar-workflow-row">
              <div className="title-bar-workflow-actions">
                <div className="title-bar-desc-anchor">
                  <button
                    ref={descBtnRef}
                    type="button"
                    className="title-bar-icon-btn icon-btn"
                    title="Workflow description"
                    aria-expanded={descOpen}
                    aria-label="Show workflow description"
                    onClick={() => setDescOpen((o) => !o)}
                  >
                    <Icon name="information-line" size={16} />
                  </button>
                  {descOpen && (
                    <div ref={descPopoverRef} className="title-bar-desc-popover" role="note">
                      {descPreview}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className={`title-bar-icon-btn icon-btn${template ? ' has-template' : ''}`}
                  title={templateBtnTitle}
                  aria-label={templateBtnTitle}
                  disabled={!canOpenTemplateEditor}
                  onClick={() => setTemplateModalOpen(true)}
                >
                  <Icon name="layout-grid-line" size={16} />
                </button>
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
            className="title-bar-brand-link"
            onClick={async (e) => {
              if (isWorkflowRoute && saveNow) {
                e.preventDefault();
                await saveNow();
                navigate('/');
              }
            }}
          >
            <img
              src="/SpotOn-Logo.svg"
              alt=""
              className="title-bar-logo"
              height={20}
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
          to="/playground"
          className={({ isActive }) =>
            `title-bar-tab${isActive ? ' active' : ''}`
          }
          onClick={async (e) => {
            if (isWorkflowRoute && saveNow) {
              e.preventDefault();
              await saveNow();
              navigate('/playground');
            }
          }}
        >
          Playground
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
        <button
          type="button"
          className={`title-bar-tab title-bar-about${aboutOpen ? ' active' : ''}`}
          onClick={() => setAboutOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={aboutOpen}
        >
          About
        </button>
      </div>
      <EditTemplateModal open={templateModalOpen} onClose={() => setTemplateModalOpen(false)} />
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </div>
  );
}
