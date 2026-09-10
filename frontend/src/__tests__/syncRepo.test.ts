import { it, expect } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { syncRepo } from '@/services/api'
it('shows actionable private-repository errors from the API', async () => {
  server.use(http.post('/api/v1/repos/private/sync', () => HttpResponse.json({ detail: 'Check Contents read access for this private repository.', error_code: 'REPO_SYNC_FAILED' }, { status: 502 })))
  await expect(syncRepo('private')).rejects.toThrow('Check Contents read access for this private repository.')
})
