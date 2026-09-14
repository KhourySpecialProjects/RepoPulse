import { createContext, useContext } from 'react'

/**
 * Space kept clear at the left edge while the sidebar is collapsed, so the
 * floating expand arrow (left-3 + w-8 = 44px) never overlaps page content
 * such as the back arrows in the repo and collection headers.
 */
export const COLLAPSED_GUTTER = 52

interface SidebarContextValue {
  collapsed: boolean
  setCollapsed: (v: boolean) => void
  width: number
  setWidth: (v: number) => void
  /** True while the user drags the resize handle, so width follows the cursor
   *  instead of easing toward it. Optional: consumers may omit it. */
  resizing?: boolean
  setResizing?: (v: boolean) => void
}

export const SidebarContext = createContext<SidebarContextValue>({
  collapsed: false,
  setCollapsed: () => {},
  width: 220,
  setWidth: () => {},
  resizing: false,
  setResizing: () => {},
})

export function useSidebar(): SidebarContextValue {
  return useContext(SidebarContext)
}
