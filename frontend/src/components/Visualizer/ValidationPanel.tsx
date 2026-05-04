/**
 * ValidationPanel.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Renders a collapsible panel listing errors and warnings from validateGraph().
 *
 * Drop this inside GenerateCodePanel, just above the Generate button.
 *
 * Props:
 *   result          — output of validateGraph()
 *   onDismiss       — called when the user clicks ✕ to hide the panel
 *   highlightNodes? — optional callback to highlight offending nodes on canvas
 */

import React, { useState } from 'react';
import type { ValidationResult, ValidationIssue } from '../../services/GraphValidator';

// ─── Single issue row ─────────────────────────────────────────────────────────

const IssueRow: React.FC<{
  issue:        ValidationIssue;
  onHighlight?: (nodeIds: string[], edgeIds: string[]) => void;
}> = ({ issue, onHighlight }) => {
  const isError    = issue.severity === 'error';
  const color      = isError ? '#ff6b6b' : '#ffa726';
  const bg         = isError ? 'rgba(255,68,68,0.06)'   : 'rgba(255,167,38,0.06)';
  const border     = isError ? 'rgba(255,68,68,0.25)'   : 'rgba(255,167,38,0.25)';
  const icon       = isError ? '✖' : '⚠';
  const hasTargets = (issue.nodeIds?.length ?? 0) + (issue.edgeIds?.length ?? 0) > 0;
  const clickable  = hasTargets && !!onHighlight;

  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      title={clickable ? 'Click to highlight the affected node(s) on the canvas' : undefined}
      style={{
        display: 'flex', gap: 8, alignItems: 'flex-start',
        padding: '7px 9px',
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 6,
        cursor: clickable ? 'pointer' : 'default',
        transition: 'background 0.15s',
      }}
      onClick={() => {
        if (clickable) onHighlight!(issue.nodeIds ?? [], issue.edgeIds ?? []);
      }}
      onKeyDown={e => {
        if (clickable && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onHighlight!(issue.nodeIds ?? [], issue.edgeIds ?? []);
        }
      }}
      onMouseEnter={e => {
        if (clickable)
          (e.currentTarget as HTMLDivElement).style.background =
            isError ? 'rgba(255,68,68,0.12)' : 'rgba(255,167,38,0.12)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.background = bg;
      }}
    >
      {/* Severity icon */}
      <span style={{ fontSize: 10, color, marginTop: 1, flexShrink: 0, fontWeight: 700 }}>
        {icon}
      </span>

      {/* Message */}
      <div style={{ flex: 1 }}>
        <span style={{ fontSize: 10, color, lineHeight: 1.55 }}>
          {issue.message}
        </span>
        {clickable && (
          <span style={{
            display: 'inline-block', marginLeft: 6,
            fontSize: 9, color: isError ? '#ff9999' : '#ffd180',
            opacity: 0.7, fontStyle: 'italic',
          }}>
            (click to highlight)
          </span>
        )}
      </div>
    </div>
  );
};

// ─── Main ValidationPanel ─────────────────────────────────────────────────────

export const ValidationPanel: React.FC<{
  result:       ValidationResult;
  onDismiss:    () => void;
  onHighlight?: (nodeIds: string[], edgeIds: string[]) => void;
}> = ({ result, onDismiss, onHighlight }) => {
  const [expanded, setExpanded] = useState(true);

  if (result.all.length === 0) return null;

  const { errors, warnings } = result;
  const hasErrors   = errors.length > 0;
  const headerColor = hasErrors ? '#ff6b6b' : '#ffa726';
  const headerBg    = hasErrors ? 'rgba(255,68,68,0.08)'  : 'rgba(255,167,38,0.08)';
  const borderColor = hasErrors ? 'rgba(255,68,68,0.4)'   : 'rgba(255,167,38,0.4)';

  const summary = [
    errors.length   > 0 ? `${errors.length} error${errors.length   > 1 ? 's' : ''}` : '',
    warnings.length > 0 ? `${warnings.length} warning${warnings.length > 1 ? 's' : ''}` : '',
  ].filter(Boolean).join(', ');

  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        overflow: 'hidden',
        background: '#0d1117',
        flexShrink: 0,
      }}
    >
      {/* Header */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        style={{
          display: 'flex', alignItems: 'center', gap: 7,
          padding: '8px 10px',
          background: headerBg,
          borderBottom: expanded ? `1px solid ${borderColor}` : 'none',
          cursor: 'pointer', userSelect: 'none',
        }}
        onClick={() => setExpanded(v => !v)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(v => !v); } }}
        title={expanded ? 'Collapse validation results' : 'Expand validation results'}
      >
        <span style={{ fontSize: 11, color: headerColor, flexShrink: 0 }}>
          {hasErrors ? '🚫' : '⚠️'}
        </span>

        <span style={{
          flex: 1, fontSize: 10, fontWeight: 700,
          color: headerColor, letterSpacing: '0.3px',
          fontFamily: "'IBM Plex Mono', monospace",
          textTransform: 'uppercase',
        }}>
          {hasErrors ? 'Cannot Generate' : 'Warnings'} — {summary}
        </span>

        {/* Chevron */}
        <span style={{
          fontSize: 10, color: headerColor,
          transform: expanded ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.2s',
          marginRight: 4,
        }}>▼</span>

        {/* Dismiss */}
        <span
          role="button"
          tabIndex={0}
          style={{ fontSize: 13, color: '#484f58', cursor: 'pointer', lineHeight: 1, padding: '0 2px' }}
          onClick={e => { e.stopPropagation(); onDismiss(); }}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onDismiss(); } }}
          title="Dismiss these results"
        >
          ✕
        </span>
      </div>

      {/* Issue list */}
      {expanded && (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 4,
          padding: 8,
          maxHeight: 220, overflowY: 'auto',
        }}>
          {/* Errors first, then warnings */}
          {[...errors, ...warnings].map((issue, i) => (
            <IssueRow key={i} issue={issue} onHighlight={onHighlight} />
          ))}

          {/* Footer hint when generation is blocked */}
          {hasErrors && (
            <div style={{
              marginTop: 4, padding: '5px 8px',
              fontSize: 9, color: '#484f58', lineHeight: 1.6,
              borderTop: '1px solid #21262d',
            }}>
              Fix all errors above before generating code.
              Warnings are non-blocking but may cause incorrect output.
              Offset/Junction nodes are routing-only; use Decision nodes for branching logic.
            </div>
          )}
        </div>
      )}
    </div>
  );
};