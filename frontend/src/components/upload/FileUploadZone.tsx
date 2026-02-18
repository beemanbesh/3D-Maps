import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FileText, Image, FileSpreadsheet, X } from 'lucide-react';
import { useUploadStore } from '@/store';

const ACCEPTED_TYPES = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/tiff': ['.tiff'],
  'application/dxf': ['.dxf'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'text/csv': ['.csv'],
  'application/geo+json': ['.geojson'],
};

interface FileUploadZoneProps {
  projectId: string;
  onUpload?: (files: File[]) => void;
}

export function FileUploadZone({ projectId, onUpload }: FileUploadZoneProps) {
  const { files, addFiles, removeFile } = useUploadStore();

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      addFiles(acceptedFiles);
      onUpload?.(acceptedFiles);
    },
    [addFiles, onUpload]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    maxSize: 100 * 1024 * 1024, // 100MB
  });

  const fileIcon = (type: string) => {
    if (type.startsWith('image/')) return <Image size={16} className="text-green-500" />;
    if (type === 'application/pdf') return <FileText size={16} className="text-red-500" />;
    return <FileSpreadsheet size={16} className="text-blue-500" />;
  };

  return (
    <div>
      <div
        {...getRootProps()}
        className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          isDragActive
            ? 'border-primary-400 bg-primary-50'
            : 'border-gray-300 hover:border-gray-400'
        }`}
      >
        <input {...getInputProps()} />
        <Upload className="mx-auto mb-3 h-10 w-10 text-gray-400" />
        <p className="text-sm font-medium text-gray-700">
          {isDragActive ? 'Drop files here...' : 'Drag & drop files, or click to browse'}
        </p>
        <p className="mt-1 text-xs text-gray-500">
          PDF, Images, CAD (DXF), Excel, CSV, GeoJSON — up to 100MB
        </p>
      </div>

      {files.length > 0 && (
        <div className="mt-4 space-y-2">
          {files.map((f) => (
            <div
              key={f.id}
              className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3"
            >
              {fileIcon(f.file.type)}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900">{f.file.name}</p>
                <p className="text-xs text-gray-500">
                  {(f.file.size / 1024 / 1024).toFixed(1)} MB
                  {f.status !== 'pending' && (
                    <span className={`ml-2 capitalize ${
                      f.status === 'completed' ? 'text-green-600' :
                      f.status === 'failed' ? 'text-red-600' :
                      'text-amber-600'
                    }`}>
                      {f.status}
                    </span>
                  )}
                </p>
              </div>
              {f.status === 'uploading' && (
                <div className="h-1.5 w-24 rounded-full bg-gray-200">
                  <div
                    className="h-1.5 rounded-full bg-primary-500 transition-all"
                    style={{ width: `${f.progress}%` }}
                  />
                </div>
              )}
              <button
                onClick={() => removeFile(f.id)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
