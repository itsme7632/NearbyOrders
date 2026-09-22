import { describe, expect, it, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { OwnerVerification } from './OwnerVerificationScreen.js';
import * as api from '../api.js';
import type { VerificationApplication, VerificationDocument, VerificationDraft, VerificationState } from '../api.js';

afterEach(cleanup);

const categories = [{ id: 'cat-food', name: 'Food', slug: 'food', isActive: true }];

const draftApp: VerificationApplication = {
  id: 'ver-1',
  status: 'DRAFT',
  reviewerMessage: null,
  legalName: 'Butt Spices (Pvt) Ltd',
  publicName: 'Butt Spices',
  ownerName: 'Ayesha Khan',
  phone: '+92 300 1234567',
  address: '12 Food Street',
  city: 'Karachi',
  categoryId: 'cat-food',
  description: null,
  latitude: 24.86,
  longitude: 67.0,
  registrationInfo: null,
  submittedAt: null,
  reviewedAt: null,
};

const doc = {
  id: 'doc-1',
  docType: 'IDENTITY',
  storageKey: 'verifications/d.jpg',
  status: 'UPLOADED',
  uploadedAt: '2026-09-11T00:00:00.000Z',
};

const verificationState = (application: VerificationApplication | null, documents: VerificationState['documents'] = []): VerificationState => ({
  application,
  documents,
});

let verificationSpy: MockInstance<(businessId: string) => Promise<VerificationState>>;
let draftSpy: MockInstance<(businessId: string, draft: VerificationDraft) => Promise<VerificationApplication>>;
let submitSpy: MockInstance<(businessId: string) => Promise<VerificationApplication>>;
let uploadSpy: MockInstance<(businessId: string, file: File, docType: string) => Promise<VerificationDocument>>;

beforeEach(() => {
  vi.clearAllMocks();
  verificationSpy = vi.spyOn(api, 'getVerification').mockResolvedValue(verificationState(null));
  vi.spyOn(api, 'listCategories').mockResolvedValue(categories);
  // Spy every verification function up front so each test only adjusts the
  // already-installed mocks with mockResolvedValue/mockRejectedValue.
  draftSpy = vi.spyOn(api, 'updateVerificationDraft').mockResolvedValue(draftApp);
  submitSpy = vi.spyOn(api, 'submitVerification').mockResolvedValue({ ...draftApp, status: 'SUBMITTED' });
  uploadSpy = vi.spyOn(api, 'uploadVerificationDocument').mockResolvedValue(doc);
});

const fillValidDraft = async () => {
  fireEvent.change(screen.getByLabelText('Legal (registered) name'), { target: { value: 'Butt Spices (Pvt) Ltd' } });
  fireEvent.change(screen.getByLabelText('Owner full name'), { target: { value: 'Ayesha Khan' } });
  fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+92 300 1234567' } });
  fireEvent.change(screen.getByLabelText('Street address'), { target: { value: '12 Food Street' } });
  fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Karachi' } });
  // Category chips live inside the Field <label>; a button nested in a label
  // gets no accessible name from its contents, so query by text instead.
  const details = await screen.findByRole('region', { name: 'Verification details' });
  fireEvent.click(await within(details).findByText('Food'));
};

const pickDocument = () =>
  fireEvent.change(screen.getByLabelText('Document photo', { selector: 'input' }), {
    target: { files: [new File(['x'], 'cnic.png', { type: 'image/png' })] },
  });

describe('OwnerVerification (status and explainer)', () => {
  it('shows the not-started state and the honest explainer before any application', async () => {
    render(<OwnerVerification businessId="biz-1" />);
    expect(await screen.findByText('Not started')).toBeTruthy();
    expect(screen.getByText('Why verification is required')).toBeTruthy();
    expect(screen.getByText('What you need')).toBeTruthy();
    expect(screen.getByText('What happens after you submit')).toBeTruthy();
  });

  it('hydrates the draft form from the server application without overwriting', async () => {
    verificationSpy.mockResolvedValue(verificationState(draftApp));
    render(<OwnerVerification businessId="biz-1" />);
    await waitFor(() =>
      expect((screen.getByLabelText('Legal (registered) name') as HTMLInputElement).value).toBe(
        'Butt Spices (Pvt) Ltd',
      ),
    );
    expect((screen.getByLabelText('Owner full name') as HTMLInputElement).value).toBe('Ayesha Khan');
    expect((screen.getByLabelText('Phone') as HTMLInputElement).value).toBe('+92 300 1234567');
  });

  it('locks the form while the application is under review', async () => {
    verificationSpy.mockResolvedValue(verificationState({ ...draftApp, status: 'SUBMITTED' }, [doc]));
    render(<OwnerVerification businessId="biz-1" />);
    expect(await screen.findByText('Submitted')).toBeTruthy();
    expect(screen.getByText(/Your application is with the review team/)).toBeTruthy();
    expect(screen.queryByLabelText('Legal (registered) name')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Submit for verification' })).toBeNull();
  });

  it('shows the reviewer message and stays editable on rejection', async () => {
    verificationSpy.mockResolvedValue(
      verificationState({ ...draftApp, status: 'REJECTED', reviewerMessage: 'The CNIC photo is blurry.' }),
    );
    render(<OwnerVerification businessId="biz-1" />);
    expect(await screen.findByText('Rejected')).toBeTruthy();
    expect(screen.getByText(/The CNIC photo is blurry\./)).toBeTruthy();
    expect(screen.getByLabelText('Legal (registered) name')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Submit for verification' })).toBeTruthy();
  });

  it('shows the verified badge state after approval', async () => {
    verificationSpy.mockResolvedValue(verificationState({ ...draftApp, status: 'APPROVED' }, [doc]));
    render(<OwnerVerification businessId="biz-1" />);
    expect(await screen.findByText('Approved')).toBeTruthy();
    expect(screen.getByText(/Your business is verified/)).toBeTruthy();
  });
});

describe('OwnerVerification (draft and documents)', () => {
  it('saves the draft to the server with trimmed values', async () => {
    draftSpy.mockResolvedValue(draftApp);
    render(<OwnerVerification businessId="biz-1" />);
    await screen.findByRole('button', { name: 'Save draft' });
    await fillValidDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() =>
      expect(draftSpy).toHaveBeenCalledWith(
        'biz-1',
        expect.objectContaining({
          legalName: 'Butt Spices (Pvt) Ltd',
          ownerName: 'Ayesha Khan',
          phone: '+92 300 1234567',
          address: '12 Food Street',
          city: 'Karachi',
          categoryId: 'cat-food',
        }),
      ),
    );
  });

  it('uploads the document with the chosen doc type', async () => {
    uploadSpy.mockResolvedValue(doc);
    render(<OwnerVerification businessId="biz-1" />);
    await screen.findByRole('button', { name: 'Upload document' });
    fireEvent.click(screen.getByRole('button', { name: 'Business proof' }));
    pickDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Upload document' }));
    await waitFor(() =>
      expect(uploadSpy).toHaveBeenCalledWith('biz-1', expect.any(File), 'BUSINESS_PROOF'),
    );
    expect(await screen.findByText(/Document uploaded/)).toBeTruthy();
  });

  it('lists already-uploaded documents with their type labels', async () => {
    verificationSpy.mockResolvedValue(verificationState(draftApp, [doc]));
    render(<OwnerVerification businessId="biz-1" />);
    const docsRegion = await screen.findByRole('region', { name: 'Verification documents' });
    expect(docsRegion.textContent).toContain('Identity proof');
    expect(docsRegion.textContent).toContain('UPLOADED');
  });

  it('renders document statuses in plain English, not raw enum values', async () => {
    const pendingDoc = { ...doc, id: 'doc-p', status: 'PENDING' };
    const rejectedDoc = { ...doc, id: 'doc-r', status: 'REJECTED' };
    verificationSpy.mockResolvedValue(verificationState(draftApp, [pendingDoc, rejectedDoc]));
    render(<OwnerVerification businessId="biz-1" />);
    const docsRegion = await screen.findByRole('region', { name: 'Verification documents' });
    expect(docsRegion.textContent).toContain('Pending review');
    expect(docsRegion.textContent).toContain('Rejected');
    expect(docsRegion.textContent).not.toContain('PENDING');
  });

  it('states honestly that documents are stored on the server, not preview-only', async () => {
    verificationSpy.mockResolvedValue(verificationState(draftApp, []));
    render(<OwnerVerification businessId="biz-1" />);
    const docsRegion = await screen.findByRole('region', { name: 'Verification documents' });
    // The real multipart endpoint persists documents server-side, so the
    // generic "image storage is not connected" notice must not appear here.
    expect(docsRegion.textContent).toContain('upload to the NearbyOrders server and stay attached');
    expect(docsRegion.textContent).not.toContain('not connected');
    // A pending pick is still preview-only until the upload call succeeds.
    pickDocument();
    expect(docsRegion.textContent).toContain('Preview only. Not saved yet.');
  });
});

describe('OwnerVerification (submit)', () => {
  it('blocks submission until the draft is complete and a document exists', async () => {
    submitSpy.mockImplementation(() => { throw new Error('must not submit'); });
    render(<OwnerVerification businessId="biz-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Submit for verification' }));
    expect(await screen.findByText(/Enter the legal \(registered\) name/)).toBeTruthy();
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it('requires at least one uploaded document before submitting', async () => {
    submitSpy.mockImplementation(() => { throw new Error('must not submit'); });
    draftSpy.mockResolvedValue(draftApp);
    render(<OwnerVerification businessId="biz-1" />);
    await screen.findByRole('button', { name: 'Submit for verification' });
    await fillValidDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Submit for verification' }));
    expect(await screen.findByText(/Upload at least one document/)).toBeTruthy();
    expect(submitSpy).not.toHaveBeenCalled();
  });

  // The draft hydrates from the server in an effect, so wait for the values
  // before submitting so the test exercises the real hydrated flow.
  const waitForHydration = () =>
    waitFor(() =>
      expect((screen.getByLabelText('Legal (registered) name') as HTMLInputElement).value).toBe(
        'Butt Spices (Pvt) Ltd',
      ),
    );

  it('saves the draft then submits, and confirms honestly', async () => {
    verificationSpy.mockResolvedValue(verificationState(draftApp, [doc]));
    draftSpy.mockResolvedValue(draftApp);
    const submitSpy = vi
      .spyOn(api, 'submitVerification')
      .mockResolvedValue({ ...draftApp, status: 'SUBMITTED' });
    render(<OwnerVerification businessId="biz-1" />);
    await screen.findByRole('button', { name: 'Submit for verification' });
    await waitForHydration();
    fireEvent.click(screen.getByRole('button', { name: 'Submit for verification' }));
    // Draft saves first (hydrated values), then the submit call goes out.
    await waitFor(() => expect(draftSpy).toHaveBeenCalled());
    await waitFor(() => expect(submitSpy).toHaveBeenCalledWith('biz-1'));
    expect(await screen.findByText(/Submitted\. The NearbyOrders team will review/)).toBeTruthy();
  });

  it('surfaces submit API errors without losing the form', async () => {
    verificationSpy.mockResolvedValue(verificationState(draftApp, [doc]));
    draftSpy.mockResolvedValue(draftApp);
    submitSpy.mockRejectedValue(
      new api.ApiError(409, 'ALREADY_SUBMITTED', 'This application was already submitted.'),
    );
    render(<OwnerVerification businessId="biz-1" />);
    await screen.findByRole('button', { name: 'Submit for verification' });
    await waitForHydration();
    fireEvent.click(screen.getByRole('button', { name: 'Submit for verification' }));
    expect(await screen.findByText(/This application was already submitted\./)).toBeTruthy();
    expect(screen.getByLabelText('Legal (registered) name')).toBeTruthy();
  });
});
