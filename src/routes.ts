export const navigation = ['Office', 'Agents', 'Usage', 'Project Health', 'Telemetry', 'Task Board', 'Calendar', 'Activity', 'Memory', 'Folders', 'Logs', 'Settings'] as const
export type Page = typeof navigation[number] | 'Admin'

/** Owner-only pages, hidden from a vendor session and advertised separately to an admin one. */
export const ADMIN_PAGES = ['Admin'] as const
export type AdminPage = typeof ADMIN_PAGES[number]

export function isAdminPage(page: Page): page is AdminPage {
  return (ADMIN_PAGES as readonly string[]).includes(page)
}

/** The pages a role may see: an admin gets the owner-only ones too. */
export function pagesFor(role: 'admin' | 'vendor' | undefined): Page[] {
  const shared = [...navigation] as Page[]
  return role === 'admin' ? [...shared, ...ADMIN_PAGES] : shared
}

/** The page shown when the address names no page (or an unknown one). */
export const HOME: Page = 'Office'

export function pageSlug(page: Page): string {
  return page.toLowerCase().replace(/\s+/g, '-')
}

export function pageFromHash(hash: string): Page {
  const slug = hash.replace(/^#\/?/, '').split('/')[0].toLowerCase()
  if (slug === 'knowledge') return 'Memory'
  // The Dashboard's statistics now live in the Office HUD and panel.
  if (slug === 'dashboard') return 'Office'
  const shared = navigation.find((page) => pageSlug(page) === slug)
  if (shared) return shared
  const admin = ADMIN_PAGES.find((page) => pageSlug(page) === slug)
  return admin ?? HOME
}
