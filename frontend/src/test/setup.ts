import '@testing-library/jest-dom';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

// jsdom does not implement scrollIntoView — mock it so components that call
// it during animation (e.g. LogsTab's auto-scroll) don't throw in tests.
Element.prototype.scrollIntoView = () => {};
