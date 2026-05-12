import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ValidationPanel } from '../Visualizer/ValidationPanel';
import type { ValidationResult, ValidationIssue } from '../../services/GraphValidator';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResult(overrides: Partial<ValidationResult> = {}): ValidationResult {
  const all     = overrides.all     ?? [];
  const errors  = overrides.errors  ?? all.filter(i => i.severity === 'error');
  const warnings= overrides.warnings?? all.filter(i => i.severity === 'warning');
  return { isValid: errors.length === 0, errors, warnings, all, ...overrides };
}

function errorIssue(message: string, nodeIds?: string[]): ValidationIssue {
  return { severity: 'error', code: 'TEST_ERROR', message, nodeIds };
}

function warnIssue(message: string): ValidationIssue {
  return { severity: 'warning', code: 'TEST_WARN', message };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ValidationPanel', () => {
  it('renders nothing when result.all is empty', () => {
    const { container } = render(
      <ValidationPanel result={makeResult()} onDismiss={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders an error panel when there are errors', () => {
    const result = makeResult({
      all:     [errorIssue('No start node')],
      errors:  [errorIssue('No start node')],
      warnings:[],
    });
    render(<ValidationPanel result={result} onDismiss={vi.fn()} />);
    expect(screen.getByText(/No start node/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot generate/i)).toBeInTheDocument();
  });

  it('renders a warning panel when there are only warnings', () => {
    const result = makeResult({
      all:      [warnIssue('Placeholder node')],
      errors:   [],
      warnings: [warnIssue('Placeholder node')],
    });
    render(<ValidationPanel result={result} onDismiss={vi.fn()} />);
    expect(screen.getByText(/Placeholder node/i)).toBeInTheDocument();
    expect(screen.getByText(/warnings/i)).toBeInTheDocument();
  });

  it('summarises error count in the header', () => {
    const result = makeResult({
      all:     [errorIssue('E1'), errorIssue('E2')],
      errors:  [errorIssue('E1'), errorIssue('E2')],
      warnings:[],
    });
    render(<ValidationPanel result={result} onDismiss={vi.fn()} />);
    expect(screen.getByText(/2 errors/i)).toBeInTheDocument();
  });

  it('summarises warning count in the header', () => {
    const result = makeResult({
      all:      [warnIssue('W1'), warnIssue('W2'), warnIssue('W3')],
      errors:   [],
      warnings: [warnIssue('W1'), warnIssue('W2'), warnIssue('W3')],
    });
    render(<ValidationPanel result={result} onDismiss={vi.fn()} />);
    expect(screen.getByText(/3 warnings/i)).toBeInTheDocument();
  });

  it('shows both error and warning counts in summary', () => {
    const err  = errorIssue('Bad node');
    const warn = warnIssue('Placeholder');
    const result = makeResult({
      all:      [err, warn],
      errors:   [err],
      warnings: [warn],
    });
    render(<ValidationPanel result={result} onDismiss={vi.fn()} />);
    expect(screen.getByText(/1 error/i)).toBeInTheDocument();
    expect(screen.getByText(/1 warning/i)).toBeInTheDocument();
  });

  it('calls onDismiss when the dismiss button is clicked', () => {
    const onDismiss = vi.fn();
    const result = makeResult({
      all:    [errorIssue('Err')],
      errors: [errorIssue('Err')],
    });
    render(<ValidationPanel result={result} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTitle(/dismiss/i));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('collapses the issue list when the header is clicked', () => {
    const err = errorIssue('Collapsed error');
    const result = makeResult({ all: [err], errors: [err], warnings: [] });
    render(<ValidationPanel result={result} onDismiss={vi.fn()} />);
    // Issue is visible initially
    expect(screen.getByText('Collapsed error')).toBeInTheDocument();
    // Click the header to collapse (query by title attribute set on the div[role=button])
    fireEvent.click(screen.getByTitle('Collapse validation results'));
    expect(screen.queryByText('Collapsed error')).toBeNull();
  });

  it('expands the issue list again when the header is clicked a second time', () => {
    const err = errorIssue('Re-expanded error');
    const result = makeResult({ all: [err], errors: [err], warnings: [] });
    render(<ValidationPanel result={result} onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Collapse validation results')); // collapse
    fireEvent.click(screen.getByTitle('Expand validation results'));   // expand
    expect(screen.getByText('Re-expanded error')).toBeInTheDocument();
  });

  it('shows the "Fix all errors" footer hint when errors are present', () => {
    const result = makeResult({ all: [errorIssue('Err')], errors: [errorIssue('Err')], warnings: [] });
    render(<ValidationPanel result={result} onDismiss={vi.fn()} />);
    expect(screen.getByText(/Fix all errors above/i)).toBeInTheDocument();
  });

  it('does NOT show the "Fix all errors" footer when there are only warnings', () => {
    const result = makeResult({ all: [warnIssue('Warn')], errors: [], warnings: [warnIssue('Warn')] });
    render(<ValidationPanel result={result} onDismiss={vi.fn()} />);
    expect(screen.queryByText(/Fix all errors above/i)).toBeNull();
  });

  it('shows "click to highlight" hint on issues that have nodeIds', () => {
    const issue = errorIssue('Bad node', ['node-1']);
    const result = makeResult({ all: [issue], errors: [issue], warnings: [] });
    render(<ValidationPanel result={result} onHighlight={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText(/click to highlight/i)).toBeInTheDocument();
  });

  it('calls onHighlight with nodeIds when a clickable issue row is clicked', () => {
    const onHighlight = vi.fn();
    const issue = errorIssue('Bad node', ['node-1', 'node-2']);
    const result = makeResult({ all: [issue], errors: [issue], warnings: [] });
    render(<ValidationPanel result={result} onHighlight={onHighlight} onDismiss={vi.fn()} />);
    // The issue row itself is clickable
    fireEvent.click(screen.getByText('Bad node').closest('[role="button"]')!);
    expect(onHighlight).toHaveBeenCalledWith(['node-1', 'node-2'], []);
  });

  it('does not render "click to highlight" when onHighlight is not provided', () => {
    const issue = errorIssue('Node issue', ['node-1']);
    const result = makeResult({ all: [issue], errors: [issue], warnings: [] });
    render(<ValidationPanel result={result} onDismiss={vi.fn()} />);
    expect(screen.queryByText(/click to highlight/i)).toBeNull();
  });

  it('renders the ✖ icon for error issues', () => {
    const result = makeResult({ all: [errorIssue('Err')], errors: [errorIssue('Err')], warnings: [] });
    render(<ValidationPanel result={result} onDismiss={vi.fn()} />);
    expect(screen.getByText('✖')).toBeInTheDocument();
  });

  it('renders the ⚠ icon for warning issues', () => {
    const result = makeResult({ all: [warnIssue('Warn')], errors: [], warnings: [warnIssue('Warn')] });
    render(<ValidationPanel result={result} onDismiss={vi.fn()} />);
    expect(screen.getByText('⚠')).toBeInTheDocument();
  });
});
