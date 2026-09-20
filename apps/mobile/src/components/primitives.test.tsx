// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Sheet, SegmentedControl, ToastProvider, useToast } from './primitives.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('Sheet', () => {
  it('renders nothing when closed', () => {
    render(
      <Sheet open={false} onClose={() => {}} title="Filters">
        body
      </Sheet>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders an accessible dialog with title and close action when open', () => {
    render(
      <Sheet open onClose={() => {}} title="Filters">
        body
      </Sheet>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { name: 'Filters' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close Filters' })).toBeInTheDocument();
  });

  it('moves focus to the close button on open', () => {
    render(
      <Sheet open onClose={() => {}} title="Filters">
        body
      </Sheet>,
    );
    expect(screen.getByRole('button', { name: 'Close Filters' })).toHaveFocus();
  });

  it('closes on Escape, backdrop click, and the close button', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Sheet open onClose={onClose} title="Filters">
        body
      </Sheet>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(document.querySelector('.sheet-backdrop')!);
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: 'Close Filters' }));
    expect(onClose).toHaveBeenCalledTimes(3);
    rerender(
      <Sheet open={false} onClose={onClose} title="Filters">
        body
      </Sheet>,
    );
  });

  it('does not dismiss a persistent sheet via Escape or backdrop', () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="Confirm" persistent>
        body
      </Sheet>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(document.querySelector('.sheet-backdrop')!);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('SegmentedControl', () => {
  const options = [
    { value: 'list', label: 'List' },
    { value: 'map', label: 'Map' },
  ] as const;

  it('marks the selected option and switches on click', () => {
    const onChange = vi.fn();
    render(<SegmentedControl label="Result view" options={options} value="list" onChange={onChange} />);
    const group = screen.getByRole('radiogroup', { name: 'Result view' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'List' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Map' })).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByRole('radio', { name: 'Map' }));
    expect(onChange).toHaveBeenCalledWith('map');
  });

  it('moves selection with arrow keys', () => {
    let value: string = 'list';
    const onChange = vi.fn((v: string) => {
      value = v;
    });
    const { rerender } = render(
      <SegmentedControl label="Result view" options={options} value={value as 'list' | 'map'} onChange={onChange} />,
    );
    const list = screen.getByRole('radio', { name: 'List' });
    list.focus();
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('map');
    rerender(<SegmentedControl label="Result view" options={options} value="map" onChange={onChange} />);
    expect(screen.getByRole('radio', { name: 'Map' })).toHaveAttribute('aria-checked', 'true');
  });
});

function ToastHarness({ kind = 'success' as const }: { kind?: 'success' | 'error' | 'info' }) {
  const toast = useToast();
  return <button onClick={() => toast.notify(kind, `${kind} happened`)}>notify</button>;
}

describe('Toast', () => {
  it('announces success/info via role=status and error via role=alert', () => {
    const { rerender } = render(
      <ToastProvider>
        <ToastHarness kind="success" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'notify' }));
    expect(screen.getByRole('status')).toHaveTextContent('success happened');

    rerender(
      <ToastProvider>
        <ToastHarness kind="error" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'notify' }));
    expect(screen.getByRole('alert')).toHaveTextContent('error happened');
  });

  it('dismisses manually via the dismiss button', () => {
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'notify' }));
    expect(screen.getByRole('status')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('auto-dismisses after a timeout', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'notify' }));
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('throws when useToast is used outside the provider', () => {
    function Bad() {
      useToast();
      return null;
    }
    expect(() => render(<Bad />)).toThrow('useToast must be used inside <ToastProvider>');
  });
});
