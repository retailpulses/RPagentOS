export type ProjectStatus = 'active' | 'paused' | 'completed' | 'archived';

export interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ProjectAttachmentRow {
  id: string;
  project_id: string;
  file_name: string;
  content_type: string;
  file_size_bytes: number;
  file_data_url: string;
  uploaded_by: string;
  description: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ProjectCardRow extends ProjectRow {
  task_count?: number;
}

export interface ProjectDetailRow {
  project: ProjectRow;
  attachments: ProjectAttachmentRow[];
  tasks: import('./task-types.js').TaskCardRow[];
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  status?: ProjectStatus;
  metadata?: Record<string, unknown>;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  status?: ProjectStatus;
  metadata?: Record<string, unknown>;
}

export interface CreateProjectAttachmentInput {
  file_name: string;
  content_type: string;
  file_size_bytes: number;
  file_data_url: string;
  uploaded_by?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}
