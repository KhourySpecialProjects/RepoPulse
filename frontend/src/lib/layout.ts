/**
 * Shared page chrome, so every page's title bar is identical in height.
 *
 * The bar is a minimum height rather than fixed padding: a plain title gets the
 * full, deliberately roomy bar, while headers that legitimately carry more
 * (a back arrow, tags, health signals) grow instead of being clipped.
 */
export const PAGE_HEADER_CLASS =
  'flex min-h-[5.25rem] items-center border-b border-border bg-white px-6 py-5'

/**
 * Page body padding. Slightly deeper at the top than the bottom so content
 * clears the taller title bar instead of crowding it.
 */
export const PAGE_BODY_CLASS = 'px-6 pt-8 pb-6'

/**
 * The spacing scale for a detail page's layout. Two values, one role each.
 *
 * Every sibling gap on RepoDetailPage used to be picked locally — the body row
 * was 6, the section stack 3, the two-column grid 8, each column 6, and the
 * activity block 5. Nothing distinguished those jobs, so the page read as
 * drifting rather than deliberate. One name per role means a new section
 * cannot invent a sixth value.
 *
 * SECTION_GAP separates things that sit beside or beneath one another —
 * cards, panels, columns. PANEL_PADDING is what a card or panel puts between
 * its border and its contents. They are deliberately equal: a 16px gutter
 * inside a panel and 16px between panels makes the grid read as one rhythm.
 *
 * Within a panel, a heading and the body it introduces get `gap-2`/`mb-2`
 * (8px) — half a step, because that pair is one unit and should not look like
 * two stacked sections.
 */
export const SECTION_GAP = 'gap-4'
export const PANEL_PADDING = 'p-4'
