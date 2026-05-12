import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { LogsTab } from '../LogsTab';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('LogsTab', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('renders idle placeholder when no explanations are provided', () => {
    render(<LogsTab />);
    expect(screen.getByText(/waiting for analysis/i)).toBeInTheDocument();
  });

  it('renders idle placeholder when explanations is empty array', () => {
    render(<LogsTab explanations={[]} />);
    expect(screen.getByText(/waiting for analysis/i)).toBeInTheDocument();
  });

  it('shows the boot line when explanations are present', async () => {
    render(<LogsTab explanations={['✅ Analysis Successful']} />);
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(screen.getByText(/codesense analyze/i)).toBeInTheDocument();
  });

  it('shows PASS indicator when success=true', async () => {
    render(<LogsTab explanations={['✅ Done']} success={true} />);
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(screen.getByText('PASS')).toBeInTheDocument();
  });

  it('shows FAIL indicator when success=false', async () => {
    render(<LogsTab explanations={['❌ Error']} success={false} />);
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(screen.getByText('FAIL')).toBeInTheDocument();
  });

  it('renders filter pills when entries exist', async () => {
    render(<LogsTab explanations={['✅ OK entry']} />);
    await act(async () => { vi.advanceTimersByTime(500); });
    // "ALL" pill should be present
    expect(screen.getByText(/^ALL/)).toBeInTheDocument();
  });

  it('shows success pill when there is a success-level entry', async () => {
    render(<LogsTab explanations={['✅ Everything is fine']} />);
    await act(async () => { vi.advanceTimersByTime(500); });
    // Success pill shows "✓ N"
    expect(screen.getByText(/✓ 1/)).toBeInTheDocument();
  });

  it('shows error pill when there is an error-level entry', async () => {
    render(<LogsTab explanations={['❌ Something broke']} />);
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(screen.getByText(/✗ 1/)).toBeInTheDocument();
  });

  it('shows warning pill when there is a warning-level entry', async () => {
    render(<LogsTab explanations={['⚠️ WARNING Something odd']} />);
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(screen.getByText(/⚠ 1/)).toBeInTheDocument();
  });

  it('filters entries when an error pill is clicked', async () => {
    render(<LogsTab explanations={['✅ OK', '❌ Bad thing']} />);
    await act(async () => { vi.advanceTimersByTime(500); });
    const errorPill = screen.getByText(/✗ 1/);
    fireEvent.click(errorPill);
    // After filtering only the error entry should be visible
    // The OK entry message should not be visible
    // (note: both messages are parsed through parseEntry so check message content)
    expect(screen.queryByText(/OK/)).toBeNull();
  });

  it('filters back to all when ALL pill is clicked after filtering', async () => {
    render(<LogsTab explanations={['✅ OK', '❌ Bad']} />);
    await act(async () => { vi.advanceTimersByTime(500); });
    // Filter to errors
    fireEvent.click(screen.getByText(/✗ 1/));
    // Click ALL to reset
    fireEvent.click(screen.getByText(/^ALL/));
    // Both entries visible now — getAll because "OK" appears in both badge + message span
    expect(screen.getAllByText(/OK/).length).toBeGreaterThan(0);
  });

  it('renders cognitive complexity badge when provided', async () => {
    render(<LogsTab explanations={['✅ Done']} cognitiveComplexity={2} />);
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(screen.getByText('Cognitive')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Simple ✓')).toBeInTheDocument();
  });

  it('renders cyclomatic complexity badge when provided', async () => {
    render(<LogsTab
      explanations={['✅ Done']}
      cyclomaticComplexity={{ score: 4, rating: 'Low', interpretation: 'Simple' }}
    />);
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(screen.getByText('Cyclomatic')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('Low')).toBeInTheDocument();
  });

  it('labels cognitive complexity as "Moderate" when score is 5', async () => {
    render(<LogsTab explanations={['✅ Done']} cognitiveComplexity={5} />);
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(screen.getByText('Moderate')).toBeInTheDocument();
  });

  it('labels cognitive complexity as "Complex ⚠" when score is 8', async () => {
    render(<LogsTab explanations={['✅ Done']} cognitiveComplexity={8} />);
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(screen.getByText(/Complex ⚠/)).toBeInTheDocument();
  });

  it('does not render complexity row when neither complexity value is provided', async () => {
    render(<LogsTab explanations={['✅ Done']} />);
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(screen.queryByText('Cognitive')).toBeNull();
    expect(screen.queryByText('Cyclomatic')).toBeNull();
  });

  it('renders the terminal header bar title', () => {
    render(<LogsTab />);
    expect(screen.getByText(/codesense — analysis\.log/i)).toBeInTheDocument();
  });
});
