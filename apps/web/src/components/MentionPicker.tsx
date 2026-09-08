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

export function MentionPicker({ targets, onSelect, onClose }: MentionPickerProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const roles = targets.filter((t) => t.kind === 'role');
  const members = targets.filter((t) => t.kind === 'member');
  const flatTargets = [...roles, ...members];

  useEffect(() => {
    setSelectedIndex(0);
  }, [targets.length]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!flatTargets.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % flatTargets.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + flatTargets.length) % flatTargets.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onSelect(flatTargets[selectedIndex]);
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [flatTargets, selectedIndex, onSelect, onClose]);

  useEffect(() => {
    if (!listRef.current) return;
    const selected = listRef.current.querySelector('.mention-item.selected');
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!flatTargets.length) return null;

  let globalIndex = -1;

  return (
    <div className="mention-picker" ref={listRef}>
      {roles.length > 0 && (
        <div className="mention-section">
          <div className="mention-section-title">AI 角色</div>
          {roles.map((t) => {
            globalIndex++;
            const idx = globalIndex;
            return (
              <button
                key={t.id}
                className={`mention-item role ${idx === selectedIndex ? 'selected' : ''}`}
                onClick={() => onSelect(t)}
                type="button"
              >
                <span className="mention-avatar" style={{ background: t.color ?? '#7457ff' }}>
                  {t.name.slice(0, 1)}
                </span>
                <span className="mention-name">{t.name}</span>
                <span className="mention-badge ai">AI</span>
              </button>
            );
          })}
        </div>
      )}
      {members.length > 0 && (
        <div className="mention-section">
          <div className="mention-section-title">人类成员</div>
          {members.map((t) => {
            globalIndex++;
            const idx = globalIndex;
            return (
              <button
                key={t.id}
                className={`mention-item member ${idx === selectedIndex ? 'selected' : ''}`}
                onClick={() => onSelect(t)}
                type="button"
              >
                <span className="mention-avatar" style={{ background: '#2871c9' }}>
                  {t.name.slice(0, 1)}
                </span>
                <span className="mention-name">{t.name}</span>
                {t.displayName && t.displayName !== t.name && (
                  <span className="mention-real">{t.displayName}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
