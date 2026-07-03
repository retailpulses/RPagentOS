import type { TaskAttachmentRow } from '@lib/task-types'

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

interface TaskAttachmentsProps {
  attachments: TaskAttachmentRow[]
  onRemove?: (attachment: TaskAttachmentRow) => void
  removingId?: string | null
}

export default function TaskAttachments({ attachments, onRemove, removingId }: TaskAttachmentsProps) {
  if (attachments.length === 0) {
    return <p className="text-sm text-muted">No attachments yet.</p>
  }

  return (
    <div className="attachment-list">
      {attachments.map(file => {
        const isImage = file.content_type.startsWith('image/')
        return (
          <article key={file.id} className="attachment-item">
            {isImage && (
              <img
                src={file.file_data_url}
                alt={file.file_name}
                className="attachment-preview"
              />
            )}
            <div className="flex flex-col gap-1" style={{ minWidth: 0 }}>
              <div className="flex items-center justify-between gap-2">
                <a
                  href={file.file_data_url}
                  download={file.file_name}
                  className="font-medium truncate"
                  style={{ minWidth: 0 }}
                >
                  {file.file_name}
                </a>
                {onRemove && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => onRemove(file)}
                    disabled={removingId === file.id}
                  >
                    {removingId === file.id ? 'Removing...' : 'Remove'}
                  </button>
                )}
              </div>
              <div className="text-xs text-muted">
                {file.content_type || 'file'} · {formatBytes(file.file_size_bytes)} · {new Date(file.created_at).toLocaleString()}
              </div>
              {file.description && (
                <p className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>{file.description}</p>
              )}
            </div>
          </article>
        )
      })}
    </div>
  )
}
