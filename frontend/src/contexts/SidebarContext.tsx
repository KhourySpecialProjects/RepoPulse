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
  /**
   * True while the resize handle is held. The open/close transition has to be
   * off during a drag, or the panel edge trails the cursor by the duration of
   * the animation and reads as the sidebar resisting you. Shared state rather
   * than a local ref because both the panel and the page content need it.
   */
  dragging: boolean
  setDragging: (v: boolean) => void
}

export const SidebarContext = createContext<SidebarContextValue>({
  collapsed: false,
  setCollapsed: () => {},
  width: 220,
  setWidth: () => {},
  dragging: false,
  setDragging: () => {},
})

export function useSidebar(): SidebarContextValue {
  return useContext(SidebarContext)
}
