import { getMetaAccount } from '../src/config.js'
import { MetaClient } from '../src/meta/client.js'

async function test() {
  for (const brand of ['smartworks', 'workstudio'] as const) {
    console.log(`\n=== ${brand.toUpperCase()} ===`)
    const c = new MetaClient(getMetaAccount(brand))

    // Test fixed meta_get_pages
    try {
      const data = await c.getPaginated<{ id: string; name: string; category?: string }>(`/me/accounts`, {
        fields: 'id,name,category', limit: 50,
      })
      console.log('✅ meta_get_pages:', data.length, 'pages —', data.map(p => p.name).join(', '))
    } catch (e) {
      console.log('❌ meta_get_pages:', (e as Error).message)
    }
  }
}
test().catch(console.error)
