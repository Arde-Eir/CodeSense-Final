import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TheorySectionBlock } from '../TheorySection';
import type { TheorySection } from '../../types/campaign';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TheorySectionBlock', () => {
  // ── default ──────────────────────────────────────────────────────────────────
  describe('default type', () => {
    it('renders heading and body', () => {
      const sec: TheorySection = { type: 'default', heading: 'My Heading', body: 'My body text' };
      render(<TheorySectionBlock sec={sec} />);
      expect(screen.getByText('My Heading')).toBeInTheDocument();
      expect(screen.getByText('My body text')).toBeInTheDocument();
    });

    it('renders bullets', () => {
      const sec: TheorySection = { type: 'default', bullets: ['First', 'Second', 'Third'] };
      render(<TheorySectionBlock sec={sec} />);
      expect(screen.getByText('First')).toBeInTheDocument();
      expect(screen.getByText('Second')).toBeInTheDocument();
      expect(screen.getByText('Third')).toBeInTheDocument();
    });

    it('renders term/definition items', () => {
      const sec: TheorySection = {
        items: [
          { term: 'Compiler', definition: 'Translates source to machine code' },
          { term: 'Linker',   definition: 'Combines object files' },
        ],
      };
      render(<TheorySectionBlock sec={sec} />);
      expect(screen.getByText('Compiler')).toBeInTheDocument();
      expect(screen.getByText('Translates source to machine code')).toBeInTheDocument();
      expect(screen.getByText('Linker')).toBeInTheDocument();
    });

    it('falls back to default when type is undefined', () => {
      const sec: TheorySection = { heading: 'Fallback' };
      render(<TheorySectionBlock sec={sec} />);
      expect(screen.getByText('Fallback')).toBeInTheDocument();
    });
  });

  // ── code ──────────────────────────────────────────────────────────────────
  describe('code type', () => {
    it('renders code content in a pre element', () => {
      const sec: TheorySection = { type: 'code', code: 'int main() { return 0; }' };
      render(<TheorySectionBlock sec={sec} />);
      expect(screen.getByText(/int main/)).toBeInTheDocument();
    });

    it('renders the language label', () => {
      const sec: TheorySection = { type: 'code', code: 'x = 1', language: 'Python' };
      render(<TheorySectionBlock sec={sec} />);
      expect(screen.getByText('Python')).toBeInTheDocument();
    });

    it('defaults language to "code" when not provided', () => {
      const sec: TheorySection = { type: 'code', code: 'x = 1' };
      render(<TheorySectionBlock sec={sec} />);
      expect(screen.getByText('code')).toBeInTheDocument();
    });

    it('renders heading inside the code block', () => {
      const sec: TheorySection = { type: 'code', code: 'x = 1', heading: 'Example' };
      render(<TheorySectionBlock sec={sec} />);
      expect(screen.getByText('Example')).toBeInTheDocument();
    });

    it('renders code_caption when provided', () => {
      const sec: TheorySection = { type: 'code', code: 'x = 1', code_caption: 'Sets x to 1' };
      render(<TheorySectionBlock sec={sec} />);
      expect(screen.getByText(/Sets x to 1/)).toBeInTheDocument();
    });
  });

  // ── did_you_know ──────────────────────────────────────────────────────────
  describe('did_you_know type', () => {
    it('renders DID YOU KNOW label', () => {
      const sec: TheorySection = { type: 'did_you_know', body: 'Interesting fact.' };
      render(<TheorySectionBlock sec={sec} />);
      expect(screen.getByText(/DID YOU KNOW/i)).toBeInTheDocument();
    });

    it('renders heading and body', () => {
      const sec: TheorySection = { type: 'did_you_know', heading: 'Fun Fact', body: 'CPUs run billions of ops per second' };
      render(<TheorySectionBlock sec={sec} />);
      expect(screen.getByText('Fun Fact')).toBeInTheDocument();
      expect(screen.getByText('CPUs run billions of ops per second')).toBeInTheDocument();
    });
  });

  // ── mistake ──────────────────────────────────────────────────────────────
  describe('mistake type', () => {
    it('renders WATCH OUT label', () => {
      const sec: TheorySection = { type: 'mistake' };
      render(<TheorySectionBlock sec={sec} />);
      expect(screen.getByText(/WATCH OUT/i)).toBeInTheDocument();
    });

    it('renders mistake wrong/right pairs', () => {
      const sec: TheorySection = {
        type: 'mistake',
        mistakes: [{ wrong: 'int x = "hello"', right: 'string x = "hello"', explanation: 'Type mismatch' }],
      };
      render(<TheorySectionBlock sec={sec} />);
      expect(screen.getByText(/int x = "hello"/)).toBeInTheDocument();
      expect(screen.getByText(/string x = "hello"/)).toBeInTheDocument();
      expect(screen.getByText(/Type mismatch/)).toBeInTheDocument();
    });

    it('renders body text', () => {
      const sec: TheorySection = { type: 'mistake', body: 'Avoid these common pitfalls.' };
      render(<TheorySectionBlock sec={sec} />);
      expect(screen.getByText('Avoid these common pitfalls.')).toBeInTheDocument();
    });
  });

  // ── tip ──────────────────────────────────────────────────────────────────
  describe('tip type', () => {
    it('renders TIPS label', () => {
      const sec: TheorySection = { type: 'tip' };
      render(<TheorySectionBlock sec={sec} />);
      expect(screen.getByText(/TIPS/i)).toBeInTheDocument();
    });

    it('renders tip cards with title and body', () => {
      const sec: TheorySection = {
        type: 'tip',
        tips: [
          { icon: '🚀', title: 'Speed tip', body: 'Precompute values.' },
          { title: 'Memory tip', body: 'Avoid leaks.' },
        ],
      };
      render(<TheorySectionBlock sec={sec} />);
      expect(screen.getByText('Speed tip')).toBeInTheDocument();
      expect(screen.getByText('Precompute values.')).toBeInTheDocument();
      expect(screen.getByText('Memory tip')).toBeInTheDocument();
      expect(screen.getByText('Avoid leaks.')).toBeInTheDocument();
    });
  });

  // ── summary ──────────────────────────────────────────────────────────────
  describe('summary type', () => {
    it('renders QUICK RECAP label', () => {
      const sec: TheorySection = { type: 'summary' };
      render(<TheorySectionBlock sec={sec} />);
      expect(screen.getByText(/QUICK RECAP/i)).toBeInTheDocument();
    });

    it('renders bullets with ✓ prefix', () => {
      const sec: TheorySection = {
        type: 'summary',
        bullets: ['Variables store data', 'Functions group logic'],
      };
      render(<TheorySectionBlock sec={sec} />);
      expect(screen.getByText('Variables store data')).toBeInTheDocument();
      expect(screen.getByText('Functions group logic')).toBeInTheDocument();
      expect(screen.getAllByText('✓')).toHaveLength(2);
    });

    it('renders heading and body', () => {
      const sec: TheorySection = { type: 'summary', heading: 'Key points', body: 'Remember this.' };
      render(<TheorySectionBlock sec={sec} />);
      expect(screen.getByText('Key points')).toBeInTheDocument();
      expect(screen.getByText('Remember this.')).toBeInTheDocument();
    });
  });

  // ── table ──────────────────────────────────────────────────────────────
  describe('table type', () => {
    const TABLE_SEC: TheorySection = {
      type: 'table',
      heading: 'Comparison',
      table_headers: ['Feature', 'C++', 'Python'],
      table_rows: [
        ['Speed', 'Fast', 'Slow'],
        ['Syntax', 'Verbose', 'Clean'],
      ],
    };

    it('renders the table heading', () => {
      render(<TheorySectionBlock sec={TABLE_SEC} />);
      expect(screen.getByText('Comparison')).toBeInTheDocument();
    });

    it('renders column headers', () => {
      render(<TheorySectionBlock sec={TABLE_SEC} />);
      expect(screen.getByText('Feature')).toBeInTheDocument();
      expect(screen.getByText('C++')).toBeInTheDocument();
      expect(screen.getByText('Python')).toBeInTheDocument();
    });

    it('renders all cell values', () => {
      render(<TheorySectionBlock sec={TABLE_SEC} />);
      expect(screen.getByText('Fast')).toBeInTheDocument();
      expect(screen.getByText('Slow')).toBeInTheDocument();
      expect(screen.getByText('Verbose')).toBeInTheDocument();
      expect(screen.getByText('Clean')).toBeInTheDocument();
    });

    it('renders body text below the table when provided', () => {
      const sec: TheorySection = { ...TABLE_SEC, body: 'Choose wisely.' };
      render(<TheorySectionBlock sec={sec} />);
      expect(screen.getByText('Choose wisely.')).toBeInTheDocument();
    });

    it('renders table without headers when table_headers is empty', () => {
      const sec: TheorySection = { type: 'table', table_rows: [['A', 'B']] };
      render(<TheorySectionBlock sec={sec} />);
      expect(screen.getByText('A')).toBeInTheDocument();
    });
  });

  // ── diagram ──────────────────────────────────────────────────────────────
  describe('diagram type', () => {
    it('renders the heading', () => {
      const sec: TheorySection = { type: 'diagram', heading: 'Flow diagram', diagram: 'https://example.com/img.png' };
      render(<TheorySectionBlock sec={sec} />);
      expect(screen.getByText('Flow diagram')).toBeInTheDocument();
    });

    it('renders an img tag with correct src and alt', () => {
      const sec: TheorySection = { type: 'diagram', heading: 'A diagram', diagram: 'https://example.com/img.png' };
      render(<TheorySectionBlock sec={sec} />);
      const img = screen.getByRole('img') as HTMLImageElement;
      expect(img.src).toBe('https://example.com/img.png');
      expect(img.alt).toBe('A diagram');
    });

    it('renders diagram_caption when provided', () => {
      const sec: TheorySection = { type: 'diagram', diagram: 'https://example.com/img.png', diagram_caption: 'Figure 1' };
      render(<TheorySectionBlock sec={sec} />);
      expect(screen.getByText('Figure 1')).toBeInTheDocument();
    });
  });
});
