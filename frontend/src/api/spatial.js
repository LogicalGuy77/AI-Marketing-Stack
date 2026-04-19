import service from './index'

export const getSpatialScenarios = () => service.get('/api/spatial/scenarios')

export const startSpatialSim = (scenario) =>
  service.post('/api/spatial/start', { scenario })

export const getSpatialState = (simId, since = -1) =>
  service.get(`/api/spatial/${simId}/state`, { params: { since } })

export const getSpatialReport = (simId) =>
  service.get(`/api/spatial/${simId}/report`).catch((err) => {
    if (err?.response?.status === 404) return null
    throw err
  })
