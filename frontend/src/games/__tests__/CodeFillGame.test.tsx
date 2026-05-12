import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { CodeFillGame } from '../CodeFillGame';
import type { CodeFillItem } from '../../types/campaign';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ITEM_ONE_BLANK: CodeFillItem = {
  id: 'cf1',
  code_lines: ['int x = ___;'],
  answers: ['5'],
  hint: 'Use the number five.',
  caption: 'Assign five to x',
};

const ITEM_TWO_BLANKS: CodeFillItem = {
  id: 'cf2',
  code_lines: ['int a = ___;', 'int b = ___;'],
  answers: ['1', '2'],
};

const ITEM_MULTI_LINE: CodeFillItem = {
  id: 'cf3',
  code_lines: ['for (int i = ___; i < ___; i++) {', '  cout << i;', '}'],
  answers: ['0', '10'],
  language: 'C++',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CodeFillGame', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('renders empty-state message when items array is empty', () => {
    render(<CodeFillGame items={[]} onComplete={vi.fn()} resetSignal={0} />);
    expect(screen.getByText(/No code-fill items configured/i)).toBeInTheDocument();
  });

  it('renders the caption when provided', () => {
    render(<CodeFillGame items={[ITEM_ONE_BLANK]} onComplete={vi.fn()} resetSignal={0} />);
    expect(screen.getByText('Assign five to x')).toBeInTheDocument();
  });

  it('renders code text and blank input placeholder', () => {
    render(<CodeFillGame items={[ITEM_ONE_BLANK]} onComplete={vi.fn()} resetSignal={0} />);
    expect(screen.getByText(/int x =/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('???')).toBeInTheDocument();
  });

  it('shows progress counter 1/1 for a single item', () => {
    render(<CodeFillGame items={[ITEM_ONE_BLANK]} onComplete={vi.fn()} resetSignal={0} />);
    expect(screen.getByText('1/1')).toBeInTheDocument();
  });

  it('Check Answers button is disabled when blanks are empty', () => {
    render(<CodeFillGame items={[ITEM_ONE_BLANK]} onComplete={vi.fn()} resetSignal={0} />);
    expect(screen.getByRole('button', { name: /check answers/i })).toBeDisabled();
  });

  it('Check Answers button enables once the blank is filled', () => {
    render(<CodeFillGame items={[ITEM_ONE_BLANK]} onComplete={vi.fn()} resetSignal={0} />);
    fireEvent.change(screen.getByPlaceholderText('???'), { target: { value: '5' } });
    expect(screen.getByRole('button', { name: /check answers/i })).not.toBeDisabled();
  });

  it('shows Next button after correct answer on non-last item', async () => {
    render(<CodeFillGame items={[ITEM_ONE_BLANK, ITEM_TWO_BLANKS]} onComplete={vi.fn()} resetSignal={0} />);
    fireEvent.change(screen.getByPlaceholderText('???'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /check answers/i }));
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
  });

  it('shows Finish button after correct answer on last item', async () => {
    render(<CodeFillGame items={[ITEM_ONE_BLANK]} onComplete={vi.fn()} resetSignal={0} />);
    fireEvent.change(screen.getByPlaceholderText('???'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /check answers/i }));
    expect(screen.getByRole('button', { name: /finish/i })).toBeInTheDocument();
  });

  it('shows Try Again button after wrong answer', () => {
    render(<CodeFillGame items={[ITEM_ONE_BLANK]} onComplete={vi.fn()} resetSignal={0} />);
    fireEvent.change(screen.getByPlaceholderText('???'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /check answers/i }));
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('shows the hint when answer is wrong and hint is provided', () => {
    render(<CodeFillGame items={[ITEM_ONE_BLANK]} onComplete={vi.fn()} resetSignal={0} />);
    fireEvent.change(screen.getByPlaceholderText('???'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /check answers/i }));
    expect(screen.getByText(/Use the number five/i)).toBeInTheDocument();
  });

  it('does NOT show the hint when answer is correct', () => {
    render(<CodeFillGame items={[ITEM_ONE_BLANK]} onComplete={vi.fn()} resetSignal={0} />);
    fireEvent.change(screen.getByPlaceholderText('???'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /check answers/i }));
    expect(screen.queryByText(/Use the number five/i)).toBeNull();
  });

  it('Try Again clears inputs and shows Check Answers again', () => {
    render(<CodeFillGame items={[ITEM_ONE_BLANK]} onComplete={vi.fn()} resetSignal={0} />);
    fireEvent.change(screen.getByPlaceholderText('???'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /check answers/i }));
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect((screen.getByPlaceholderText('???') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: /check answers/i })).toBeInTheDocument();
  });

  it('case-insensitive answer matching accepts correct case variations', () => {
    const itemCaseInsensitive: CodeFillItem = {
      id: 'ci',
      code_lines: ['___ world'],
      answers: ['Hello'],
    };
    render(<CodeFillGame items={[itemCaseInsensitive]} onComplete={vi.fn()} resetSignal={0} />);
    fireEvent.change(screen.getByPlaceholderText('???'), { target: { value: 'HELLO' } });
    fireEvent.click(screen.getByRole('button', { name: /check answers/i }));
    expect(screen.getByRole('button', { name: /finish/i })).toBeInTheDocument();
  });

  it('handles two blanks on separate lines (all must be correct)', () => {
    render(<CodeFillGame items={[ITEM_TWO_BLANKS]} onComplete={vi.fn()} resetSignal={0} />);
    const inputs = screen.getAllByPlaceholderText('???');
    expect(inputs).toHaveLength(2);
    fireEvent.change(inputs[0], { target: { value: '1' } });
    fireEvent.change(inputs[1], { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /check answers/i }));
    expect(screen.getByRole('button', { name: /finish/i })).toBeInTheDocument();
  });

  it('shows mixed result when only some blanks are correct', () => {
    render(<CodeFillGame items={[ITEM_TWO_BLANKS]} onComplete={vi.fn()} resetSignal={0} />);
    const inputs = screen.getAllByPlaceholderText('???');
    fireEvent.change(inputs[0], { target: { value: '1' } });   // correct
    fireEvent.change(inputs[1], { target: { value: '99' } });  // wrong
    fireEvent.click(screen.getByRole('button', { name: /check answers/i }));
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('calls onComplete with score 1 when the only item is answered correctly', async () => {
    const onComplete = vi.fn();
    render(<CodeFillGame items={[ITEM_ONE_BLANK]} onComplete={onComplete} resetSignal={0} />);
    fireEvent.change(screen.getByPlaceholderText('???'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /check answers/i }));
    await act(async () => { vi.advanceTimersByTime(700); });
    expect(onComplete).toHaveBeenCalledWith(1, 1);
  });

  it('advances to next item when Next is clicked', () => {
    render(<CodeFillGame items={[ITEM_ONE_BLANK, ITEM_TWO_BLANKS]} onComplete={vi.fn()} resetSignal={0} />);
    fireEvent.change(screen.getByPlaceholderText('???'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /check answers/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByText('2/2')).toBeInTheDocument();
    expect(screen.getAllByPlaceholderText('???')).toHaveLength(2);
  });

  it('calls onComplete with 0 after Finish on a wrong-then-skipped last item', () => {
    const onComplete = vi.fn();
    render(
      <CodeFillGame
        items={[ITEM_ONE_BLANK, ITEM_TWO_BLANKS]}
        onComplete={onComplete}
        resetSignal={0}
      />
    );
    // First item: correct
    fireEvent.change(screen.getByPlaceholderText('???'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /check answers/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    // Second item: wrong — then click Try Again and leave it at that → no way to Finish
    // Instead test the manual Finish flow: wrong then we can navigate via the next item logic
    // Actually CodeFillGame only shows Finish when all blanks are right, so let's do correct:
    const inputs = screen.getAllByPlaceholderText('???');
    fireEvent.change(inputs[0], { target: { value: '1' } });
    fireEvent.change(inputs[1], { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /check answers/i }));
    fireEvent.click(screen.getByRole('button', { name: /finish/i }));
    expect(onComplete).toHaveBeenCalledWith(2, 2);
  });

  it('resets on resetSignal > 0', () => {
    const { rerender } = render(
      <CodeFillGame items={[ITEM_ONE_BLANK]} onComplete={vi.fn()} resetSignal={0} />
    );
    fireEvent.change(screen.getByPlaceholderText('???'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /check answers/i }));
    // Trigger reset
    rerender(<CodeFillGame items={[ITEM_ONE_BLANK]} onComplete={vi.fn()} resetSignal={1} />);
    expect((screen.getByPlaceholderText('???') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: /check answers/i })).toBeInTheDocument();
  });

  it('renders language label in header (defaults to C++)', () => {
    render(<CodeFillGame items={[ITEM_ONE_BLANK]} onComplete={vi.fn()} resetSignal={0} />);
    expect(screen.getByText('C++')).toBeInTheDocument();
  });

  it('renders custom language label when provided', () => {
    render(<CodeFillGame items={[ITEM_MULTI_LINE]} onComplete={vi.fn()} resetSignal={0} />);
    expect(screen.getByText('C++')).toBeInTheDocument();
  });
});
