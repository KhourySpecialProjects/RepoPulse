import { useMemo } from 'react'

import { BrowserStorageCard } from '@/components/admin/BrowserStorageCard'
import { DiskStorageCard } from '@/components/admin/DiskStorageCard'
import { useAdminRepoStorage } from '@/hooks/useAdminStats'

/**
 * Storage tab: server-side figures, then this browser's localStorage.
 *
 * The two panels are deliberately not summed. Clone bytes on a server volume
 * and localStorage bytes in one administrator's browser are different things
 * measured in different places; a combined total would mean nothing.
 */

/** Server caps the page at 200. Ask for that in one request. */
const REPO_PAGE_LIMIT = 200

export function StorageTab() {
  const { data: repoPage } = useAdminRepoStorage({ limit: REPO_PAGE_LIMIT })

  const knownRepoIds = useMemo(() => {
    if (!repoPage) return undefined
    // Only claim to know the live repo set when we actually have all of it.
    // With a partial page, a repo beyond the limit would be misreported as
    // deleted and its browser keys wrongly flagged as orphaned. Undefined
    // means "not checked", and the panel hides the orphan line rather than
    // asserting zero.
    if (repoPage.items.length < repoPage.total) return undefined
    return repoPage.items.map((item) => item.id)
  }, [repoPage])

  return (
    <div className="flex flex-col gap-6">
      <DiskStorageCard />
      <BrowserStorageCard knownRepoIds={knownRepoIds} />
    </div>
  )
}
