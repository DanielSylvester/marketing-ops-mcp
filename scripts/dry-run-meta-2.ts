import { getMetaAccount } from '../src/config.js'
import { MetaClient } from '../src/meta/client.js'

async function test() {
  for (const brand of ['smartworks', 'workstudio'] as const) {
    console.log(`\n=== ${brand.toUpperCase()} ===`)
    const c = new MetaClient(getMetaAccount(brand))

    // Test meta_list_ads
    try {
      const ads = await c.getPaginated(`/${c.accountId}/ads`, { fields: 'id,name,adset_id,creative{id},effective_status', limit: 3 })
      console.log('✅ meta_list_ads:', ads.length, 'ads')
    } catch (e) {
      console.log('❌ meta_list_ads:', (e as Error).message)
    }

    // Test correct page lookup via account promotable_page_ids
    try {
      const account = await c.get(`/${c.accountId}`, { fields: 'promotable_page_ids' })
      const pageIds: string[] = account.promotable_page_ids ?? []
      const pages = []
      for (const pid of pageIds.slice(0, 3)) {
        const p = await c.get(`/${pid}`, { fields: 'id,name,category' })
        pages.push(p)
      }
      console.log('✅ meta_get_pages (fixed):', pages.length, 'pages —', pages.map((p: any) => p.name).join(', '))
    } catch (e) {
      console.log('❌ meta_get_pages (fixed):', (e as Error).message)
    }
  }
}
test().catch(console.error)
