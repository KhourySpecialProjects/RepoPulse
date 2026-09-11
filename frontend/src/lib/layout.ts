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
