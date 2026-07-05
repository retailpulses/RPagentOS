import { useMemo, useState } from 'react'
import {
  auditListings,
  parseListingAuditFile,
  type ListingAuditActionType,
  type ListingAuditPriority,
  type ListingAuditResult,
} from '@packages/listing-audit'

const SAMPLE_CSV = `external_listing_id,platform,shop_code,sku,listing_title,description,current_price,stock_qty,listing_status,category,image_urls
csv-listing-001,mercari,shop4,SKU-CAT-001,猫ベッド グレー M,"ふわふわ素材の猫用ベッドです。サイズ M、カラー グレー。新品、送料込みで発送します。底面は滑りにくい仕様です。",2490,12,active,ペット用品,https://example.com/cat-bed-main.jpg|https://example.com/cat-bed-detail.jpg
csv-listing-002,mercari,shop4,SKU-DOG-002,犬服,"かわいい犬服です。",199,5,active,ペット用品,`

const ACTION_LABELS: Record<ListingAuditActionType, string> = {
  no_action: 'No Action',
  rewrite: 'Rewrite',
  manual_review: 'Manual Review',
  price_check: 'Price Check',
  image_fix: 'Image Fix',
}

const PRIORITY_LABELS: Record<ListingAuditPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

const ACTION_OPTIONS: Array<ListingAuditActionType | 'all'> = [
  'all',
  'price_check',
  'rewrite',
  'image_fix',
  'manual_review',
  'no_action',
]

export default function ListingAudit() {
  const [sourceName, setSourceName] = useState('pasted-listings.csv')
  const [input, setInput] = useState(SAMPLE_CSV)
  const [error, setError] = useState<string | null>(null)
  const [selectedAction, setSelectedAction] = useState<ListingAuditActionType | 'all'>('all')
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null)
  const [results, setResults] = useState<ListingAuditResult[]>(() => {
    return auditListings(parseListingAuditFile(SAMPLE_CSV, 'sample.csv')).results
  })

  const filteredResults = useMemo(() => {
    if (selectedAction === 'all') return results
    return results.filter(result => result.actionRecommendation.type === selectedAction)
  }, [results, selectedAction])

  const selectedResult = useMemo(() => {
    return filteredResults.find(result => result.listingId === selectedListingId) ?? filteredResults[0] ?? null
  }, [filteredResults, selectedListingId])

  const summary = useMemo(() => auditListings(results.map(result => result.sourceSnapshot)).summary, [results])

  const runAudit = (content = input, fileName = sourceName) => {
    try {
      const parsed = parseListingAuditFile(content, fileName)
      const batch = auditListings(parsed)
      setResults(batch.results)
      setSelectedListingId(batch.results[0]?.listingId ?? null)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    const content = await file.text()
    setSourceName(file.name)
    setInput(content)
    runAudit(content, file.name)
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Listing Audit</h2>
          <p className="text-sm text-muted mt-2">Review local listing exports before creating operator tasks.</p>
        </div>
        <div className="flex gap-2">
          <label className="btn">
            Upload CSV/JSON
            <input
              className="hidden-file-input"
              type="file"
              accept=".csv,.json,application/json,text/csv"
              onChange={event => void handleFile(event.target.files?.[0])}
            />
          </label>
          <button className="btn btn-primary" onClick={() => runAudit()}>
            Run Audit
          </button>
        </div>
      </div>

      <div className="audit-shell">
        <section className="audit-input-panel">
          <div className="flex justify-between items-center mb-3">
            <div>
              <h3>Input</h3>
              <p className="text-xs text-muted">{sourceName}</p>
            </div>
            <button className="btn btn-sm" onClick={() => {
              setSourceName('pasted-listings.csv')
              setInput(SAMPLE_CSV)
              runAudit(SAMPLE_CSV, 'sample.csv')
            }}>
              Reset Sample
            </button>
          </div>
          <textarea
            className="audit-input"
            value={input}
            spellCheck={false}
            onChange={event => setInput(event.target.value)}
          />
          {error && <p className="audit-error mt-3">{error}</p>}
        </section>

        <section className="audit-review-panel">
          <div className="audit-summary-grid">
            <SummaryMetric label="Listings" value={summary.total} />
            <SummaryMetric label="Avg Score" value={summary.averageScore} />
            <SummaryMetric label="High" value={summary.priorityCounts.high} tone="high" />
            <SummaryMetric label="Medium" value={summary.priorityCounts.medium} tone="medium" />
          </div>

          <div className="audit-toolbar">
            {ACTION_OPTIONS.map(action => (
              <button
                key={action}
                className={`audit-filter ${selectedAction === action ? 'active' : ''}`}
                onClick={() => {
                  setSelectedAction(action)
                  setSelectedListingId(null)
                }}
              >
                {action === 'all' ? 'All' : ACTION_LABELS[action]}
              </button>
            ))}
          </div>

          <div className="audit-results-layout">
            <div className="audit-result-list">
              {filteredResults.map(result => (
                <button
                  key={result.listingId}
                  className={`audit-result-row ${selectedResult?.listingId === result.listingId ? 'active' : ''}`}
                  onClick={() => setSelectedListingId(result.listingId)}
                >
                  <span>
                    <strong>{result.sourceSnapshot.title || result.listingId}</strong>
                    <small>{result.sku ?? result.listingId}</small>
                  </span>
                  <span className={`audit-priority ${result.actionRecommendation.priority}`}>
                    {PRIORITY_LABELS[result.actionRecommendation.priority]}
                  </span>
                </button>
              ))}
              {filteredResults.length === 0 && <p className="text-sm text-muted">No listings match this filter.</p>}
            </div>

            {selectedResult && <AuditDetail result={selectedResult} />}
          </div>
        </section>
      </div>
    </div>
  )
}

