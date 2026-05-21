import { getMetaAccount } from '../src/config.js'
import { MetaClient } from '../src/meta/client.js'

async function verify() {
  const c = new MetaClient(getMetaAccount('smartworks'))
  const camp = await c.get('/120247152812270577', { fields: 'id,name,effective_status,updated_time' })
  console.log('Campaign ID:', camp.id)
  console.log('Name:', camp.name)
  console.log('Status:', camp.effective_status)
  console.log('Last updated:', camp.updated_time)
}
verify().catch(console.error)
