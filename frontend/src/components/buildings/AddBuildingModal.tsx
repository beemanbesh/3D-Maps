import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { X } from 'lucide-react';
import { buildingsApi } from '@/services/api';
import type { CreateBuildingRequest } from '@/types';

interface AddBuildingModalProps {
  projectId: string;
  onClose: () => void;
}

export function AddBuildingModal({ projectId, onClose }: AddBuildingModalProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CreateBuildingRequest>({
    name: '',
    height_meters: 10,
    floor_count: 3,
    floor_height_meters: 3,
    roof_type: 'flat',
  });

  const mutation = useMutation({
    mutationFn: (data: CreateBuildingRequest) => buildingsApi.create(projectId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      toast.success('Building added!');
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate(form);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-xl bg-white p-5 shadow-2xl sm:rounded-xl sm:p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Add Building</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Building Name</label>
            <input
              type="text"
              value={form.name || ''}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder="e.g. Tower A"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Height (m)</label>
              <input
                type="number"
                value={form.height_meters || ''}
                onChange={(e) => setForm({ ...form, height_meters: parseFloat(e.target.value) || undefined })}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                min={1}
                step={0.5}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Floors</label>
              <input
                type="number"
                value={form.floor_count || ''}
                onChange={(e) => setForm({ ...form, floor_count: parseInt(e.target.value) || undefined })}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                min={1}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Floor Height (m)</label>
              <input
                type="number"
                value={form.floor_height_meters || ''}
                onChange={(e) => setForm({ ...form, floor_height_meters: parseFloat(e.target.value) || undefined })}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                min={2}
                max={10}
                step={0.1}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Roof Type</label>
              <select
                value={form.roof_type || 'flat'}
                onChange={(e) => setForm({ ...form, roof_type: e.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                <option value="flat">Flat</option>
                <option value="gabled">Gabled</option>
                <option value="hipped">Hipped</option>
                <option value="mansard">Mansard</option>
              </select>
            </div>
          </div>

          {mutation.isError && (
            <p className="text-sm text-red-600">Failed to create building. Please try again.</p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="btn-primary"
            >
              {mutation.isPending ? 'Creating...' : 'Add Building'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
