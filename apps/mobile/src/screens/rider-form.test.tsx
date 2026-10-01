import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { RiderForm } from './RiderForm.js';
import { setImageStorageProvider } from '../upload.js';
import type { Rider, RiderInput } from '../api.js';

afterEach(() => {
  cleanup();
  setImageStorageProvider(null);
});

const baseRider: Rider = {
  id: 'rider-1',
  businessId: 'biz-1',
  name: 'Ali Raza',
  phone: '+92 300 1234567',
  photoUrl: '/api/v1/images/uploads/rider1.png',
  note: null,
  isActive: true,
  createdAt: '2026-09-30T00:00:00.000Z',
  updatedAt: '2026-09-30T00:00:00.000Z',
};

const fillRequired = () => {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ali Raza' } });
  fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+92 300 1234567' } });
};

const pickFile = () => {
  const file = new File(['fake-image-bytes'], 'rider.png', { type: 'image/png' });
  const input = screen.getByLabelText('Rider photo', { selector: 'input' });
  fireEvent.change(input, { target: { files: [file] } });
  return file;
};

describe('RiderForm photo upload', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('has no image URL textbox - photo is an upload control', () => {
    render(<RiderForm saving={false} error={null} onSubmit={() => {}} onCancel={() => {}} />);
    expect(screen.queryByLabelText(/photo url/i)).toBeNull();
    expect(screen.queryByPlaceholderText('https://…')).toBeNull();
    expect(screen.getByLabelText('Rider photo', { selector: 'input' })).toBeTruthy();
    expect(screen.getByText('Optional - shown to customers with their delivery details.')).toBeTruthy();
  });

  it('create without a photo submits with photoUrl omitted (valid empty photo)', async () => {
    const onSubmit = vi.fn();
    render(<RiderForm saving={false} error={null} onSubmit={onSubmit} onCancel={() => {}} />);
    fillRequired();
    fireEvent.click(screen.getByText('Add rider'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const input = onSubmit.mock.calls[0][0] as RiderInput;
    expect(input.photoUrl).toBeUndefined();
    expect('photoUrl' in input && input.photoUrl === undefined).toBe(true);
  });

  it('edit without touching the photo preserves it (photoUrl omitted)', async () => {
    const onSubmit = vi.fn();
    render(<RiderForm initial={baseRider} saving={false} error={null} onSubmit={onSubmit} onCancel={() => {}} />);
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const input = onSubmit.mock.calls[0][0] as RiderInput;
    expect(input.photoUrl).toBeUndefined();
  });

  it('removing the saved photo submits photoUrl: null (explicit clear)', async () => {
    const onSubmit = vi.fn();
    render(<RiderForm initial={baseRider} saving={false} error={null} onSubmit={onSubmit} onCancel={() => {}} />);
    fireEvent.click(screen.getByText('Remove'));
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const input = onSubmit.mock.calls[0][0] as RiderInput;
    expect(input.photoUrl).toBeNull();
  });

  it('a picked photo uploads through the provider before submit', async () => {
    const upload = vi.fn().mockResolvedValue({ url: '/api/v1/images/uploads/rider-new.png' });
    setImageStorageProvider({ name: 'test', upload });
    const onSubmit = vi.fn();
    render(<RiderForm saving={false} error={null} onSubmit={onSubmit} onCancel={() => {}} />);
    fillRequired();
    const file = pickFile();
    fireEvent.click(screen.getByText('Add rider'));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({ file }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const input = onSubmit.mock.calls[0][0] as RiderInput;
    expect(input.photoUrl).toBe('/api/v1/images/uploads/rider-new.png');
  });

  it('a failed upload aborts the save and shows an error', async () => {
    const upload = vi.fn().mockRejectedValue(new Error('network down'));
    setImageStorageProvider({ name: 'test', upload });
    const onSubmit = vi.fn();
    render(<RiderForm saving={false} error={null} onSubmit={onSubmit} onCancel={() => {}} />);
    fillRequired();
    pickFile();
    fireEvent.click(screen.getByText('Add rider'));
    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toContain('network down');
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('a pending pick with no provider blocks save with an honest error', async () => {
    setImageStorageProvider(null);
    const onSubmit = vi.fn();
    render(<RiderForm saving={false} error={null} onSubmit={onSubmit} onCancel={() => {}} />);
    fillRequired();
    pickFile();
    fireEvent.click(screen.getByText('Add rider'));
    await waitFor(() =>
      expect(screen.getByText(/Remove the photo to save the rider without one/)).toBeTruthy(),
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
