import React, { useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import type { OnMount } from '@monaco-editor/react';

interface CodeEditorProps {
  code: string;
  onChange: (value: string) => void;
  // This fix solves the "Property does not exist on type IntrinsicAttributes" error
  onEditorMount?: (editor: any) => void; 
}

export const CodeEditor: React.FC<CodeEditorProps> = ({ code, onChange, onEditorMount }) => {
  const [theme, setTheme] = useState<'vs-dark' | 'light'>('vs-dark');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleSupportText = (event: Event) => {
      if (!(event instanceof CustomEvent) || typeof event.detail !== 'string') return;
      if (!containerRef.current?.contains(document.activeElement)) return;
      onChange(event.detail);
    };
    window.addEventListener('codesense:support-editor-text', handleSupportText);
    return () => window.removeEventListener('codesense:support-editor-text', handleSupportText);
  }, [onChange]);

  const handleEditorChange = (value: string | undefined) => {
    onChange(value || '');
  };

  const toggleTheme = () => {
    setTheme(prev => (prev === 'vs-dark' ? 'light' : 'vs-dark'));
  };

  /**
   * handleOnMount uses the OnMount type from Monaco to solve 
   * the "Parameter implicitly has an any type" error.
   */
  const handleOnMount: OnMount = (editor) => {
    if (onEditorMount) {
      onEditorMount(editor);
    }
  };

  return (
    <div ref={containerRef} style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Mini-toolbar for the toggle */}
      <div style={{ 
        padding: '5px 10px', 
        background: theme === 'vs-dark' ? '#1e1e1e' : '#f3f3f3',
        borderBottom: '1px solid #333',
        display: 'flex',
        justifyContent: 'flex-end',
        flexShrink: 0
      }}>
        <button 
          onClick={toggleTheme}
          style={{
            fontSize: '11px',
            padding: '2px 8px',
            cursor: 'pointer',
            borderRadius: '4px',
            border: '1px solid #64b5f6',
            background: 'transparent',
            color: '#64b5f6'
          }}
        >
          {theme === 'vs-dark' ? '☀ Light Mode' : '🌙 Dark Mode'}
        </button>
      </div>

      <Editor
        height="100%"
        defaultLanguage="cpp"
        theme={theme}
        value={code}
        onChange={handleEditorChange}
        onMount={handleOnMount} // Captures the instance for the SandboxPage
        options={{
          fontSize: 14,
          minimap: { enabled: false },
          automaticLayout: true,
          scrollBeyondLastLine: false,
          lineNumbers: 'on',
          padding: { top: 10 }
        }}
      />
    </div>
  );
};
