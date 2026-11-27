export type FooterLink = { key: string; href: string }
export type FooterColumn = { title: string; links: FooterLink[] }

/** The public footer's columns. `to` prefixes content pages that exist in every language. */
export function footerColumns(to: (path: string) => string): FooterColumn[] {
  return [
    { title: 'product', links: [
      { key: 'pricing', href: `${to('/')}#pricing` },
      { key: 'solutions', href: '/solutions/whatsapp-crm' },
      { key: 'templates', href: '/templates' },
      { key: 'linkGenerator', href: '/free-tools/whatsapp-link-generator' },
      { key: 'apiDocs', href: '/docs' },
    ] },
    { title: 'resources', links: [
      { key: 'blog', href: to('/blog') },
      { key: 'help', href: to('/help') },
      { key: 'changelog', href: to('/changelog') },
      { key: 'compare', href: '/compare/whatsapp-business-app' },
    ] },
    { title: 'company', links: [
      { key: 'partner', href: '/partners' },
      { key: 'login', href: '/login' },
    ] },
    { title: 'legal', links: [
      { key: 'privacy', href: '/privacy' },
      { key: 'terms', href: '/terms' },
      { key: 'dataDeletion', href: '/data-deletion' },
    ] },
  ]
}
