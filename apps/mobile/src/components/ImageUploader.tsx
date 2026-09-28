import { useEffect, useRef, useState } from 'react';
import {
  disposePreviewUrl,
  getImageStorageProvider,
  IMAGE_ACCEPTED_TYPES,
  pickImageFile,
  STORAGE_NOT_CONNECTED_NOTICE,
} from '../upload.js';
import { AlertIcon } from './icons.js';

/** What the uploader reports after every user action. */
export type ImageUploaderState = {
  /** A real device file awaiting persistence — never sent to the API as-is. */
  pending: PendingImage | null;
  /** True when the user removed the previously saved image (persistable now). */
  removeSaved: boolean;
};

/** The shape of a picked-but-not-yet-stored image. */
export type PendingImage = {
  file: File;
  previewUrl: string | null;
  name: string;
  bytes: number;
  /** MIME type of the picked file (mirrors PickedImage for provider handoff). */
  type: string;
};

/**
 * Product-wide image rule: real "Upload image" UX, never an image-URL field.
 *
 * Behavior while no storage provider is connected (fallback, e.g. outside
 * the owner screens that register one):
 * - the user picks a real file and sees a real preview; they can replace or
 *   remove it at any time
 * - the component never claims a pending pick was saved. While a pick is
 *   pending it reports it via `onChange`, and the save handler must treat
 *   saving as unavailable (the UI shows the honest notice below) — no
 *   un-storable image silently disappears and no fake success is shown.
 * - removing the *previously saved* image is different: clearing the field is
 *   fully supported by the existing API, so `removeSaved` is persisted on the
 *   next successful save.
 *
 * When the image-storage provider is registered (owner screens), the same
 * component picks up real uploads via `getImageStorageProvider()` without UI
 * changes: the save handler uploads the pending pick through the provider
 * first, then persists the returned URL.
 */
export function ImageUploader(props: {
  /** Server-saved URL for the current image, or null. */
  currentUrl: string | null;
  /** Accessible label used for the input and buttons ("Business logo", …). */
  label: string;
  /** Reports the full uploader state after any pick/replace/remove. */
  onChange: (state: ImageUploaderState) => void;
  /**
   * Hides the "image storage is not connected" notice. Use only for uploaders
   * backed by a real server endpoint (e.g. the verification-document
   * multipart endpoint), where picked files are genuinely persisted and the
   * generic notice would be false. Defaults to false.
   */
  hideStorageNotice?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingImage | null>(null);
  const [removeSaved, setRemoveSaved] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);
  const provider = getImageStorageProvider();

  const report = (nextPending: PendingImage | null, nextRemoveSaved: boolean) => {
    props.onChange({ pending: nextPending, removeSaved: nextRemoveSaved });
  };

  useEffect(() => {
    return () => disposePreviewUrl(pending?.previewUrl ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const select = (file: File | undefined) => {
    if (!file) return;
    const result = pickImageFile(file);
    if ('reason' in result) {
      setRejection(result.reason);
      return;
    }
    setRejection(null);
    disposePreviewUrl(pending?.previewUrl ?? null);
    const next: PendingImage = {
      file: result.file,
      previewUrl: result.previewUrl,
      name: result.name,
      bytes: result.bytes,
      type: result.type,
    };
    setPending(next);
    report(next, false);
  };

  const remove = () => {
    disposePreviewUrl(pending?.previewUrl ?? null);
    if (pending) {
      // Remove an unsaved pick: back to the previously saved image (if any).
      setPending(null);
      report(null, removeSaved);
    } else {
      // Remove the saved image: persistable immediately via the API.
      setRemoveSaved(true);
      report(null, true);
    }
    setRejection(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const hasCurrent = !pending && !removeSaved && Boolean(props.currentUrl);
  const buttonLabel = pending ? 'Replace image' : hasCurrent ? 'Change image' : 'Upload image';

  return (
    <div className="image-uploader">
      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_ACCEPTED_TYPES.join(',')}
        className="image-input-hidden"
        aria-label={props.label}
        onChange={(e) => select(e.target.files?.[0])}
      />

      {pending ? (
        <div className="image-preview">
          {pending.previewUrl ? (
            <img src={pending.previewUrl} alt={`${props.label} preview`} className="image-preview-img" />
          ) : (
            <span className="image-preview-fallback" aria-hidden>
              {pending.name}
            </span>
          )}
          <div className="image-preview-meta">
            <span className="image-preview-name">{pending.name}</span>
            <span className="image-preview-note">Preview only. Not saved yet.</span>
          </div>
        </div>
      ) : hasCurrent ? (
        <div className="image-preview">
          <img src={props.currentUrl ?? undefined} alt={props.label} className="image-preview-img" />
          <div className="image-preview-meta">
            <span className="image-preview-name">Current image</span>
          </div>
        </div>
      ) : removeSaved ? (
        <p className="hint" role="status">
          Image will be removed when you save.
        </p>
      ) : null}

      <div className="btn-row">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => inputRef.current?.click()}>
          {buttonLabel}
        </button>
        {pending || hasCurrent ? (
          <button type="button" className="btn btn-danger btn-sm" onClick={remove}>
            Remove
          </button>
        ) : null}
      </div>

      {rejection ? (
        <p className="auth-error" role="alert">
          <AlertIcon size={14} /> {rejection}
        </p>
      ) : null}

      {!provider && !props.hideStorageNotice ? (
        <p className="hint" role="note">
          {STORAGE_NOT_CONNECTED_NOTICE}
        </p>
      ) : null}
    </div>
  );
}
