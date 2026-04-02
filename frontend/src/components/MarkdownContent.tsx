import { cn } from '@/lib/utils'

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)
  if (parts.length === 1) return text
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**'))
          return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
        if (part.startsWith('*') && part.endsWith('*'))
          return <em key={i}>{part.slice(1, -1)}</em>
        return part
      })}
    </>
  )
}

export function MarkdownContent({ content, className }: { content: string | null | undefined; className?: string }) {
  if (!content) return null

  const elements: React.ReactNode[] = []
  const listItems: string[] = []
  let listType: 'ul' | 'ol' | null = null

  function flushList() {
    if (!listItems.length) return
    const key = elements.length
    if (listType === 'ol') {
      elements.push(
        <ol key={key} className="list-decimal pl-4 space-y-0.5">
          {listItems.map((t, i) => <li key={i} className="text-sm leading-relaxed">{renderInline(t)}</li>)}
        </ol>
      )
    } else {
      elements.push(
        <ul key={key} className="list-disc pl-4 space-y-0.5">
          {listItems.map((t, i) => <li key={i} className="text-sm leading-relaxed">{renderInline(t)}</li>)}
        </ul>
      )
    }
    listItems.length = 0
    listType = null
  }

  for (const raw of content.split('\n')) {
    const line = raw.trim()

    if (!line) { flushList(); continue }

    if (/^---+$/.test(line)) { flushList(); elements.push(<hr key={elements.length} className="border-border" />); continue }
    if (line.startsWith('### ')) { flushList(); elements.push(<h3 key={elements.length} className="text-sm font-semibold mt-1">{renderInline(line.slice(4))}</h3>); continue }
    if (line.startsWith('## '))  { flushList(); elements.push(<h2 key={elements.length} className="text-sm font-semibold">{renderInline(line.slice(3))}</h2>); continue }
    if (line.startsWith('# '))   { flushList(); elements.push(<h1 key={elements.length} className="text-base font-semibold">{renderInline(line.slice(2))}</h1>); continue }

    const ulMatch = line.match(/^[-*]\s+(.+)/)
    if (ulMatch) { if (listType === 'ol') flushList(); listType = 'ul'; listItems.push(ulMatch[1]); continue }

    const olMatch = line.match(/^\d+\.\s+(.+)/)
    if (olMatch) { if (listType === 'ul') flushList(); listType = 'ol'; listItems.push(olMatch[1]); continue }

    flushList()
    elements.push(<p key={elements.length} className="text-sm leading-relaxed">{renderInline(line)}</p>)
  }

  flushList()

  return <div className={cn('flex flex-col gap-2', className)}>{elements}</div>
}
