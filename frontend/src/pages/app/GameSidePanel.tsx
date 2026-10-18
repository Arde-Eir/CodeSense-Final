import React, { useEffect, useId, useState } from 'react';
import type { ActivityTab, HintItem, Quest } from '@/types/campaign';
import { HINT_XP_COST } from '@/campaign/retakeXp';

export const GameSidePanel: React.FC<{
  quest:           Quest;
  /** Hints for the active tab and question, composed by the parent. */
  tabHints:        HintItem[];
  hintsUsed:       number;
  totalHintsUsed:  number;
  maxHints:        number;
  earnedXP:        number;
  rewardBaseXP:    number;
  rewardPenaltyXP: number;
  rewardPenaltyCapped: boolean;
  isCompleted:     boolean;
  onTakeHint:      () => void;
  activeTab:       ActivityTab;
  hasNextQuest:    boolean;
  onNextQuest:     () => void;
}> = ({ quest, tabHints, hintsUsed, totalHintsUsed, maxHints, earnedXP, rewardBaseXP, rewardPenaltyXP, rewardPenaltyCapped, isCompleted, onTakeHint, activeTab: _activeTab, hasNextQuest, onNextQuest }) => {
  const [activeHint, setActiveHint] = useState<number | null>(null);
  const hintId = useId();
  const noHintsAvailable = tabHints.length === 0;
  const allHintsUsed     = !noHintsAvailable && hintsUsed >= maxHints;
  const buttonDisabled   = noHintsAvailable || allHintsUsed || isCompleted;
  const unlocked: HintItem[] = tabHints.slice(0, hintsUsed);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setActiveHint(hintsUsed > 0 ? hintsUsed - 1 : null);
    });
    return () => { cancelled = true; };
  }, [hintsUsed, _activeTab]);

  return (
    <div className="la-side-content" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, height: '100%', overflow: 'hidden', borderLeft: '1px solid #21262d', background: '#0d1117' }}>
      <div className="la-side-scroll" data-testid="objectives-hints-scroll" role="region" aria-label="Objectives and hints" tabIndex={0}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowWrap: 'anywhere' }}>
        <div className="la-objectives" style={{ padding: '14px 18px', borderBottom: '1px solid #21262d', flexShrink: 0 }}>
          <div className="la-help-label" style={{ fontSize: 9, color: '#484f58', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 10 }}>OBJECTIVES</div>
          {(quest.objectives ?? []).map((obj, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
              <span style={{ color: '#3fb950', fontSize: 11, marginTop: 1, flexShrink: 0 }}>✦</span>
              <span className="la-help-text" style={{ fontSize: 12, color: '#8b949e', lineHeight: 1.5, fontFamily: 'Inter,sans-serif' }}>{obj}</span>
            </div>
          ))}
        </div>
        <div className="la-hints" style={{ padding: '14px 18px' }}>
          <div className="la-help-label" style={{ fontSize: 9, color: '#484f58', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 10 }}>HINTS</div>
          {unlocked.length === 0 && (
            <div className="la-help-text" style={{ fontSize: 12, color: '#484f58', fontFamily: 'Inter,sans-serif', fontStyle: 'italic' }}>
              {noHintsAvailable
                ? 'No hints available for this activity.'
                : `Hints are hidden until you use the button below. Each hint costs ${HINT_XP_COST} XP.`}
            </div>
          )}
          {unlocked.map((hint, i) => (
            <div key={i} style={{ marginBottom: 10, borderRadius: 8, border: '1px solid rgba(88,166,255,0.2)', background: 'rgba(88,166,255,0.05)', overflow: 'hidden' }}>
              <button type="button" data-testid={`hint-toggle-${i}`} aria-expanded={activeHint === i} aria-controls={`${hintId}-${i}`} onClick={() => setActiveHint(activeHint === i ? null : i)} style={{ width: '100%', padding: '10px 12px', background: 'transparent', border: 'none', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ fontSize: 14 }}>{hint.icon ?? '💡'}</span>
                <span className="la-help-text" style={{ fontSize: 12, fontWeight: 700, color: '#58a6ff', fontFamily: 'Inter,sans-serif', flex: 1 }}>{hint.title}</span>
                <span style={{ fontSize: 10, color: '#484f58' }}>{activeHint === i ? '▲' : '▼'}</span>
              </button>
              {activeHint === i && (
                <div id={`${hintId}-${i}`} className="la-help-text" data-testid={`hint-body-${i}`} style={{ padding: '0 12px 12px', fontSize: 12, color: '#8b949e', lineHeight: 1.6, fontFamily: 'Inter,sans-serif' }}>{hint.body}</div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="la-reward-footer" style={{ padding: '14px 18px', paddingBottom: 'calc(14px + env(safe-area-inset-bottom))', borderTop: '1px solid #21262d', flexShrink: 0 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 10, color: '#484f58', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '1px' }}>XP REWARD</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: '#facc15', fontFamily: "'JetBrains Mono',monospace" }}>{earnedXP} XP</span>
        </div>
        {!isCompleted && (
          <div style={{ fontSize: 11, color: '#8b949e', fontFamily: 'Inter,sans-serif', marginBottom: 10, lineHeight: 1.5 }}>
            Base {rewardBaseXP} XP · Hints used {totalHintsUsed} · -{rewardPenaltyXP} XP
            {rewardPenaltyCapped ? ' (max penalty)' : ''}
          </div>
        )}
        {isCompleted ? (
          <button type="button" data-testid="hint-next-quest" onClick={onNextQuest} style={{
            width: '100%', padding: '9px 10px', borderRadius: 9, border: 'none',
            background: 'linear-gradient(135deg,#3fb950,#2ea043)',
            color: '#fff',
            fontWeight: 800, fontSize: 11, letterSpacing: 0.4,
            cursor: 'pointer',
            fontFamily: 'Inter,sans-serif',
            boxShadow: '0 4px 14px rgba(63,185,80,0.35)',
            transition: 'all .15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'none'; }}
          >
            {hasNextQuest ? 'NEXT QUEST →' : '✓ BACK TO LEVEL'}
          </button>
        ) : (
          <button type="button" data-testid="take-hint" onClick={onTakeHint} disabled={buttonDisabled} style={{
            width: '100%', padding: '9px 10px', borderRadius: 9, border: 'none',
            background: buttonDisabled ? 'rgba(72,79,88,0.2)' : 'linear-gradient(135deg,#06b6d4,#0891b2)',
            color: buttonDisabled ? '#484f58' : '#000',
            fontWeight: 700, fontSize: 11,
            cursor: buttonDisabled ? 'not-allowed' : 'pointer',
            fontFamily: 'Inter,sans-serif',
            boxShadow: buttonDisabled ? 'none' : '0 4px 14px rgba(6,182,212,.35)',
            transition: 'all .15s',
          }}>
            {noHintsAvailable
              ? 'No hints available'
              : allHintsUsed
                ? 'No more hints'
                : `TAKE A HINT (-${HINT_XP_COST} XP) · ${maxHints - hintsUsed} left`}
          </button>
        )}
      </div>
    </div>
  );
};

