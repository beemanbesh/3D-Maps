import axios from 'axios';
import type {
  Project,
  Building,
  Document,
  ProcessingStatus,
  CreateProjectRequest,
  UpdateProjectRequest,
  CreateBuildingRequest,
  SiteZone,
  SiteZoneType,
  SiteZoneProperties,
  GenerationStatus,
  AITemplate,
} from '@/types';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptor for auth token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor for automatic token refresh on 401
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest.url?.includes('/auth/')
    ) {
      originalRequest._retry = true;
      const refreshToken = localStorage.getItem('refresh_token');
      if (refreshToken) {
        try {
          const { data } = await api.post('/api/v1/auth/refresh', {
            refresh_token: refreshToken,
          });
          localStorage.setItem('access_token', data.access_token);
          localStorage.setItem('refresh_token', data.refresh_token);
          originalRequest.headers.Authorization = `Bearer ${data.access_token}`;
          return api(originalRequest);
        } catch {
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
          window.location.href = '/login';
        }
      }
    }
    return Promise.reject(error);
  }
);

// =============================================================================
// Auth
// =============================================================================

export interface AuthUser {
  id: string;
  email: string;
  full_name?: string;
  role: string;
  is_active: boolean;
  created_at: string;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: AuthUser;
}

export const authApi = {
  register: async (email: string, password: string, fullName?: string): Promise<AuthUser> => {
    const { data } = await api.post('/api/v1/auth/register', {
      email,
      password,
      full_name: fullName,
    });
    return data;
  },

  login: async (email: string, password: string): Promise<AuthTokens> => {
    const { data } = await api.post('/api/v1/auth/login', { email, password });
    localStorage.setItem('access_token', data.access_token);
    localStorage.setItem('refresh_token', data.refresh_token);
    return data;
  },

  logout: () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
  },

  me: async (): Promise<AuthUser> => {
    const { data } = await api.get('/api/v1/auth/me');
    return data;
  },
};

// =============================================================================
// Projects
// =============================================================================

export const projectsApi = {
  list: async (skip = 0, limit = 20): Promise<Project[]> => {
    const { data } = await api.get(`/api/v1/projects?skip=${skip}&limit=${limit}`);
    return data;
  },

  get: async (id: string): Promise<Project> => {
    const { data } = await api.get(`/api/v1/projects/${id}`);
    return data;
  },

  create: async (project: CreateProjectRequest): Promise<Project> => {
    const { data } = await api.post('/api/v1/projects', project);
    return data;
  },

  update: async (id: string, project: UpdateProjectRequest): Promise<Project> => {
    const { data } = await api.put(`/api/v1/projects/${id}`, project);
    return data;
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`/api/v1/projects/${id}`);
  },
};

// =============================================================================
// Documents
// =============================================================================

export const documentsApi = {
  upload: async (projectId: string, file: File): Promise<Document> => {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post(
      `/api/v1/documents/projects/${projectId}/upload`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );
    return data;
  },

  triggerProcessing: async (documentId: string): Promise<ProcessingStatus> => {
    const { data } = await api.post(`/api/v1/documents/${documentId}/process`);
    return data;
  },

  getStatus: async (jobId: string): Promise<ProcessingStatus> => {
    const { data } = await api.get(`/api/v1/documents/status/${jobId}`);
    return data;
  },

  delete: async (documentId: string): Promise<void> => {
    await api.delete(`/api/v1/documents/${documentId}`);
  },
};

// =============================================================================
// Buildings
// =============================================================================

export const buildingsApi = {
  list: async (projectId: string): Promise<Building[]> => {
    const { data } = await api.get(`/api/v1/buildings/projects/${projectId}/buildings`);
    return data;
  },

  create: async (projectId: string, building: CreateBuildingRequest): Promise<Building> => {
    const { data } = await api.post(`/api/v1/buildings/projects/${projectId}/buildings`, building);
    return data;
  },

  get: async (id: string): Promise<Building> => {
    const { data } = await api.get(`/api/v1/buildings/${id}`);
    return data;
  },

  update: async (id: string, building: Partial<CreateBuildingRequest>): Promise<Building> => {
    const { data } = await api.put(`/api/v1/buildings/${id}`, building);
    return data;
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`/api/v1/buildings/${id}`);
  },

  getModelUrl: async (id: string): Promise<string> => {
    const { data } = await api.get(`/api/v1/buildings/${id}/model`);
    return data.model_url;
  },

  generate: async (id: string, prompt: string, artStyle = 'realistic', negativePrompt?: string): Promise<GenerationStatus> => {
    const { data } = await api.post(`/api/v1/buildings/${id}/generate`, {
      prompt,
      art_style: artStyle,
      negative_prompt: negativePrompt,
    });
    return data;
  },

  generateFromImage: async (id: string, imageUrl: string): Promise<GenerationStatus> => {
    const { data } = await api.post(`/api/v1/buildings/${id}/generate-from-image`, {
      image_url: imageUrl,
    });
    return data;
  },

  getGenerationStatus: async (id: string): Promise<GenerationStatus> => {
    const { data } = await api.get(`/api/v1/buildings/${id}/generation-status`);
    return data;
  },

  getTemplates: async (): Promise<AITemplate[]> => {
    const { data } = await api.get('/api/v1/buildings/ai/templates');
    return data;
  },
};

// =============================================================================
// Annotations
// =============================================================================

