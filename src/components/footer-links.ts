export type FooterLink = { key: string; href: string }
export type FooterColumn = { title: string; links: FooterLink[] }

/** The public footer's columns. `to` prefixes content pages that exist in every language. */
export function footerColumns(to: (path: string) => string, lang: string = 'en'): FooterColumn[] {
  const fr = lang === 'fr'
  return [
    { title: 'product', links: [
      { key: 'pricing', href: `${to('/')}#pricing` },
      { key: 'solutions', href: fr ? '/fr/solutions/crm-whatsapp' : '/solutions/whatsapp-crm' },
      { key: 'templates', href: '/templates' },
      { key: 'linkGenerator', href: '/free-tools/whatsapp-link-generator' },
      { key: 'signupSync', href: '/solutions/sync-app-signups-to-crm' },
      { key: 'whatsappPricing', href: fr ? '/fr/solutions/tarifs-api-whatsapp-business' : '/solutions/whatsapp-business-api-pricing' },
      { key: 'costCalculator', href: '/free-tools/whatsapp-cost-calculator' },
      { key: 'apiDocs', href: '/docs' },
    ] },
    { title: 'resources', links: [
      { key: 'blog', href: to('/blog') },
      { key: 'help', href: to('/help') },
      { key: 'changelog', href: to('/changelog') },
      { key: 'compare', href: fr ? '/fr/compare' : '/compare' },
      { key: 'caseStudy', href: '/case-studies/ogadesk-crm' },
    ] },
    { title: 'company', links: [
      { key: 'partner', href: '/partners' },
      { key: 'login', href: '/login' },
    ] },
    { title: 'legal', links: [
      { key: 'privacy', href: '/privacy' },
      { key: 'terms', href: '/terms' },
      { key: 'dataDeletion', href: '/data-deletion' },
      { key: 'antiSpam', href: '/anti-spam' },
    ] },
  ]
}
