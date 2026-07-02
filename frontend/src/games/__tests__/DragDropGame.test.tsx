import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { DragDropGame } from '@/games/DragDropGame';
import type { GameItem, DropZone } from '@/types/campaign';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ITEMS: GameItem[] = [
  { id: 'i1', label: 'Compiler',   color: '#58a6ff' },
  { id: 'i2', label: 'Linker',     color: '#3fb950' },
];

const ZONES: DropZone[] = [
  { id: 'z1', label: 'Translates source code to object code', accepted: 'i1' },
  { id: 'z2', label: 'Combines object files into executable', accepted: 'i2' },
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DragDropGame', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('renders empty-state message when items and zones are empty', () => {
    render(<DragDropGame items={[]} zones={[]} onComplete={vi.fn()} resetSignal={0} />);
    expect(screen.getByText(/No drag-drop data yet/i)).toBeInTheDocument();
  });

  it('renders empty-state when only items are empty', () => {
    render(<DragDropGame items={[]} zones={ZONES} onComplete={vi.fn()} resetSignal={0} />);
    expect(screen.getByText(/No drag-drop data yet/i)).toBeInTheDocument();
  });

  it('renders instruction banner', () => {
    render(<DragDropGame items={ITEMS} zones={ZONES} onComplete={vi.fn()} resetSignal={0} />);
    expect(screen.getByText(/Drag each term to its matching description/i)).toBeInTheDocument();
  });

  it('renders all term cards', () => {
    render(<DragDropGame items={ITEMS} zones={ZONES} onComplete={vi.fn()} resetSignal={0} />);
    expect(screen.getByText('Compiler')).toBeInTheDocument();
    expect(screen.getByText('Linker')).toBeInTheDocument();
  });

  it('renders all drop zone descriptions', () => {
    render(<DragDropGame items={ITEMS} zones={ZONES} onComplete={vi.fn()} resetSignal={0} />);
    expect(screen.getByText('Translates source code to object code')).toBeInTheDocument();
    expect(screen.getByText('Combines object files into executable')).toBeInTheDocument();
  });

  it('Check Answers button is disabled when no zones are filled', () => {
    render(<DragDropGame items={ITEMS} zones={ZONES} onComplete={vi.fn()} resetSignal={0} />);
    expect(screen.getByRole('button', { name: /check answers/i })).toBeDisabled();
  });

  it('Reset button clears all dropped items', () => {
    render(<DragDropGame items={ITEMS} zones={ZONES} onComplete={vi.fn()} resetSignal={0} />);
    // Drop one item into a zone via simulated events
    const compilerCard = screen.getByText('Compiler').closest('[draggable]')!;
    fireEvent.dragStart(compilerCard);
    const zoneEl = screen.getByText('Translates source code to object code').closest('div[style]')!;
    fireEvent.dragOver(zoneEl);
    fireEvent.drop(zoneEl);

    // Reset
    fireEvent.click(screen.getByRole('button', { name: /reset/i }));
    // Check Answers should be disabled again
    expect(screen.getByRole('button', { name: /check answers/i })).toBeDisabled();
  });

  it('Reset button is disabled after game is submitted', async () => {
    const onComplete = vi.fn();
    render(<DragDropGame items={ITEMS} zones={ZONES} onComplete={onComplete} resetSignal={0} />);

    // Drop correct items into zones
    const compilerCard = screen.getByText('Compiler').closest('[draggable]')!;
    fireEvent.dragStart(compilerCard);
    const zone1 = screen.getByText('Translates source code to object code').closest('div[style]')!;
    fireEvent.dragOver(zone1);
    fireEvent.drop(zone1);

    const linkerCard = screen.getByText('Linker').closest('[draggable]')!;
    fireEvent.dragStart(linkerCard);
    const zone2 = screen.getByText('Combines object files into executable').closest('div[style]')!;
    fireEvent.dragOver(zone2);
    fireEvent.drop(zone2);

    fireEvent.click(screen.getByRole('button', { name: /check answers/i }));
    await act(async () => { vi.advanceTimersByTime(700); });

    expect(screen.getByRole('button', { name: /reset/i })).toBeDisabled();
  });

  it('shows result banner after checking', () => {
    render(<DragDropGame items={ITEMS} zones={ZONES} onComplete={vi.fn()} resetSignal={0} />);
    const compilerCard = screen.getByText('Compiler').closest('[draggable]')!;
    fireEvent.dragStart(compilerCard);
    const zone1 = screen.getByText('Translates source code to object code').closest('div[style]')!;
    fireEvent.dragOver(zone1);
    fireEvent.drop(zone1);

    // Only one zone filled — wrong zone for linker so score != total
    const linkerCard = screen.getByText('Linker').closest('[draggable]')!;
    fireEvent.dragStart(linkerCard);
    const zone2 = screen.getByText('Combines object files into executable').closest('div[style]')!;
    fireEvent.dragOver(zone2);
    fireEvent.drop(zone2);

    fireEvent.click(screen.getByRole('button', { name: /check answers/i }));
    // Result banner appears
    expect(
      screen.getByText(/perfect! all matched correctly/i) ||
      screen.getByText(/correct — try again/i)
    ).toBeInTheDocument();
  });

  it('shows "✅ Submitted" on the check button after a perfect submission', async () => {
    const onComplete = vi.fn();
    render(<DragDropGame items={ITEMS} zones={ZONES} onComplete={onComplete} resetSignal={0} />);

    const compilerCard = screen.getByText('Compiler').closest('[draggable]')!;
    fireEvent.dragStart(compilerCard);
    const zone1 = screen.getByText('Translates source code to object code').closest('div[style]')!;
    fireEvent.dragOver(zone1);
    fireEvent.drop(zone1);

    const linkerCard = screen.getByText('Linker').closest('[draggable]')!;
    fireEvent.dragStart(linkerCard);
    const zone2 = screen.getByText('Combines object files into executable').closest('div[style]')!;
    fireEvent.dragOver(zone2);
    fireEvent.drop(zone2);

    fireEvent.click(screen.getByRole('button', { name: /check answers/i }));
    expect(screen.getByText(/✅ Submitted/)).toBeInTheDocument();
  });

  it('calls onComplete with score=total on a perfect match after delay', async () => {
    const onComplete = vi.fn();
    render(<DragDropGame items={ITEMS} zones={ZONES} onComplete={onComplete} resetSignal={0} />);

    const compilerCard = screen.getByText('Compiler').closest('[draggable]')!;
    fireEvent.dragStart(compilerCard);
    const zone1 = screen.getByText('Translates source code to object code').closest('div[style]')!;
    fireEvent.dragOver(zone1);
    fireEvent.drop(zone1);

    const linkerCard = screen.getByText('Linker').closest('[draggable]')!;
    fireEvent.dragStart(linkerCard);
    const zone2 = screen.getByText('Combines object files into executable').closest('div[style]')!;
    fireEvent.dragOver(zone2);
    fireEvent.drop(zone2);

    fireEvent.click(screen.getByRole('button', { name: /check answers/i }));
    expect(onComplete).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(700); });
    expect(onComplete).toHaveBeenCalledWith(2, 2);
  });

  it('resets state when resetSignal changes', () => {
    const { rerender } = render(
      <DragDropGame items={ITEMS} zones={ZONES} onComplete={vi.fn()} resetSignal={0} />
    );
    // Drop an item
    const compilerCard = screen.getByText('Compiler').closest('[draggable]')!;
    fireEvent.dragStart(compilerCard);
    const zone1 = screen.getByText('Translates source code to object code').closest('div[style]')!;
    fireEvent.dragOver(zone1);
    fireEvent.drop(zone1);

    rerender(<DragDropGame items={ITEMS} zones={ZONES} onComplete={vi.fn()} resetSignal={1} />);
    expect(screen.getByRole('button', { name: /check answers/i })).toBeDisabled();
  });
});
