import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import toast from 'react-hot-toast';
import { Upload, FileText, Image, FileSpreadsheet, X, CheckCircle, AlertCircle } from 'lucide-react';
import { useUploadStore } from '@/store';
import { documentsApi } from '@/services/api';

const ACCEPTED_TYPES = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/tiff': ['.tiff'],
  'application/dxf': ['.dxf'],
  'text/csv': ['.csv'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/geo+json': ['.geojson'],
};

interface FileUploadProps {
  projectId: string;
  onUploadComplete?: () => void;
}

export function FileUpload({ projectId, onUploadComplete }: FileUploadProps) {
  const { files, addFiles, removeFile, updateFileStatus } = useUploadStore();

  const uploadFile = useCallback(
    async (fileEntry: { id: string; file: File }) => {
      updateFileStatus(fileEntry.id, 'uploading', 10);
      try {
        await documentsApi.upload(projectId, fileEntry.file);
        updateFileStatus(fileEntry.id, 'completed', 100);
        toast.success(`"${fileEntry.file.name}" uploaded — processing started`);
        onUploadComplete?.();
      } catch {
        updateFileStatus(fileEntry.id, 'failed', 0);
        toast.error(`Failed to upload "${fileEntry.file.name}"`);
      }
    },
    [projectId, updateFileStatus, onUploadComplete]
  );

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      addFiles(acceptedFiles);
    },
    [addFiles]
  );

  const pendingFiles = files.filter((f) => f.status === 'pending');
  const handleUploadAll = useCallback(() => {
    pendingFiles.forEach((f) => uploadFile(f));
  }, [pendingFiles, uploadFile]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    maxSize: 100 * 1024 * 1024, // 100MB
  });

  const getFileIcon = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (ext === 'pdf') return <FileText size={16} className="text-red-500" />;
    if (['jpg', 'jpeg', 'png', 'tiff'].includes(ext || '')) return <Image size={16} className="text-green-500" />;
    if (['csv', 'xlsx'].includes(ext || '')) return <FileSpreadsheet size={16} className="text-blue-500" />;
    return <FileText size={16} className="text-gray-500" />;
  };

  return (
    <div>
      <div
        {...getRootProps()}
        className={`cursor-pointer rounded-xl border-2 border-dashed p-5 text-center transition-colors sm:p-8 ${
          isDragActive
            ? 'border-primary-400 bg-primary-50'
            : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
        }`}
      >
        <input {...getInputProps()} />
        <Upload className="mx-auto mb-3 h-10 w-10 text-gray-400" />
        <p className="text-sm font-medium text-gray-700">
          {isDragActive ? 'Drop files here...' : 'Drag & drop architectural documents'}
        </p>
        <p className="mt-1 text-xs text-gray-500">
          PDF, Images, CAD (DXF), Excel/CSV, GeoJSON — up to 100MB
        </p>
      </div>

      {files.length > 0 && (
        <div className="mt-4 space-y-2">
          {files.map((f) => (
            <div
              key={f.id}
              className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3"
            >
              {getFileIcon(f.file.name)}
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium text-gray-700">{f.file.name}</p>
                <p className="text-xs text-gray-500">
                  {(f.file.size / 1024 / 1024).toFixed(1)} MB — {f.status}
                </p>
              </div>
              {f.status === 'pending' && (
                <button onClick={() => removeFile(f.id)} className="text-gray-400 hover:text-red-500">
                  <X size={16} />
                </button>
              )}
              {(f.status === 'uploading' || f.status === 'processing') && (
                <div className="h-1.5 w-20 overflow-hidden rounded-full bg-gray-200">
                  <div
                    className="h-full rounded-full bg-primary-500 transition-all"
                    style={{ width: `${f.progress}%` }}
                  />
                </div>
              )}
              {f.status === 'completed' && (
                <CheckCircle size={16} className="text-green-500" />
              )}
              {f.status === 'failed' && (
                <AlertCircle size={16} className="text-red-500" />
              )}
            </div>
          ))}
          {pendingFiles.length > 0 && (
            <button
              onClick={handleUploadAll}
              className="btn-primary mt-2 w-full"
            >
              <Upload size={16} className="mr-2" />
              Upload {pendingFiles.length} file{pendingFiles.length > 1 ? 's' : ''}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
