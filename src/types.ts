export interface Project {
  id: string;
  name: string;
  address?: string;
  createdAt: string;
  updatedAt: string;
  ownerId: string;
  lat?: number;
  lng?: number;
}

export interface GardenVersion {
  id: string;
  projectId: string;
  imageUrl: string;
  originalImageUrl?: string;
  maskUrl?: string;
  prompt: string;
  plantLegend?: string;
  createdAt: string;
  parentVersionId?: string;
}
