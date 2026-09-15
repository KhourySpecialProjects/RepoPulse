import { DiskStorageCard } from '@/components/admin/DiskStorageCard'

/**
 * Storage tab: server-side figures only.
 *
 * Clone bytes on the server volume and the database are the instance-wide
 * numbers an administrator can act on. A per-browser localStorage panel used
 * to sit below this one; it reported one administrator's own browser, which is
 * not a property of the instance, so it was removed rather than misread as a
 * fleet-wide figure.
 */
export function StorageTab() {
  return (
    <div className="flex flex-col gap-6">
      <DiskStorageCard />
    </div>
  )
}
