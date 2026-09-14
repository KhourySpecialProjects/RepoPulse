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
}

export const SidebarContext = createContext<SidebarContextValue>({
  collapsed: false,
  setCollapsed: () => {},
  width: 220,
  setWidth: () => {},
})

export function useSidebar(): SidebarContextValue {
  return useContext(SidebarContext)
}
