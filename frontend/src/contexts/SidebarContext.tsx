import { createContext, useContext } from 'react'

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