export interface Annotation {
  id: string;
  project_id: string;
  building_id?: string;
  author_id: string;
  text: string;
  position_x: number;
  position_y: number;
  position_z: number;
  resolved: boolean;
  created_at: string;
}

export const annotationsApi = {
  list: async (projectId: string, resolved?: boolean): Promise<Annotation[]> => {
    const params = resolved !== undefined ? `?resolved=${resolved}` : '';
    const { data } = await api.get(`/api/v1/annotations/projects/${projectId}/annotations${params}`);
    return data;
  },

  create: async (projectId: string, annotation: {
    text: string;
    building_id?: string;
    position_x: number;
    position_y: number;
    position_z: number;
  }): Promise<Annotation> => {
    const { data } = await api.post(`/api/v1/annotations/projects/${projectId}/annotations`, annotation);
    return data;
  },

  update: async (annotationId: string, update: { text?: string; resolved?: boolean }): Promise<Annotation> => {
    const { data } = await api.put(`/api/v1/annotations/${annotationId}`, update);
    return data;
  },

  delete: async (annotationId: string): Promise<void> => {
    await api.delete(`/api/v1/annotations/${annotationId}`);
  },
};

// =============================================================================
// Context (OSM)
// =============================================================================

export interface ContextBuilding {
  osm_id: number;
  name?: string;
  height: number;
  levels?: number;
  building_type: string;
  footprint: number[][]; // [[lon, lat], ...]
}

export interface ContextRoad {
  osm_id: number;
  name?: string;
  highway_type: string;
  width: number;
  coords: number[][]; // [[lon, lat], ...]
}

export const contextApi = {
  getBuildings: async (lat: number, lon: number, radius = 500): Promise<ContextBuilding[]> => {
    const { data } = await api.get(
      `/api/v1/context/buildings?lat=${lat}&lon=${lon}&radius=${radius}`
    );
    return data.buildings;
  },
  getRoads: async (lat: number, lon: number, radius = 500): Promise<ContextRoad[]> => {
    const { data } = await api.get(
      `/api/v1/context/roads?lat=${lat}&lon=${lon}&radius=${radius}`
    );
    return data.roads;
  },
};

// =============================================================================
// Sharing
// =============================================================================

export interface ProjectShareInfo {
  id: string;
  project_id: string;
  user_id?: string;
  email?: string;
  permission: string;
  is_public_link: boolean;
  invite_token?: string;
  created_at: string;
}

export interface PublicLinkInfo {
  token: string;
  url: string;
}

export const sharesApi = {
  share: async (projectId: string, email: string, permission = 'viewer'): Promise<ProjectShareInfo> => {
    const { data } = await api.post(`/api/v1/shares/projects/${projectId}/shares`, {
      email,
      permission,
    });
    return data;
  },

  list: async (projectId: string): Promise<ProjectShareInfo[]> => {
    const { data } = await api.get(`/api/v1/shares/projects/${projectId}/shares`);
    return data;
  },

  revoke: async (projectId: string, shareId: string): Promise<void> => {
    await api.delete(`/api/v1/shares/projects/${projectId}/shares/${shareId}`);
  },

  createPublicLink: async (projectId: string): Promise<PublicLinkInfo> => {
    const { data } = await api.post(`/api/v1/shares/projects/${projectId}/shares/public-link`);
    return data;
  },

  revokePublicLink: async (projectId: string): Promise<void> => {
    await api.delete(`/api/v1/shares/projects/${projectId}/shares/public-link`);
  },

  getSharedProject: async (token: string): Promise<Project> => {
    const { data } = await api.get(`/api/v1/shares/shared/${token}`);
    return data;
  },

  listSharedWithMe: async (): Promise<ProjectShareInfo[]> => {
    const { data } = await api.get('/api/v1/shares/shared-with-me');
    return data;
  },
};

// =============================================================================
// Activity Feed
// =============================================================================

export interface ActivityEntry {
  id: string;
  action: string;
  details?: Record<string, unknown>;
  user_email?: string;
  user_name?: string;
  created_at: string;
}

export const activityApi = {
  list: async (projectId: string, limit = 20): Promise<ActivityEntry[]> => {
    const { data } = await api.get(`/api/v1/activity/projects/${projectId}/activity?limit=${limit}`);
    return data;
  },
};

// =============================================================================
// Site Zones
// =============================================================================

export const siteZonesApi = {
  list: async (projectId: string): Promise<SiteZone[]> => {
    const { data } = await api.get(`/api/v1/site-zones/projects/${projectId}/zones`);
    return data;
  },

  create: async (projectId: string, zone: {
    name?: string;
    zone_type: SiteZoneType;
    coordinates: number[][];
    color: string;
    properties?: SiteZoneProperties;
    sort_order?: number;
  }): Promise<SiteZone> => {
    const { data } = await api.post(`/api/v1/site-zones/projects/${projectId}/zones`, zone);
    return data;
  },

  update: async (zoneId: string, update: {
    name?: string;
    zone_type?: SiteZoneType;
    coordinates?: number[][];
    color?: string;
    properties?: SiteZoneProperties;
    sort_order?: number;
  }): Promise<SiteZone> => {
    const { data } = await api.put(`/api/v1/site-zones/${zoneId}`, update);
    return data;
  },

  delete: async (zoneId: string): Promise<void> => {
    await api.delete(`/api/v1/site-zones/${zoneId}`);
  },
};

export default api;
