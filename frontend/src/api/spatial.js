import service from './index'

export const getSpatialScenarios = () => service.get('/api/spatial/scenarios')

export const generateSpatialScenario = (graphId, requirement = '') =>
  service.post('/api/spatial/generate', { graph_id: graphId, requirement })

export const startSpatialSim = (scenario, scenarioDict = null) => {
  const body = scenarioDict ? { scenario_dict: scenarioDict } : { scenario }
  return service.post('/api/spatial/start', body)
}

export const getSpatialState = (simId, since = -1) =>
  service.get(`/api/spatial/${simId}/state`, { params: { since } })

export const getSpatialReport = (simId) =>
  service.get(`/api/spatial/${simId}/report`).catch((err) => {
    if (err?.response?.status === 404) return null
    throw err
  })

export const interviewAgent = (simId, agentId, question) =>
  service.post(`/api/spatial/${simId}/interview`, { agent_id: agentId, question })

export const listSpatialRuns = () =>
  service.get('/api/spatial/runs')

export const loadSpatialRun = (simId) =>
  service.get(`/api/spatial/runs/${simId}`)
