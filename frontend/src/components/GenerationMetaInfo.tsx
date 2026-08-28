import { useCallback, useState } from 'react';

export type GenerationMeta = {
  prompt?: string | null;
  seed?: number | null;
  model?: string | null;
};

function formatSeed(seed: number | null | undefined): string {
  if (seed == null) return 'Not supported';
  return String(seed);
}

function hasAnyMeta(meta: GenerationMeta | null | undefined): boolean {
  if (!meta) return false;
  return Boolean(
    (meta.prompt && meta.prompt.trim()) ||
      meta.seed != null ||
      (meta.model && meta.model.trim()),
  );
}

export function GenerationMetaInfo({
  meta,
  className,
}: {
  meta: GenerationMeta | null | undefined;
  className?: string;
}) {
  const [copied, setCopied] = useState<'prompt' | 'seed' | null>(null);

  const copyText = useCallback(async (text: string, kind: 'prompt' | 'seed') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      /* ignore */
    }
  }, []);

  if (!hasAnyMeta(meta)) return null;

  const prompt = meta?.prompt?.trim() ?? '';
  const model = meta?.model?.trim() ?? '';
  const seedLabel = formatSeed(meta?.seed);

  return (
    <div className={`gen-meta-block${className ? ` ${className}` : ''}`}>
      {prompt ? (
        <div className="gen-meta-prompt-wrap">
          <div className="gen-meta-prompt-header">
            <span className="size-result-label">Prompt</span>
            <button
              type="button"
              className="gen-meta-copy-btn"
              onClick={() => copyText(prompt, 'prompt')}
              title="Copy prompt"
            >
              {copied === 'prompt' ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="gen-meta-prompt">{prompt}</div>
        </div>
      ) : null}
      <div className="size-result-row">
        <span className="size-result-label">Seed</span>
        <span className="size-result-value gen-meta-seed-row">
          <span>{seedLabel}</span>
          {meta?.seed != null ? (
            <button
              type="button"
              className="gen-meta-copy-btn inline"
              onClick={() => copyText(String(meta.seed), 'seed')}
              title="Copy seed"
            >
              {copied === 'seed' ? 'Copied' : 'Copy'}
            </button>
          ) : null}
        </span>
      </div>
      {model ? (
        <div className="size-result-row">
          <span className="size-result-label">Model</span>
          <span className="size-result-value">{model}</span>
        </div>
      ) : null}
    </div>
  );
}
