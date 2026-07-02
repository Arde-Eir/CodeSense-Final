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
import type { ValidationResult, ValidationIssue } from '@/services/GraphValidator';

// ─── Single issue row ─────────────────────────────────────────────────────────

function suggestionForIssue(issue: ValidationIssue): string {
  switch (issue.code) {
    case 'EMPTY_GRAPH':
      return 'Add Start, at least one action node, then End. Connect them from top to bottom.';
    case 'NO_START_NODE':
      return 'Add a Start / End node and rename it to Start, then connect it to the first step.';
    case 'MULTIPLE_START_NODES':
      return 'Keep only one Start node. Rename or delete the extra Start terminators.';
    case 'RETURN_USES_TERMINATOR_SHAPE':
      return 'Replace the Return terminator with a Process node and put return 0; or return value; inside it.';
    case 'NO_END_NODE':
      return 'Add a Start / End node and rename it to End, then connect the final path into it.';
    case 'ISOLATED_NODES':
      return 'Connect each listed node into the main path, or delete nodes that are not part of the program.';
    case 'UNREACHABLE_NODES':
      return 'Trace from Start and reconnect the listed node so a continuous path reaches it.';
    case 'START_HAS_INCOMING_EDGE':
      return 'Delete incoming lines to Start. Only outgoing flow from Start is allowed.';
    case 'START_NOT_CONNECTED':
      return 'Drag a connector from Start to the first real step.';
    case 'START_MULTIPLE_OUTGOING':
      return 'Keep one outgoing line from Start. Put branching logic in a Decision node after Start.';
    case 'END_NOT_CONNECTED':
      return 'Connect the last process, output, or merge node into this End node.';
    case 'END_HAS_OUTGOING_EDGE':
      return 'Delete outgoing lines from End. If work continues, move End after the final step.';
    case 'DECISION_NO_EDGES':
      return 'Connect the Decision to a true branch. Add a false branch if you need if/else.';
    case 'DECISION_REQUIRES_TWO_BRANCHES':
      return 'Use one outgoing edge for a single if, or exactly two edges labeled true and false.';
    case 'DECISION_BRANCH_LABELS':
    case 'DECISION_DUPLICATE_BRANCH_LABELS':
      return 'Double-click each Decision edge and label one true and the other false.';
    case 'DECISION_PLACEHOLDER':
    case 'INVALID_DECISION_CONDITION':
      return 'Write a C++-friendly condition like score >= 75, count < 10, or choice == 1.';
    case 'LINEAR_NODE_NO_OUTGOING':
      return 'Connect this step to the next step, or connect it to End if it is the final action.';
    case 'LINEAR_NODE_MULTIPLE_OUTGOING':
      return 'Use one outgoing line from this step. Add a Decision node if the flow must branch.';
    case 'PLACEHOLDER_NODE':
    case 'PSEUDOCODE_STYLE':
      return 'Double-click the node and write one clear action, such as set total to price plus tax.';
    case 'SHAPE_MISMATCH':
      return 'Move this instruction to the matching shape shown in the message, then regenerate.';
    case 'SELF_LOOP_EDGES':
      return 'Delete the direct self-loop and route repetition through a Decision node.';
    case 'DUPLICATE_EDGES':
      return 'Delete duplicate lines so there is only one flow line for each connection and label.';
    case 'CODE_GENERATION_FAILED':
      return 'Check the listed issue, simplify the affected node text, then click Generate again.';
    default:
      return issue.severity === 'error'
        ? 'Fix this item, then click Generate C++ again.'
        : 'This warning does not block generation, but fixing it can make the generated C++ clearer.';
  }
}

function whereToFix(issue: ValidationIssue): string {
  const nodeCount = issue.nodeIds?.length ?? 0;
  const edgeCount = issue.edgeIds?.length ?? 0;
  if (nodeCount > 0 && edgeCount > 0) {
    return `Affected graph parts: ${nodeCount} node${nodeCount > 1 ? 's' : ''} and ${edgeCount} edge${edgeCount > 1 ? 's' : ''}. Click this validation row to highlight them.`;
  }
  if (nodeCount > 0) {
    return `Affected node${nodeCount > 1 ? 's' : ''}: click this validation row to highlight ${nodeCount > 1 ? 'them' : 'it'} on the canvas.`;
  }
  if (edgeCount > 0) {
    return `Affected edge${edgeCount > 1 ? 's' : ''}: click this validation row to highlight ${edgeCount > 1 ? 'them' : 'it'} on the canvas.`;
  }
  switch (issue.code) {
    case 'EMPTY_GRAPH':
    case 'NO_START_NODE':
    case 'NO_END_NODE':
      return 'Canvas structure: add the missing required shape in the flowchart area.';
    case 'CODE_GENERATION_FAILED':
      return 'Generated-code step: inspect the most recent node text and simplify anything ambiguous.';
    default:
      return 'Graph structure or node text: check the item named in the error message.';
  }
}

