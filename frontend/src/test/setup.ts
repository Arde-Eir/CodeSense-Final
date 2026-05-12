import '@testing-library/jest-dom';

// jsdom does not implement scrollIntoView — mock it so components that call
// it during animation (e.g. LogsTab's auto-scroll) don't throw in tests.
Element.prototype.scrollIntoView = () => {};
