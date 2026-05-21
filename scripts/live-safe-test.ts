import { getMetaAccount } from '../src/config.js'
import { MetaClient } from '../src/meta/client.js'

async function safeTest() {
  const brand = 'smartworks'
  const c = new MetaClient(getMetaAccount(brand))

  // 1. Find a PAUSED campaign (fetch then filter locally)
  const campaigns = await c.getPaginated(`/${c.accountId}/campaigns`, {
    fields: 'id,name,effective_status',
    limit: 50,
  })

  const paused = campaigns.filter((camp: any) => camp.effective_status === 'PAUSED')

  if (paused.length === 0) {
    console.log('No PAUSED campaigns found for safe testing')
    return
  }

  const target = paused[0]
  console.log(`Target campaign: ${target.name} (${target.id}) — status: ${target.effective_status}`)

  const originalName = target.name
  const testName = `${originalName}-test`

  // 2. Rename to test name
  console.log(`Renaming to: ${testName}`)
  await c.post(`/${target.id}`, { name: testName })

  // 3. Verify rename
  const verify = await c.get(`/${target.id}`, { fields: 'id,name,effective_status' })
  console.log(`Verified name: ${verify.name}`)

  // 4. Rename back immediately
  console.log(`Renaming back to: ${originalName}`)
  await c.post(`/${target.id}`, { name: originalName })

  // 5. Final verify
  const final = await c.get(`/${target.id}`, { fields: 'id,name,effective_status' })
  console.log(`Final name: ${final.name}`)

  if (final.name === originalName) {
    console.log('\n✅ SAFE TEST PASSED: Rename out and back succeeded without side effects')
  } else {
    console.log('\n⚠️ NAME MISMATCH — please check manually in Ads Manager')
  }
}

safeTest().catch(err => {
  console.error('❌ TEST FAILED:', err.message)
  process.exit(1)
})
