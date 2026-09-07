import { useEffect, useRef, useState } from 'react';

export interface MentionTarget {
  id: string;
  name: string;
  kind: 'role' | 'member';
  color?: string;
  displayName?: string;
}

interface MentionPickerProps {
  targets: MentionTarget[];
  anchorRef: React.RefObject<HTMLElement>;
  onSelect: (target: MentionTarget) => void;
  onClose: () => void;
}

export function MentionPicker({ targets, anchorRef, onSelect, onClose }: MentionPickerProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelectedIndex(0);
  }, [targets.length]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!targets.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % targets.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + targets.length) % targets.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onSelect(targets[selectedIndex]);
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [targets, selectedIndex, onSelect, onClose]);

  useEffect(() => {
    if (!listRef.current) return;
    const selected = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!targets.length) return null;

  const anchor = anchorRef.current;
  const top = anchor ? anchor.getBoundingClientRect().top - 8 : 0;

  return (
    <div className="mention-picker" style={{ top }} ref={listRef}>
      {targets.map((t, i) => (
        <button
          key={t.id}
          className={`mention-item ${t.kind} ${i === selectedIndex ? 'selected' : ''}`}
          onClick={() => onSelect(t)}
          type="button"
        >
          <span className="mention-avatar" style={{ background: t.color ?? '#2871c9' }}>
            {t.name.slice(0, 1)}
          </span>
          <span className="mention-name">{t.name}</span>
          {t.kind === 'member' && t.displayName && t.displayName !== t.name && (
            <span className="mention-real">{t.displayName}</span>
          )}
        </button>
      ))}
    </div>
  );
}
