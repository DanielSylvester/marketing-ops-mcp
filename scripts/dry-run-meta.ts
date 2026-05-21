import { getMetaAccount } from '../src/config.js'
import { MetaClient } from '../src/meta/client.js'

async function dryRun() {
  const brands = ['smartworks', 'workstudio'] as const

  for (const brand of brands) {
    console.log(`\n=== ${brand.toUpperCase()} ===`)
    const c = new MetaClient(getMetaAccount(brand))

    // 1. Read: account info
    try {
      const account = await c.get(`/${c.accountId}`, { fields: 'id,name,account_status,currency' })
      console.log('✅ meta_get_ad_account:', account.name, `(${account.currency})`)
    } catch (e) {
      console.log('❌ meta_get_ad_account:', (e as Error).message)
    }

    // 2. Read: campaigns
    try {
      const camps = await c.getPaginated(`/${c.accountId}/campaigns`, { fields: 'id,name,objective,effective_status', limit: 5 })
      console.log('✅ meta_list_campaigns:', camps.length, 'campaigns')
      if (camps.length > 0) {
        const first = camps[0]
        console.log('   Sample:', first.name, `(${first.effective_status})`)

        // 3. Read: ad sets for first campaign
        try {
          const adsets = await c.getPaginated(`/${first.id}/adsets`, { fields: 'id,name,effective_status', limit: 3 })
          console.log('✅ meta_list_adsets:', adsets.length, 'adsets for campaign', first.id)
        } catch (e) {
          console.log('❌ meta_list_adsets:', (e as Error).message)
        }
      }
    } catch (e) {
      console.log('❌ meta_list_campaigns:', (e as Error).message)
    }

    // 4. Read: pages
    try {
      const pages = await c.getPaginated(`/${c.accountId}/promotable_pages`, { fields: 'id,name', limit: 3 })
      console.log('✅ meta_get_pages:', pages.length, 'pages')
    } catch (e) {
      console.log('❌ meta_get_pages:', (e as Error).message)
    }

    // 5. Read: insights (last 7 days)
    try {
      const until = new Date().toISOString().split('T')[0]
      const since = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]
      const insights = await c.get(`/${c.accountId}/insights`, {
        fields: 'spend,impressions,clicks',
        time_range: JSON.stringify({ since, until }),
        level: 'campaign',
      })
      console.log('✅ meta_insights:', insights.data?.length ?? 0, 'rows')
    } catch (e) {
      console.log('❌ meta_insights:', (e as Error).message)
    }

    // 6. Write dry-run: update non-existent campaign (should error gracefully)
    try {
      await c.post('/99999999999', { name: 'DryRunTest' })
      console.log('⚠️ meta_update_campaign: unexpected success')
    } catch (e) {
      const msg = (e as Error).message
      if (msg.includes('Invalid parameter') || msg.includes('does not exist') || msg.includes('code=')) {
        console.log('✅ meta_update_campaign: properly rejected invalid ID (', msg.slice(0, 60), '...)')
      } else {
        console.log('❌ meta_update_campaign:', msg)
      }
    }

    // 7. Write dry-run: create campaign with empty name (Meta will reject)
    try {
      await c.post(`/${c.accountId}/campaigns`, {
        name: '',
        objective: 'OUTCOME_LEADS',
        status: 'PAUSED',
      })
      console.log('⚠️ meta_create_campaign: unexpected success')
    } catch (e) {
      const msg = (e as Error).message
      if (msg.includes('name') || msg.includes('required') || msg.includes('Invalid') || msg.includes('code=')) {
        console.log('✅ meta_create_campaign: properly validated empty name (', msg.slice(0, 60), '...)')
      } else {
        console.log('❌ meta_create_campaign:', msg)
      }
    }

    // 8. Write dry-run: create adset with bad campaign_id
    try {
      await c.post(`/${c.accountId}/adsets`, {
        name: 'DryRun',
        campaign_id: '99999999999',
        billing_event: 'IMPRESSIONS',
        optimization_goal: 'LEAD_GENERATION',
        status: 'PAUSED',
      })
      console.log('⚠️ meta_create_adset: unexpected success')
    } catch (e) {
      const msg = (e as Error).message
      if (msg.includes('Invalid') || msg.includes('does not exist') || msg.includes('code=')) {
        console.log('✅ meta_create_adset: properly rejected bad campaign (', msg.slice(0, 60), '...)')
      } else {
        console.log('❌ meta_create_adset:', msg)
      }
    }

    // 9. Write dry-run: create ad with bad adset_id
    try {
      await c.post(`/${c.accountId}/ads`, {
        name: 'DryRun',
        adset_id: '99999999999',
        creative: JSON.stringify({ object_story_spec: { page_id: '123', link_data: { message: 'test' } } }),
        status: 'PAUSED',
      })
      console.log('⚠️ meta_create_ad: unexpected success')
    } catch (e) {
      const msg = (e as Error).message
      if (msg.includes('Invalid') || msg.includes('does not exist') || msg.includes('code=')) {
        console.log('✅ meta_create_ad: properly rejected bad adset (', msg.slice(0, 60), '...)')
      } else {
        console.log('❌ meta_create_ad:', msg)
      }
    }
  }
}

dryRun().catch(console.error)
