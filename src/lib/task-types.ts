export type TaskType = string;
export type TaskStatus =
  | 'backlog'
  | 'planned'
  | 'in_progress'
  | 'waiting_approval'
  | 'blocked'
  | 'done'
  | 'canceled';
export type TaskPriority = string;
export type OwnerType = 'human' | 'agent' | 'mixed';
export type OwnerKey = string;
export type CreatedBy = 'jim' | 'system' | 'agent';
export type TaskSource = string;
export type AgentExecutionStatus =
  | 'not_ready'
  | 'approval_required'
  | 'approved'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'canceled';
export type StepStatus = 'todo' | 'in_progress' | 'blocked' | 'done' | 'skipped';
export type AuthorType = 'human' | 'agent' | 'system';
export type TaskSelectFieldKey =
  | 'task_type'
  | 'priority'
  | 'owner_type'
  | 'owner_key'
  | 'source'
  | 'platform'
  | 'shop_code'
  | 'target_type';

export interface TaskSelectOptionRow {
  id: string;
  field_key: TaskSelectFieldKey;
  option_key: string;
  label: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  task_type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  platform: string | null;
  shop_code: string | null;
  owner_type: OwnerType | null;
  owner_key: OwnerKey | null;
  due_date: string | null;
  scheduled_start_at: string | null;
  completed_at: string | null;
  source: TaskSource;
  approval_required: boolean;
  execution_brief: string | null;
  created_by: CreatedBy;
  approved_at: string | null;
  approved_by: string | null;
  agent_run_id: string | null;
  agent_execution_status: AgentExecutionStatus | null;
  project_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface TaskTargetRow {
  id: string;
  task_id: string;
  target_type: string;
  target_id: string | null;
  target_label: string | null;
  target_ref_json: Record<string, unknown>;
  created_at: string;
}

export interface TaskStepRow {
  id: string;
  task_id: string;
  position: number;
  title: string;
  description: string | null;
  status: StepStatus;
  owner_type: OwnerType | null;
  owner_key: OwnerKey | null;
  completed_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface TaskCommentRow {
  id: string;
  task_id: string;
  body: string;
  author_type: AuthorType | null;
  author_key: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface TaskLogRow {
  id: string;
  task_id: string;
  step_id: string | null;
  run_id: string | null;
  log_type: string;
  actor_type: AuthorType | null;
  actor_key: string | null;
  message: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface TaskAttachmentRow {
  id: string;
  task_id: string;
  file_name: string;
  content_type: string;
  file_size_bytes: number;
  file_data_url: string;
  uploaded_by: CreatedBy;
  description: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface TaskFilters {
  status?: TaskStatus[];
  priority?: TaskPriority[];
  task_type?: TaskType[];
  platform?: string;
  shop_code?: string;
  owner_type?: OwnerType;
  owner_key?: OwnerKey;
  due_before?: string;
  due_after?: string;
  scheduled_after?: string;
  scheduled_before?: string;
  approval_required?: boolean;
  search?: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  task_type: TaskType;
  priority: TaskPriority;
  platform?: string;
  shop_code?: string;
  owner_type?: OwnerType;
  owner_key?: OwnerKey;
  due_date?: string;
  scheduled_start_at?: string;
  source?: TaskSource;
  approval_required?: boolean;
  execution_brief?: string;
  created_by?: CreatedBy;
  project_id?: string | null;
  metadata?: Record<string, unknown>;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  task_type?: TaskType;
  priority?: TaskPriority;
  platform?: string | null;
  shop_code?: string | null;
  owner_type?: OwnerType | null;
  owner_key?: OwnerKey | null;
  due_date?: string | null;
  scheduled_start_at?: string | null;
  source?: TaskSource;
  approval_required?: boolean;
  execution_brief?: string | null;
  project_id?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CreateTaskTargetInput {
  target_type: string;
  target_id?: string;
  target_label?: string;
  target_ref_json?: Record<string, unknown>;
}

export interface CreateTaskStepInput {
  position: number;
  title: string;
  description?: string;
  owner_type?: OwnerType;
  owner_key?: OwnerKey;
}

export interface UpdateTaskStepInput {
  title?: string;
  description?: string;
  status?: StepStatus;
  owner_type?: OwnerType | null;
  owner_key?: OwnerKey | null;
}

export interface CreateTaskCommentInput {
  body: string;
  author_type?: AuthorType;
  author_key?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateTaskLogInput {
  log_type: string;
  step_id?: string;
  run_id?: string;
  actor_type?: AuthorType;
  actor_key?: string;
  message?: string;
  payload?: Record<string, unknown>;
}

export interface CreateTaskAttachmentInput {
  file_name: string;
  content_type: string;
  file_size_bytes: number;
  file_data_url: string;
  uploaded_by?: CreatedBy;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskCardRow extends TaskRow {
  target_count?: number;
  target_labels?: string[];
}

export interface TaskDetailRow {
  task: TaskRow;
  targets: TaskTargetRow[];
  steps: TaskStepRow[];
  comments: TaskCommentRow[];
  logs: TaskLogRow[];
  attachments: TaskAttachmentRow[];
}
