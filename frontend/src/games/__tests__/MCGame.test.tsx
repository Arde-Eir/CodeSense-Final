import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MCGame } from '../MCGame';
import type { MCQ } from '../../types/campaign';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const Q1: MCQ = {
  id: 'q1',
  question: 'What is 2 + 2?',
  options: ['3', '4', '5', '6'],
  correct: 1,
  explanation: 'Basic arithmetic.',
};

const Q2: MCQ = {
  id: 'q2',
  question: 'What is the capital of France?',
  options: ['Berlin', 'Madrid', 'Paris', 'Rome'],
  correct: 2,
  explanation: 'Paris is the capital of France.',
};

const Q_NO_EXPLANATION: MCQ = {
  id: 'q3',
  question: 'Empty explanation?',
  options: ['Yes', 'No'],
  correct: 0,
  explanation: '',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MCGame', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('renders empty-state message when questions array is empty', () => {
    render(<MCGame questions={[]} onComplete={vi.fn()} resetSignal={0} />);
    expect(screen.getByText(/No questions configured/i)).toBeInTheDocument();
  });

  it('renders the first question and all its options', () => {
    render(<MCGame questions={[Q1]} onComplete={vi.fn()} resetSignal={0} />);
    expect(screen.getByText('What is 2 + 2?')).toBeInTheDocument();
    Q1.options.forEach(opt => {
      expect(screen.getByText(opt)).toBeInTheDocument();
    });
  });

  it('shows Q1/1 progress counter', () => {
    render(<MCGame questions={[Q1]} onComplete={vi.fn()} resetSignal={0} />);
    expect(screen.getByText('1/1')).toBeInTheDocument();
  });

  it('does not show the Next/Finish button before an answer is picked', () => {
    render(<MCGame questions={[Q1]} onComplete={vi.fn()} resetSignal={0} />);
    expect(screen.queryByRole('button', { name: /next|finish/i })).toBeNull();
  });

  it('picking the correct answer shows ✅ and reveals Next button', () => {
    render(<MCGame questions={[Q1, Q2]} onComplete={vi.fn()} resetSignal={0} />);
    // "4" is option index 1 → correct
    fireEvent.click(screen.getByText('4'));
    expect(screen.getByText('✅')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
  });

  it('picking the wrong answer shows ❌ and 💡 on correct option', () => {
    render(<MCGame questions={[Q1, Q2]} onComplete={vi.fn()} resetSignal={0} />);
    // "3" is option index 0 → wrong (correct is index 1 = "4")
    fireEvent.click(screen.getByText('3'));
    expect(screen.getByText('❌')).toBeInTheDocument();
    expect(screen.getByText('💡')).toBeInTheDocument();
  });

  it('displays the explanation text when an answer is revealed', () => {
    render(<MCGame questions={[Q1]} onComplete={vi.fn()} resetSignal={0} />);
    fireEvent.click(screen.getByText('4'));
    expect(screen.getByText(/Basic arithmetic/i)).toBeInTheDocument();
  });

  it('does NOT render explanation box when explanation is empty', () => {
    render(<MCGame questions={[Q_NO_EXPLANATION]} onComplete={vi.fn()} resetSignal={0} />);
    fireEvent.click(screen.getByText('Yes'));
    // The explanation prefix emoji should not appear
    expect(screen.queryByText(/💡 /)).toBeNull();
  });

  it('disables all option buttons after an answer is picked', () => {
    render(<MCGame questions={[Q1, Q2]} onComplete={vi.fn()} resetSignal={0} />);
    fireEvent.click(screen.getByText('3'));
    Q1.options.forEach(opt => {
      expect(screen.getByText(opt).closest('button')).toBeDisabled();
    });
  });

  it('clicking Next advances to the second question', () => {
    render(<MCGame questions={[Q1, Q2]} onComplete={vi.fn()} resetSignal={0} />);
    fireEvent.click(screen.getByText('4'));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByText(/capital of France/i)).toBeInTheDocument();
    expect(screen.getByText('2/2')).toBeInTheDocument();
  });

  it('last question shows "Finish ✓" instead of "Next →"', () => {
    render(<MCGame questions={[Q1]} onComplete={vi.fn()} resetSignal={0} />);
    fireEvent.click(screen.getByText('4'));
    expect(screen.getByRole('button', { name: /finish/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /next/i })).toBeNull();
  });

  it('shows done screen with correct score after last question', async () => {
    render(<MCGame questions={[Q1]} onComplete={vi.fn()} resetSignal={0} />);
    fireEvent.click(screen.getByText('4'));  // correct
    fireEvent.click(screen.getByRole('button', { name: /finish/i }));
    expect(screen.getByText(/1\/1 correct/i)).toBeInTheDocument();
    expect(screen.getByText(/🏆 Perfect score!/i)).toBeInTheDocument();
  });

  it('shows "Better luck next time" when score is 0', async () => {
    render(<MCGame questions={[Q1]} onComplete={vi.fn()} resetSignal={0} />);
    fireEvent.click(screen.getByText('3'));  // wrong
    fireEvent.click(screen.getByRole('button', { name: /finish/i }));
    expect(screen.getByText(/0\/1 correct/i)).toBeInTheDocument();
    expect(screen.getByText(/better luck next time/i)).toBeInTheDocument();
  });

  it('shows percentage accuracy for partial scores', async () => {
    render(<MCGame questions={[Q1, Q2]} onComplete={vi.fn()} resetSignal={0} />);
    // Q1: wrong
    fireEvent.click(screen.getByText('3'));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    // Q2: correct (Paris = index 2)
    fireEvent.click(screen.getByText('Paris'));
    fireEvent.click(screen.getByRole('button', { name: /finish/i }));
    expect(screen.getByText(/1\/2 correct/i)).toBeInTheDocument();
    expect(screen.getByText(/50% accuracy/i)).toBeInTheDocument();
  });

  it('calls onComplete with the right score after a 400ms delay', async () => {
    const onComplete = vi.fn();
    render(<MCGame questions={[Q1]} onComplete={onComplete} resetSignal={0} />);
    fireEvent.click(screen.getByText('4'));
    fireEvent.click(screen.getByRole('button', { name: /finish/i }));
    expect(onComplete).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledWith(1, 1);
  });

  it('calls onComplete with score 0 when no question was answered correctly', async () => {
    const onComplete = vi.fn();
    render(<MCGame questions={[Q1]} onComplete={onComplete} resetSignal={0} />);
    fireEvent.click(screen.getByText('3'));  // wrong
    fireEvent.click(screen.getByRole('button', { name: /finish/i }));
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(onComplete).toHaveBeenCalledWith(0, 1);
  });

  it('resets state when resetSignal changes', () => {
    const { rerender } = render(
      <MCGame questions={[Q1]} onComplete={vi.fn()} resetSignal={0} />
    );
    fireEvent.click(screen.getByText('4'));  // answer Q1
    expect(screen.getByText('✅')).toBeInTheDocument();

    rerender(<MCGame questions={[Q1]} onComplete={vi.fn()} resetSignal={1} />);
    // After reset, no answer is revealed
    expect(screen.queryByText('✅')).toBeNull();
  });

  it('progress bar reaches 100% when last question is answered', () => {
    render(<MCGame questions={[Q1]} onComplete={vi.fn()} resetSignal={0} />);
    fireEvent.click(screen.getByText('4'));
    // After answering the last question the progress div should have width 100%
    const bar = document.querySelector('[style*="width: 100%"]');
    expect(bar).not.toBeNull();
  });
});
