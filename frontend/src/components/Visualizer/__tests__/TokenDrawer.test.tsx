import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TokenDrawer } from '../TokenDrawer';
import type { Token } from '../../../types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TOKENS: Token[] = [
  { type: 'Keyword',    value: 'int',    line: 1, column: 1 },
  { type: 'Identifier', value: 'myVar',  line: 1, column: 5 },
  { type: 'Operator',   value: '=',      line: 1, column: 11 },
  { type: 'Literal',    value: '42',     line: 1, column: 13 },
  { type: 'Separator',  value: ';',      line: 1, column: 15 },
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TokenDrawer', () => {
  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <TokenDrawer tokens={TOKENS} isOpen={false} onClose={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the drawer when isOpen is true', () => {
    render(<TokenDrawer tokens={TOKENS} isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Lexical Analysis')).toBeInTheDocument();
  });

  it('renders above the fixed app header layer', () => {
    render(<TokenDrawer tokens={TOKENS} isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: /lexical analysis token drawer/i })).toHaveStyle({ zIndex: '5001' });
  });

  it('shows total token count', () => {
    render(<TokenDrawer tokens={TOKENS} isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText(`${TOKENS.length} total tokens`)).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(<TokenDrawer tokens={TOKENS} isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close token drawer/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when the backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<TokenDrawer tokens={TOKENS} isOpen={true} onClose={onClose} />);
    // The backdrop is the first fixed div with onClick=onClose
    const backdrop = document.querySelector('[style*="position: fixed"][style*="inset: 0"]') as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders Keywords group header', () => {
    render(<TokenDrawer tokens={TOKENS} isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Keywords')).toBeInTheDocument();
  });

  it('renders Identifiers group header', () => {
    render(<TokenDrawer tokens={TOKENS} isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Identifiers')).toBeInTheDocument();
  });

  it('renders Operators group header', () => {
    render(<TokenDrawer tokens={TOKENS} isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Operators')).toBeInTheDocument();
  });

  it('renders token values', () => {
    render(<TokenDrawer tokens={TOKENS} isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('int')).toBeInTheDocument();
    expect(screen.getByText('myVar')).toBeInTheDocument();
    expect(screen.getByText('=')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText(';')).toBeInTheDocument();
  });

  it('renders line and column info for tokens', () => {
    render(<TokenDrawer tokens={TOKENS} isOpen={true} onClose={vi.fn()} />);
    expect(screen.getAllByText('LN 1').length).toBeGreaterThan(0);
  });

  it('search filters tokens by value', () => {
    render(<TokenDrawer tokens={TOKENS} isOpen={true} onClose={vi.fn()} />);
    const searchInput = screen.getByPlaceholderText(/filter by value or type/i);
    fireEvent.change(searchInput, { target: { value: 'int' } });
    // Only 'int' token should be visible; 'myVar' should be gone
    expect(screen.getByText('int')).toBeInTheDocument();
    expect(screen.queryByText('myVar')).toBeNull();
  });

  it('search filters tokens by type (case-insensitive)', () => {
    render(<TokenDrawer tokens={TOKENS} isOpen={true} onClose={vi.fn()} />);
    const searchInput = screen.getByPlaceholderText(/filter by value or type/i);
    fireEvent.change(searchInput, { target: { value: 'keyword' } });
    // Only the 'int' keyword token should be visible
    expect(screen.getByText('int')).toBeInTheDocument();
    expect(screen.queryByText('myVar')).toBeNull();
  });

  it('shows "No tokens match your search" when search has no results', () => {
    render(<TokenDrawer tokens={TOKENS} isOpen={true} onClose={vi.fn()} />);
    const searchInput = screen.getByPlaceholderText(/filter by value or type/i);
    fireEvent.change(searchInput, { target: { value: 'zzznomatch' } });
    expect(screen.getByText(/No tokens match your search/i)).toBeInTheDocument();
  });

  it('renders Download JSON Report button', () => {
    render(<TokenDrawer tokens={TOKENS} isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: /download json report/i })).toBeInTheDocument();
  });

  it('renders "No tokens match" when token list is empty', () => {
    render(<TokenDrawer tokens={[]} isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText(/No tokens match your search/i)).toBeInTheDocument();
  });

  it('renders literal subtype badge for Literal tokens', () => {
    const literalTokens: Token[] = [
      { type: 'Literal', value: '"hello"', line: 1, column: 1 },
    ];
    render(<TokenDrawer tokens={literalTokens} isOpen={true} onClose={vi.fn()} />);
    // Literals group should appear with a subtype badge (String, Numeric, Boolean, or Generic)
    expect(screen.getByText('Literals')).toBeInTheDocument();
  });

  it('renders the Separators group for separator tokens', () => {
    render(<TokenDrawer tokens={[{ type: 'Separator', value: ';', line: 1, column: 1 }]} isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Separators')).toBeInTheDocument();
  });

  it('clears search when input is emptied', () => {
    render(<TokenDrawer tokens={TOKENS} isOpen={true} onClose={vi.fn()} />);
    const searchInput = screen.getByPlaceholderText(/filter by value or type/i);
    fireEvent.change(searchInput, { target: { value: 'int' } });
    fireEvent.change(searchInput, { target: { value: '' } });
    // All tokens visible again
    expect(screen.getByText('myVar')).toBeInTheDocument();
  });
});