function SummaryMetric({ label, value, tone }: { label: string; value: number; tone?: ListingAuditPriority }) {
  return (
    <div className={`audit-metric ${tone ?? ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function AuditDetail({ result }: { result: ListingAuditResult }) {
  return (
    <article className="audit-detail">
      <div className="flex justify-between gap-3 mb-4">
        <div>
          <h3>{result.sourceSnapshot.title || result.listingId}</h3>
          <p className="text-xs text-muted">{result.platform} / {result.shopCode ?? 'unknown shop'} / {result.sku ?? 'no sku'}</p>
        </div>
        <div className="audit-score">{result.overallScore}</div>
      </div>

      <div className="audit-recommendation mb-4">
        <span className={`audit-priority ${result.actionRecommendation.priority}`}>
          {PRIORITY_LABELS[result.actionRecommendation.priority]}
        </span>
        <strong>{ACTION_LABELS[result.actionRecommendation.type]}</strong>
        <p>{result.actionRecommendation.reason}</p>
      </div>

      <IssueBlock title="Title" score={result.titleQuality.score} issues={result.titleQuality.issues} suggestion={result.titleQuality.suggestedTitle} />
      <IssueBlock title="Description" score={result.descriptionQuality.score} issues={result.descriptionQuality.issues} suggestion={result.descriptionQuality.suggestedDescription} />
      <IssueBlock title="Images" score={result.imageQuality.score} issues={result.imageQuality.issues} />
      <IssueBlock title="Pricing" score={result.pricingRisk.level === 'low' ? 100 : result.pricingRisk.level === 'medium' ? 70 : 35} issues={[result.pricingRisk.reason]} />
    </article>
  )
}

function IssueBlock({ title, score, issues, suggestion }: { title: string; score: number; issues: string[]; suggestion?: string }) {
  return (
    <section className="audit-issue-block">
      <div className="flex justify-between items-center">
        <h4>{title}</h4>
        <span>{score}</span>
      </div>
      {issues.length > 0 ? (
        <ul>
          {issues.map(issue => <li key={issue}>{issue}</li>)}
        </ul>
      ) : (
        <p className="text-sm text-muted">No issue found.</p>
      )}
      {suggestion && <pre>{suggestion}</pre>}
    </section>
  )
}