const FixHelper: React.FC<{
  issue:   ValidationIssue;
  color:   string;
  border:  string;
}> = ({ issue, color, border }) => {
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const solution = suggestionForIssue(issue);
  const location = whereToFix(issue);
  const visible = focused || pinned;

  return (
    <span
      style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', marginLeft: 8, verticalAlign: 'middle', maxWidth: '100%' }}
    >
      <span
        role="button"
        tabIndex={0}
        aria-label="Show fix helper"
        aria-expanded={visible}
        title="Show where and how to fix this validation issue"
        onClick={event => {
          event.stopPropagation();
          setPinned(value => !value);
        }}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            setPinned(value => !value);
          }
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setPinned(false);
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 7px',
          borderRadius: 999,
          border: `1px solid ${border}`,
          background: 'rgba(13,17,23,0.82)',
          color,
          fontSize: 10,
          fontWeight: 800,
          lineHeight: 1.3,
          cursor: 'help',
          userSelect: 'none',
        }}
      >
        Fix
      </span>

      {visible && (
        <span
          role="tooltip"
          style={{
            display: 'block',
            width: 'min(100%, 320px)',
            maxWidth: '100%',
            marginTop: 8,
            marginLeft: -8,
            padding: '12px 13px',
            borderRadius: 8,
            border: `1px solid ${border}`,
            background: 'linear-gradient(135deg,#10161f,#151b24)',
            boxShadow: '0 16px 34px rgba(0,0,0,0.55)',
            color: '#c9d1d9',
            fontSize: 12,
            lineHeight: 1.55,
            pointerEvents: 'none',
            whiteSpace: 'normal',
          }}
        >
          <strong style={{ display: 'block', color, marginBottom: 6, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase' }}>
            Fix Helper
          </strong>
          <span style={{ display: 'block', marginBottom: 6 }}>
            <strong style={{ color: '#e6edf3' }}>Where to fix:</strong> {location}
          </span>
          <span style={{ display: 'block' }}>
            <strong style={{ color: '#e6edf3' }}>Solution:</strong> {solution}
          </span>
        </span>
      )}
    </span>
  );
};

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
  const suggestion = suggestionForIssue(issue);

  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      title={clickable ? 'Click to highlight the affected node(s) on the canvas' : undefined}
      style={{
        display: 'flex', gap: 8, alignItems: 'flex-start',
        padding: '10px 11px',
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 8,
        position: 'relative',
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
      <span style={{ fontSize: 12, color, marginTop: 1, flexShrink: 0, fontWeight: 700 }}>
        {icon}
      </span>

      {/* Message */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 12, color, lineHeight: 1.6 }}>
          {issue.message}
        </span>
        <FixHelper issue={issue} color={color} border={border} />
        {clickable && (
          <span style={{
            display: 'inline-block', marginLeft: 6,
            fontSize: 9, color: isError ? '#ff9999' : '#ffd180',
            opacity: 0.7, fontStyle: 'italic',
          }}>
            (click to highlight)
          </span>
        )}
        <div style={{
          marginTop: 7,
          fontSize: 11,
          color: isError ? '#ffb4b4' : '#ffd180',
          lineHeight: 1.55,
        }}>
          <strong>Try this:</strong> {suggestion}
        </div>
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
          padding: '10px 12px',
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
          flex: 1, fontSize: 11, fontWeight: 700,
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
          display: 'flex', flexDirection: 'column', gap: 8,
          padding: 10,
          maxHeight: 360, overflowY: 'auto',
        }}>
          {/* Errors first, then warnings */}
          {[...errors, ...warnings].map((issue, i) => (
            <IssueRow key={i} issue={issue} onHighlight={onHighlight} />
          ))}

          {/* Footer hint when generation is blocked */}
          {hasErrors && (
            <div style={{
              marginTop: 4, padding: '8px 10px',
              fontSize: 10, color: '#6e7681', lineHeight: 1.6,
              borderTop: '1px solid #21262d',
            }}>
              Fix all errors above before generating code.
              Warnings are non-blocking but may cause incorrect output.
              Junction nodes are routing-only merge points; use Decision nodes for branching logic.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
