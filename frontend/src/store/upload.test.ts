import { describe, it, expect, beforeEach } from 'vitest';
import { useUploadStore } from './index';

beforeEach(() => {
  useUploadStore.setState({ files: [] });
});

function fakeFile(name: string, size = 1024): File {
  return new File(['x'.repeat(size)], name, { type: 'application/pdf' });
}

describe('UploadStore', () => {
  it('starts with empty files', () => {
    expect(useUploadStore.getState().files).toHaveLength(0);
  });

  it('adds files with pending status', () => {
    useUploadStore.getState().addFiles([fakeFile('a.pdf'), fakeFile('b.pdf')]);
    const { files } = useUploadStore.getState();
    expect(files).toHaveLength(2);
    expect(files[0].status).toBe('pending');
    expect(files[0].progress).toBe(0);
    expect(files[0].file.name).toBe('a.pdf');
  });

  it('updates file status', () => {
    useUploadStore.getState().addFiles([fakeFile('test.pdf')]);
    const fileId = useUploadStore.getState().files[0].id;

    useUploadStore.getState().updateFileStatus(fileId, 'uploading', 50);
    const updated = useUploadStore.getState().files[0];
    expect(updated.status).toBe('uploading');
    expect(updated.progress).toBe(50);
  });

  it('removes a file', () => {
    useUploadStore.getState().addFiles([fakeFile('a.pdf'), fakeFile('b.pdf')]);
    const idToRemove = useUploadStore.getState().files[0].id;

    useUploadStore.getState().removeFile(idToRemove);
    expect(useUploadStore.getState().files).toHaveLength(1);
  });

  it('clears completed files', () => {
    useUploadStore.getState().addFiles([fakeFile('a.pdf'), fakeFile('b.pdf')]);
    const [f1, f2] = useUploadStore.getState().files;

    useUploadStore.getState().updateFileStatus(f1.id, 'completed', 100);
    useUploadStore.getState().updateFileStatus(f2.id, 'uploading', 30);

    useUploadStore.getState().clearCompleted();
    const remaining = useUploadStore.getState().files;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].status).toBe('uploading');
  });
});
