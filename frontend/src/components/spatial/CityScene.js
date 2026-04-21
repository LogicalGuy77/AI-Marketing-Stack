import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js'

// Zone theming: each zone has a palette and a builder that composes distinctive 3D structures.
// ZONE_THEMES: keyed by zone NAME for backward compat with hardcoded scenarios.
const ZONE_THEMES = {
  Government: {
    accent: 0x3b82f6,
    wall: 0x6b7799,
    roof: 0x3d4a6a,
    ground: 0x2c3450,
    build: buildGovernmentZone,
  },
  University: {
    accent: 0xa855f7,
    wall: 0x6b5684,
    roof: 0x3e2f54,
    ground: 0x2d2340,
    build: buildUniversityZone,
  },
  Market: {
    accent: 0xf59e0b,
    wall: 0x7a6338,
    roof: 0x4d3a1a,
    ground: 0x3a2c1a,
    build: buildMarketZone,
  },
  Industrial: {
    accent: 0x94a3b8,
    wall: 0x525866,
    roof: 0x34394a,
    ground: 0x252a38,
    build: buildIndustrialZone,
  },
  Residential: {
    accent: 0x10b981,
    wall: 0x4f6455,
    roof: 0x2c4034,
    ground: 0x243329,
    build: buildResidentialZone,
  },
  Park: {
    accent: 0x84cc16,
    wall: 0x425a2e,
    roof: 0x26361c,
    ground: 0x253c1c,
    build: buildParkZone,
  },
}

// ZONE_BLUEPRINTS: keyed by zone ARCHETYPE for dynamic scenarios.
// LLM picks an archetype; the renderer looks it up here.
const ZONE_BLUEPRINTS = {
  government:  { accent: 0x3b82f6, wall: 0x6b7799, roof: 0x3d4a6a, ground: 0x2c3450, build: buildGovernmentZone },
  university:  { accent: 0xa855f7, wall: 0x6b5684, roof: 0x3e2f54, ground: 0x2d2340, build: buildUniversityZone },
  market:      { accent: 0xf59e0b, wall: 0x7a6338, roof: 0x4d3a1a, ground: 0x3a2c1a, build: buildMarketZone },
  industrial:  { accent: 0x94a3b8, wall: 0x525866, roof: 0x34394a, ground: 0x252a38, build: buildIndustrialZone },
  residential: { accent: 0x10b981, wall: 0x4f6455, roof: 0x2c4034, ground: 0x243329, build: buildResidentialZone },
  park:        { accent: 0x84cc16, wall: 0x425a2e, roof: 0x26361c, ground: 0x253c1c, build: buildParkZone },
  airport:     { accent: 0x06b6d4, wall: 0x3a5060, roof: 0x1e3040, ground: 0x1a2535, build: buildAirportZone },
  hospital:    { accent: 0xf0f9ff, wall: 0x6b8080, roof: 0x2c4040, ground: 0x202c30, build: buildHospitalZone },
  military:    { accent: 0x4b5320, wall: 0x4a4d30, roof: 0x2f3020, ground: 0x252618, build: buildMilitaryZone },
  media:       { accent: 0xf97316, wall: 0x5a4020, roof: 0x3a2810, ground: 0x2a1c0c, build: buildMediaZone },
  port:        { accent: 0x0891b2, wall: 0x2a4a55, roof: 0x1a2e38, ground: 0x131f28, build: buildPortZone },
  border:      { accent: 0xef4444, wall: 0x503030, roof: 0x301a1a, ground: 0x1f1010, build: buildBorderZone },
  religious:   { accent: 0xfbbf24, wall: 0x5a4a30, roof: 0x3a2e18, ground: 0x28200c, build: buildReligiousZone },
  slum:        { accent: 0x78716c, wall: 0x453e3a, roof: 0x2c2622, ground: 0x1e1a18, build: buildSlumZone },
  tech_campus: { accent: 0x8b5cf6, wall: 0x3a3058, roof: 0x231c3a, ground: 0x1a1428, build: buildTechCampusZone },
  generic:     { accent: 0x94a3b8, wall: 0x4a5066, roof: 0x2c3044, ground: 0x1e2230, build: buildGenericZone },
}

const AGENT_BODY_COLOR = {
  official:   0x4e7bc7,
  student:    0xb77df3,
  vendor:     0xeeba6a,
  worker:     0x7a8497,
  citizen:    0x45c48a,
  visitor:    0xa3d65c,
  journalist: 0xfafafa,
}

// Role display metadata: glyph, label, badge fill/text color
const ROLE_META = {
  official:   { glyph: '★', label: 'GOV',   fill: '#1e3a8a', text: '#ffffff' },
  student:    { glyph: '✎', label: 'STU',   fill: '#7e22ce', text: '#ffffff' },
  vendor:     { glyph: '⚖', label: 'VEND',  fill: '#b45309', text: '#ffffff' },
  worker:     { glyph: '⚒', label: 'WORK',  fill: '#374151', text: '#ffffff' },
  citizen:    { glyph: '◉', label: 'CIT',   fill: '#047857', text: '#ffffff' },
  visitor:    { glyph: '✈', label: 'VIS',   fill: '#4d7c0f', text: '#ffffff' },
  journalist: { glyph: '◎', label: 'PRESS', fill: '#0f172a', text: '#fbbf24' },
}

const BELIEF_HEAD_COLOR = {
  uninformed: 0x475569,
  a: 0xef4444,
  b: 0xfacc15,
}

export class CityScene {
  constructor() {
    this.scene = null
    this.camera = null
    this.renderer = null
    this.controls = null
    this.canvas = null
    this.resizeObserver = null
    this.raf = null
    this.agentGroup = null
    this.flowGroup = null
    this.grid = { w: 60, h: 40 }
    this.agents = new Map()
    this.beliefs = []
    this.ripples = []
    this.flows = [] // active transfer arrows
    this.ready = false
    this.clock = new THREE.Clock()
    this.raycaster = new THREE.Raycaster()
    this.pointer = new THREE.Vector2()
    this.hoveredId = null
    this.selectedId = null
    this.onAgentSelect = null
    this.onAgentHover = null
    this._handlers = {}
    this._latestSnapshot = null
  }

  init(canvas, grid, zones) {
    try {
      this._init(canvas, grid, zones)
    } catch (err) {
      console.error('[CityScene init]', err)
    }
  }

  _init(canvas, grid, zones) {
    this.canvas = canvas
    this.grid = grid
    this.zones = zones

    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.Fog(0x0a0e18, 70, 220)

    const w = canvas.clientWidth
    const h = canvas.clientHeight
    this.camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 800)
    this.camera.position.set(grid.w * 0.9, 48, grid.h * 1.45)
    this.camera.lookAt(grid.w / 2, 1, grid.h / 2)

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(w, h, false)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.02

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.07
    this.controls.minDistance = 30
    this.controls.maxDistance = 200
    this.controls.maxPolarAngle = Math.PI / 2.15
    this.controls.target.set(grid.w / 2, 0, grid.h / 2)
    this.controls.autoRotate = true
    this.controls.autoRotateSpeed = 0.25

    this._userInteractedAt = 0
    canvas.addEventListener('pointerdown', () => {
      this.controls.autoRotate = false
      this._userInteractedAt = performance.now()
    })

    this._setupSky()
    this._setupLights()
    this._setupGround()
    this._setupStreets()
    this._setupZones()
    this._setupAtmosphere()

    this.agentGroup = new THREE.Group()
    this.scene.add(this.agentGroup)
    this.flowGroup = new THREE.Group()
    this.scene.add(this.flowGroup)

    // Post-processing: render → bloom → SMAA → output
    this.composer = new EffectComposer(this.renderer)
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.composer.setSize(w, h)
    this.renderPass = new RenderPass(this.scene, this.camera)
    this.composer.addPass(this.renderPass)
    // Lower strength + higher threshold = only very bright emissives bloom
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.45, 0.7, 0.85)
    this.composer.addPass(this.bloomPass)
    const pr = Math.min(window.devicePixelRatio, 2)
    this.smaaPass = new SMAAPass(w * pr, h * pr)
    this.composer.addPass(this.smaaPass)
    this.outputPass = new OutputPass()
    this.composer.addPass(this.outputPass)

    this.resizeObserver = new ResizeObserver(() => this._resize())
    this.resizeObserver.observe(canvas.parentElement || canvas)

    this._bindPointerEvents()

    this.ready = true
    console.log('[CityScene] ready', {
      w: canvas.clientWidth,
      h: canvas.clientHeight,
      gridW: grid.w,
      gridH: grid.h,
      zones: (zones || []).length,
    })
    this._animate()
  }

  _bindPointerEvents() {
    const onMove = (ev) => {
      const rect = this.canvas.getBoundingClientRect()
      this.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1
      this.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1
      this._updateHover()
    }
    const onLeave = () => {
      this._setHover(null)
    }
    const onClick = (ev) => {
      const rect = this.canvas.getBoundingClientRect()
      this.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1
      this.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1
      const id = this._pick()
      if (id) {
        this.selectedId = id
        this._refreshSelectionRing()
        if (this.onAgentSelect) {
          const ag = this._agentDataFromSnapshot(id)
          this.onAgentSelect(ag)
        }
      } else {
        this.selectedId = null
        this._refreshSelectionRing()
        if (this.onAgentSelect) this.onAgentSelect(null)
      }
    }
    this._handlers = { onMove, onLeave, onClick }
    this.canvas.addEventListener('pointermove', onMove)
    this.canvas.addEventListener('pointerleave', onLeave)
    this.canvas.addEventListener('click', onClick)
  }

  _pick() {
    if (!this.camera || !this.agentGroup) return null
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const meshes = []
    for (const entry of this.agents.values()) {
      meshes.push(entry.body, entry.head)
      if (entry.hitProxy) meshes.push(entry.hitProxy)
    }
    const hits = this.raycaster.intersectObjects(meshes, false)
    if (hits.length === 0) return null
    let obj = hits[0].object
    while (obj && !obj.userData?.agentId) obj = obj.parent
    return obj?.userData?.agentId || null
  }

  _updateHover() {
    const id = this._pick()
    this._setHover(id)
  }

  _setHover(id) {
    if (id === this.hoveredId) return
    this.hoveredId = id
    if (this.canvas) this.canvas.style.cursor = id ? 'pointer' : 'default'
    for (const [aid, entry] of this.agents) {
      const isHover = aid === id
      if (entry.label) entry.label.visible = isHover || aid === this.selectedId
    }
    if (this.onAgentHover) {
      this.onAgentHover(id ? this._agentDataFromSnapshot(id) : null)
    }
  }

  _refreshSelectionRing() {
    for (const [aid, entry] of this.agents) {
      if (entry.selectRing) entry.selectRing.visible = aid === this.selectedId
      if (entry.label) entry.label.visible = aid === this.selectedId || aid === this.hoveredId
    }
  }

  _agentDataFromSnapshot(id) {
    if (!this._latestSnapshot) return null
    return this._latestSnapshot.agents.find((a) => a.id === id) || null
  }

  _setupSky() {
    // Gradient dome sky — cinematic dusk: deep navy → amber horizon
    const skyGeo = new THREE.SphereGeometry(400, 32, 16)
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor:    { value: new THREE.Color(0x040610) },
        midColor:    { value: new THREE.Color(0x1a1630) },
        horizonColor:{ value: new THREE.Color(0x6a3820) },
        offset:      { value: 0 },
        exponent:    { value: 0.9 },
      },
      vertexShader: `
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 midColor;
        uniform vec3 horizonColor;
        uniform float offset;
        uniform float exponent;
        varying vec3 vWorld;
        void main() {
          float h = normalize(vWorld + vec3(0.0, offset, 0.0)).y;
          float t = clamp(h, 0.0, 1.0);
          vec3 lower = mix(horizonColor, midColor, pow(t, exponent));
          vec3 col = mix(lower, topColor, pow(t, 1.8));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    })
    const sky = new THREE.Mesh(skyGeo, skyMat)
    sky.position.set(this.grid.w / 2, 0, this.grid.h / 2)
    this.scene.add(sky)
    this._sky = sky
  }

  _setupLights() {
    // Warm hemi — dusk sky, warm ground bounce
    const hemi = new THREE.HemisphereLight(0x96afe6, 0x5a3820, 0.62)
    this.scene.add(hemi)

    // Key sun — golden hour, richer falloff
    const sun = new THREE.DirectionalLight(0xffbf82, 1.9)
    sun.position.set(-60, 45, 90)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.left = -80
    sun.shadow.camera.right = 160
    sun.shadow.camera.top = 120
    sun.shadow.camera.bottom = -40
    sun.shadow.bias = -0.0003
    sun.shadow.normalBias = 0.04
    this.scene.add(sun)
    this._sun = sun

    // Cool rim light — silhouette separation
    const rim = new THREE.DirectionalLight(0x8fa8ff, 0.85)
    rim.position.set(80, 40, -60)
    this.scene.add(rim)

    const amb = new THREE.AmbientLight(0x5a6788, 0.22)
    this.scene.add(amb)
  }

  _setupGround() {
    // Dark, cinematic ground
    const g = new THREE.Mesh(
      new THREE.PlaneGeometry(this.grid.w * 3, this.grid.h * 3),
      new THREE.MeshStandardMaterial({
        color: 0x1a1f2b,
        roughness: 0.92,
        metalness: 0.05,
      })
    )
    g.rotation.x = -Math.PI / 2
    g.position.set(this.grid.w / 2, -0.05, this.grid.h / 2)
    g.receiveShadow = true
    this.scene.add(g)

    // Subtle grid etched into the ground
    const grid = new THREE.GridHelper(
      Math.max(this.grid.w, this.grid.h) * 2,
      40,
      0x2a3246,
      0x1f2534
    )
    grid.position.set(this.grid.w / 2, 0.01, this.grid.h / 2)
    grid.material.opacity = 0.6
    grid.material.transparent = true
    this.scene.add(grid)
  }

  _setupAtmosphere() {
    // Sparse distant "star/city lights" on the horizon dome
    const count = 220
    const geo = new THREE.BufferGeometry()
    const positions = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2
      const radius = 250 + Math.random() * 100
      const y = Math.random() * 60 + 10
      positions[i * 3 + 0] = Math.cos(theta) * radius + this.grid.w / 2
      positions[i * 3 + 1] = y
      positions[i * 3 + 2] = Math.sin(theta) * radius + this.grid.h / 2
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const mat = new THREE.PointsMaterial({
      color: 0xffe0a8,
      size: 1.1,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    })
    const points = new THREE.Points(geo, mat)
    this.scene.add(points)
  }

  _setupStreets() {
    // Draw asphalt between zones — horizontal + vertical "roads" outside each zone bbox.
    const streets = new THREE.Group()
    const asphalt = new THREE.MeshStandardMaterial({ color: 0x3f4756, roughness: 1, metalness: 0 })
    const stripe = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.7 })

    const roadY = 0.02
    const roadThickness = 2.2

    // Collect all bbox edges, draw roads around them
    const horizontals = new Set()
    const verticals = new Set()
    for (const z of this.zones) {
      const [x0, y0, x1, y1] = z.bbox
      // top/bottom
      horizontals.add(Math.round(y0 - 1))
      horizontals.add(Math.round(y1 + 1))
      verticals.add(Math.round(x0 - 1))
      verticals.add(Math.round(x1 + 1))
    }

    const gw = this.grid.w
    const gh = this.grid.h
    // Horizontal roads run across entire grid
    for (const y of horizontals) {
      if (y < 1 || y > gh - 1) continue
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(gw + 10, 0.1, roadThickness), asphalt)
      mesh.position.set(gw / 2, roadY, y)
      mesh.receiveShadow = true
      streets.add(mesh)
      // Dashed stripe
      const stripeMesh = new THREE.Mesh(new THREE.BoxGeometry(gw + 6, 0.05, 0.12), stripe)
      stripeMesh.position.set(gw / 2, roadY + 0.08, y)
      streets.add(stripeMesh)
    }
    for (const x of verticals) {
      if (x < 1 || x > gw - 1) continue
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(roadThickness, 0.1, gh + 10), asphalt)
      mesh.position.set(x, roadY, gh / 2)
      mesh.receiveShadow = true
      streets.add(mesh)
      const stripeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, gh + 6), stripe)
      stripeMesh.position.set(x, roadY + 0.08, gh / 2)
      streets.add(stripeMesh)
    }

    this.scene.add(streets)
  }

  _setupZones() {
    for (const z of this.zones) {
      // Dynamic: look up by archetype first; fallback to name-based theme for backward compat
      const archetype = (z.archetype || '').toLowerCase().replace(/ /g, '_')
      const theme = (archetype && ZONE_BLUEPRINTS[archetype])
        ? { ...ZONE_BLUEPRINTS[archetype] }
        : (ZONE_THEMES[z.name] || { ...ZONE_BLUEPRINTS.generic })
      // Allow backend color override
      if (z.color) theme.accent = parseInt(z.color.replace('#', ''), 16)
      const [x0, y0, x1, y1] = z.bbox
      const w = x1 - x0
      const h = y1 - y0
      const zoneGroup = new THREE.Group()

      // Zone plot (low terrace instead of big colored slab)
      const plot = new THREE.Mesh(
        new THREE.BoxGeometry(w - 0.4, 0.35, h - 0.4),
        new THREE.MeshStandardMaterial({
          color: theme.ground || 0x1a1a20,
          roughness: 0.9,
          metalness: 0.05,
        })
      )
      plot.position.set(x0 + w / 2, 0.18, y0 + h / 2)
      plot.receiveShadow = true
      zoneGroup.add(plot)

      // Subtle accent border line around the zone
      const border = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(w - 0.4, 0.36, h - 0.4)),
        new THREE.LineBasicMaterial({ color: theme.accent, transparent: true, opacity: 0.7 })
      )
      border.position.copy(plot.position)
      zoneGroup.add(border)

      // Zone-specific composition
      if (theme.build) theme.build(zoneGroup, x0, y0, x1, y1, theme)

      // Bright billboard label on a post
      const labelGroup = this._makeLabelPost(z.name, theme.accent)
      labelGroup.position.set(x0 + 2.0, 0, y0 + 2.0)
      zoneGroup.add(labelGroup)

      this.scene.add(zoneGroup)
    }
  }

  _makeLabelPost(text, accentHex) {
    const group = new THREE.Group()
    // Post
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 5.6, 8),
      new THREE.MeshStandardMaterial({ color: 0x1f2937, metalness: 0.7, roughness: 0.3 })
    )
    post.position.y = 2.8
    post.castShadow = true
    group.add(post)

    // Billboard panel
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 128
    const ctx = canvas.getContext('2d')
    // White panel with accent stripe
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 512, 128)
    // Inner shadow line
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.12)'
    ctx.lineWidth = 2
    ctx.strokeRect(1, 1, 510, 126)
    // Accent stripe
    ctx.fillStyle = '#' + accentHex.toString(16).padStart(6, '0')
    ctx.fillRect(0, 0, 10, 128)
    // Text
    ctx.font = 'bold 60px Inter, sans-serif'
    ctx.fillStyle = '#0f172a'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(text.toUpperCase(), 26, 60)
    // Subtitle
    ctx.font = '700 20px JetBrains Mono, monospace'
    ctx.fillStyle = '#' + accentHex.toString(16).padStart(6, '0')
    ctx.fillText('DISTRICT', 26, 104)

    const tex = new THREE.CanvasTexture(canvas)
    tex.anisotropy = 8
    tex.needsUpdate = true
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(6.4, 1.6),
      new THREE.MeshStandardMaterial({
        map: tex,
        side: THREE.DoubleSide,
        roughness: 0.8,
        metalness: 0,
      })
    )
    panel.position.y = 5.2
    panel.position.x = 2.8
    panel.castShadow = true
    group.add(panel)

    // Make panel always face the camera (billboard-ish) via a small update hook
    panel.userData.billboard = true
    return group
  }

  setState(snapshot, narrativeOrder = []) {
    try {
      this._setState(snapshot, narrativeOrder)
    } catch (err) {
      console.error('[CityScene setState]', err)
    }
  }

  _setState(snapshot, narrativeOrder = []) {
    if (!this.ready || !snapshot) return
    this._latestSnapshot = snapshot
    this.beliefs = narrativeOrder
    const seen = new Set()
    for (const a of snapshot.agents) {
      seen.add(a.id)
      let entry = this.agents.get(a.id)
      if (!entry) {
        entry = this._createAgent(a)
        this.agents.set(a.id, entry)
      }
      entry.archetype = a.archetype
      entry.name = a.name
      entry.zone = a.zone
      // Move toward new target
      entry.targetX = a.x
      entry.targetZ = a.y
      entry.lastTick = this.clock.getElapsedTime()
      this._applyAgentColor(entry, a)
      if (a.flipped_this_tick) this._spawnRipple(a.x, a.y, entry.headColor)
    }
    for (const [id, entry] of this.agents) {
      if (!seen.has(id)) {
        this.agentGroup.remove(entry.group)
        entry.dispose()
        this.agents.delete(id)
      }
    }
    // Transfer effects: only render beams for first-contact flips (meaningful narrative moments).
    // Continuous stance diffusion produces a transfer for every close pair every tick, so a
    // naive render becomes a spider-web. Filter hard — ripples for flips only, beams likewise.
    const flippedIds = new Set(
      (snapshot.agents || [])
        .filter((a) => a.flipped_this_tick)
        .map((a) => a.id)
    )
    const journalistIds = new Set(
      (snapshot.agents || [])
        .filter((a) => a.archetype === "journalist")
        .map((a) => a.id)
    )
    if (Array.isArray(snapshot.transfers) && flippedIds.size > 0) {
      // For each newly-flipped agent, draw ONE beam from its informer (prefer a journalist source)
      const byTarget = new Map()
      for (const t of snapshot.transfers) {
        if (!flippedIds.has(t.to)) continue
        const existing = byTarget.get(t.to)
        // Prefer a journalist source if available
        if (!existing || journalistIds.has(t.from)) {
          byTarget.set(t.to, t)
        }
      }
      let beamCount = 0
      for (const t of byTarget.values()) {
        const from = this.agents.get(t.from)
        const to = this.agents.get(t.to)
        if (!from || !to) continue
        const colorHex = (this.beliefs.length >= 2 && t.belief === this.beliefs[1])
          ? BELIEF_HEAD_COLOR.b
          : BELIEF_HEAD_COLOR.a
        this._spawnRipple(from.targetX, from.targetZ, colorHex, { strength: 0.5 })
        this._spawnRipple(to.targetX, to.targetZ, colorHex, { strength: 1.0, delay: 0.18 })
        if (beamCount < 4) {
          this._spawnBeam(from.targetX, from.targetZ, to.targetX, to.targetZ, colorHex)
          beamCount++
        }
      }
    }

    // Dialog speech-bubble sprites (Phase 2) — float between the two agents
    if (Array.isArray(snapshot.dialogs)) {
      for (const d of snapshot.dialogs) {
        const a1 = this.agents.get(d.a_id)
        const a2 = this.agents.get(d.b_id)
        if (!a1 || !a2) continue
        const colorHex = (this.beliefs.length >= 2 && d.narrative === this.beliefs[1])
          ? BELIEF_HEAD_COLOR.b
          : BELIEF_HEAD_COLOR.a
        this._spawnSpeechBubble(
          (a1.targetX + a2.targetX) / 2,
          (a1.targetZ + a2.targetZ) / 2,
          d.summary,
          colorHex,
        )
      }
    }

    // Journalist dispatch chips (Phase 4) — rectangular press chip over the journalist
    if (Array.isArray(snapshot.dispatches)) {
      for (const ds of snapshot.dispatches) {
        const j = this.agents.get(ds.journalist_id)
        if (!j) continue
        this._spawnDispatchChip(j.targetX, j.targetZ, ds.text)
      }
    }

    this._refreshSelectionRing()
  }

  _createAgent(a) {
    const group = new THREE.Group()
    const bodyColor = AGENT_BODY_COLOR[a.archetype] || 0x64748b
    const isJournalist = a.archetype === 'journalist'

    // Body (torso)
    const bodyGeo = new THREE.CapsuleGeometry(0.32, 0.6, 4, 10)
    const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.55, metalness: 0.1 })
    const body = new THREE.Mesh(bodyGeo, bodyMat)
    body.position.y = 0.62
    body.castShadow = true
    body.userData.agentId = a.id
    group.add(body)

    // Head
    const headGeo = new THREE.SphereGeometry(0.36, 20, 14)
    const headMat = new THREE.MeshStandardMaterial({
      color: BELIEF_HEAD_COLOR.uninformed,
      emissive: 0x000000,
      emissiveIntensity: 0,
      roughness: 0.35,
      metalness: 0.25,
    })
    const head = new THREE.Mesh(headGeo, headMat)
    head.position.y = 1.32
    head.castShadow = true
    head.userData.agentId = a.id
    group.add(head)

    // Ground halo disc — appears when informed (colored pool of light)
    const haloGeo = new THREE.CircleGeometry(1.1, 36)
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const halo = new THREE.Mesh(haloGeo, haloMat)
    halo.rotation.x = -Math.PI / 2
    halo.position.y = 0.03
    group.add(halo)

    // Journalists get a little camera prop on a shoulder
    if (isJournalist) {
      const cam = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 0.16, 0.14),
        new THREE.MeshStandardMaterial({ color: 0x111827, metalness: 0.7, roughness: 0.3 })
      )
      cam.position.set(0.25, 0.95, 0.18)
      group.add(cam)
      const lens = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 0.1, 8),
        new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xfbbf24, emissiveIntensity: 0.6 })
      )
      lens.rotation.x = Math.PI / 2
      lens.position.set(0.25, 0.95, 0.27)
      group.add(lens)
    }

    // Role badge (always-visible camera-facing sprite floating above head)
    const badge = this._makeRoleBadge(a.archetype)
    badge.position.set(0, 2.05, 0)
    group.add(badge)

    // Hover/select name label (hidden by default)
    const label = this._makeNameLabel(a.name, a.archetype)
    label.position.set(0, 2.75, 0)
    label.visible = false
    group.add(label)

    // Selection ring on the ground (hidden by default)
    const ringGeo = new THREE.RingGeometry(0.55, 0.7, 32)
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x2563eb,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
    })
    const selectRing = new THREE.Mesh(ringGeo, ringMat)
    selectRing.rotation.x = -Math.PI / 2
    selectRing.position.y = 0.06
    selectRing.visible = false
    group.add(selectRing)

    // Invisible bigger hit-proxy so tiny figures are easy to click
    const proxyGeo = new THREE.CylinderGeometry(0.55, 0.55, 2.2, 10)
    const proxyMat = new THREE.MeshBasicMaterial({ visible: false })
    const hitProxy = new THREE.Mesh(proxyGeo, proxyMat)
    hitProxy.position.y = 1.1
    hitProxy.userData.agentId = a.id
    group.add(hitProxy)

    group.position.set(a.x, 0, a.y)
    group.userData.agentId = a.id
    this.agentGroup.add(group)

    return {
      group,
      bodyMat,
      headMat,
      haloMat,
      body,
      head,
      halo,
      badge,
      label,
      selectRing,
      hitProxy,
      id: a.id,
      name: a.name,
      zone: a.zone,
      archetype: a.archetype,
      targetX: a.x,
      targetZ: a.y,
      lastTick: this.clock.getElapsedTime(),
      flipDecay: 0,
      headColor: BELIEF_HEAD_COLOR.uninformed,
      walkPhase: Math.random() * Math.PI * 2,
      dispose() {
        bodyGeo.dispose()
        bodyMat.dispose()
        headGeo.dispose()
        headMat.dispose()
        haloGeo.dispose()
        haloMat.dispose()
        ringGeo.dispose()
        ringMat.dispose()
        proxyGeo.dispose()
        proxyMat.dispose()
        if (badge.material?.map) badge.material.map.dispose()
        badge.material?.dispose?.()
        if (label.material?.map) label.material.map.dispose()
        label.material?.dispose?.()
      },
    }
  }

  _makeRoleBadge(archetype) {
    const meta = ROLE_META[archetype] || { glyph: '?', label: '???', fill: '#475569', text: '#ffffff' }
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 128
    const ctx = canvas.getContext('2d')
    // Pill-shaped badge
    const w = 256, h = 128, r = 60
    ctx.fillStyle = meta.fill
    this._roundRect(ctx, 4, 4, w - 8, h - 8, r)
    ctx.fill()
    ctx.lineWidth = 6
    ctx.strokeStyle = '#ffffff'
    this._roundRect(ctx, 4, 4, w - 8, h - 8, r)
    ctx.stroke()
    // Glyph
    ctx.fillStyle = meta.text
    ctx.font = 'bold 60px Inter, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(meta.glyph, 70, 64)
    // Label
    ctx.font = 'bold 48px JetBrains Mono, monospace'
    ctx.textAlign = 'left'
    ctx.fillText(meta.label, 110, 68)

    const tex = new THREE.CanvasTexture(canvas)
    tex.anisotropy = 8
    tex.needsUpdate = true
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })
    const sprite = new THREE.Sprite(mat)
    sprite.scale.set(1.5, 0.75, 1)
    sprite.renderOrder = 999
    return sprite
  }

  _makeNameLabel(name, archetype) {
    const meta = ROLE_META[archetype] || { fill: '#0f172a', text: '#ffffff' }
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 128
    const ctx = canvas.getContext('2d')
    const w = 512, h = 128, r = 26
    // Drop shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)'
    this._roundRect(ctx, 12, 16, w - 16, h - 16, r)
    ctx.fill()
    // Card
    ctx.fillStyle = '#ffffff'
    this._roundRect(ctx, 8, 8, w - 16, h - 16, r)
    ctx.fill()
    // Accent stripe
    ctx.fillStyle = meta.fill
    this._roundRect(ctx, 8, 8, 16, h - 16, r)
    ctx.fill()
    // Name
    ctx.fillStyle = '#0f172a'
    ctx.font = 'bold 52px Inter, sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(name, 44, 64)
    const tex = new THREE.CanvasTexture(canvas)
    tex.anisotropy = 8
    tex.needsUpdate = true
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })
    const sprite = new THREE.Sprite(mat)
    sprite.scale.set(3.0, 0.75, 1)
    sprite.renderOrder = 1000
    return sprite
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + w - r, y)
    ctx.quadraticCurveTo(x + w, y, x + w, y + r)
    ctx.lineTo(x + w, y + h - r)
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    ctx.lineTo(x + r, y + h)
    ctx.quadraticCurveTo(x, y + h, x, y + h - r)
    ctx.lineTo(x, y + r)
    ctx.quadraticCurveTo(x, y, x + r, y)
    ctx.closePath()
  }

  _applyAgentColor(entry, a) {
    let headHex = BELIEF_HEAD_COLOR.uninformed
    if (a.knows) {
      headHex = (this.beliefs.length >= 2 && a.belief === this.beliefs[1])
        ? BELIEF_HEAD_COLOR.b
        : BELIEF_HEAD_COLOR.a
    }
    entry.headColor = headHex
    // Target color — animate loop lerps head material toward this for smooth transitions
    entry.targetHeadColor = new THREE.Color(headHex)
    const intensity = typeof a.intensity === "number" ? a.intensity : (a.knows ? 1.0 : 0.0)
    if (a.knows && intensity > 0) {
      if (a.flipped_this_tick) {
        entry.headMat.emissive.setHex(headHex)
        entry.headMat.emissiveIntensity = 3.2
        entry.flipDecay = 1.0
      } else {
        entry.headMat.emissiveIntensity = Math.max(entry.headMat.emissiveIntensity || 0.6, 0.6 + intensity * 1.1)
        // Allow lerp toward target color on emissive too
        if (entry.headMat.emissive.getHex() === 0) entry.headMat.emissive.setHex(headHex)
      }
      // Ground halo: base opacity scales with intensity; animate loop adds a pulse
      entry.haloMat.color.setHex(headHex)
      entry.haloBase = 0.12 + intensity * 0.3
      entry.haloMat.opacity = entry.haloBase
    } else {
      entry.headMat.emissive.setHex(0x000000)
      entry.headMat.emissiveIntensity = 0
      entry.haloBase = 0
      entry.haloMat.opacity = 0
    }
  }

  _spawnFlow(x0, z0, x1, z1, colorHex) {
    // Arc curve from source to target, animated as a moving particle along the path.
    const start = new THREE.Vector3(x0, 1.4, z0)
    const end = new THREE.Vector3(x1, 1.4, z1)
    const mid = start.clone().lerp(end, 0.5)
    const dist = start.distanceTo(end)
    mid.y += Math.min(6, 1.5 + dist * 0.25)
    const curve = new THREE.QuadraticBezierCurve3(start, mid, end)
    const pts = curve.getPoints(40)
    const lineGeo = new THREE.BufferGeometry().setFromPoints(pts)
    const lineMat = new THREE.LineBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.55,
    })
    const line = new THREE.Line(lineGeo, lineMat)
    this.flowGroup.add(line)
    // Moving particle (small sphere)
    const dotGeo = new THREE.SphereGeometry(0.22, 12, 10)
    const dotMat = new THREE.MeshBasicMaterial({ color: colorHex })
    const dot = new THREE.Mesh(dotGeo, dotMat)
    this.flowGroup.add(dot)
    this.flows.push({ curve, line, lineMat, lineGeo, dot, dotGeo, dotMat, t: 0, life: 1.6 })
  }

  _spawnRipple(x, z, colorHex, opts = {}) {
    const strength = opts.strength ?? 1.0
    const delay = opts.delay ?? 0
    // Inner solid ring
    const geo = new THREE.RingGeometry(0.5, 0.72, 48)
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.9 * strength,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(x, 0.08, z)
    this.scene.add(mesh)
    this.ripples.push({ mesh, life: 1.2, delay, strength })
  }

  _spawnBeam(x0, z0, x1, z1, colorHex) {
    // Thin additive line between two agents — short, restrained, only shown for meaningful flips
    const dx = x1 - x0
    const dz = z1 - z0
    const len = Math.hypot(dx, dz)
    if (len < 0.5 || len > 12) return
    const geo = new THREE.PlaneGeometry(len, 0.08)
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set((x0 + x1) / 2, 0.9, (z0 + z1) / 2)
    mesh.rotation.x = -Math.PI / 2
    mesh.rotation.z = -Math.atan2(dz, dx)
    this.scene.add(mesh)
    this.flows.push({ mesh, mat, life: 0.4 })
  }

  _spawnSpeechBubble(x, z, text, colorHex) {
    if (!text) return
    this.bubbles = this.bubbles || []
    this._enforceBubbleCap(1, "dialog")
    const short = String(text).length > 90 ? String(text).slice(0, 87).trim() + "…" : String(text)
    const { sprite, mat, tex } = this._makeTextSprite(short, {
      bg: "rgba(10, 14, 24, 0.88)",
      border: "#" + colorHex.toString(16).padStart(6, "0"),
      textColor: "#f0f4ff",
      accent: "#ffc072",
      width: 360,
      lineHeight: 26,
      pad: 12,
      maxWidth: 330,
      fontSize: 17,
    })
    sprite.position.set(x, 3.6, z)
    sprite.scale.set(4.2, 1.6, 1)
    this.scene.add(sprite)
    this.bubbles.push({ sprite, mat, tex, life: 1.8, riseSpeed: 0.6, kind: "dialog" })
  }

  _spawnDispatchChip(x, z, text) {
    if (!text) return
    this.bubbles = this.bubbles || []
    this._enforceBubbleCap(1, "dispatch")
    const short = String(text).length > 120 ? String(text).slice(0, 117).trim() + "…" : String(text)
    const { sprite, mat, tex } = this._makeTextSprite(short, {
      bg: "rgba(234, 88, 12, 0.92)",
      border: "#ffc072",
      textColor: "#0a0e18",
      accent: "#0a0e18",
      label: "PRESS",
      width: 380,
      lineHeight: 22,
      pad: 12,
      maxWidth: 350,
      fontSize: 15,
    })
    sprite.position.set(x, 4.2, z)
    sprite.scale.set(4.6, 1.8, 1)
    this.scene.add(sprite)
    this.bubbles.push({ sprite, mat, tex, life: 2.4, riseSpeed: 0.45, kind: "dispatch" })
  }

  _enforceBubbleCap(maxPerKind, kind) {
    if (!this.bubbles) return
    const sameKind = this.bubbles.filter((b) => b.kind === kind)
    while (sameKind.length >= maxPerKind) {
      const oldest = sameKind.shift()
      const idx = this.bubbles.indexOf(oldest)
      if (idx >= 0) {
        this.scene.remove(oldest.sprite)
        oldest.mat?.dispose?.()
        oldest.tex?.dispose?.()
        this.bubbles.splice(idx, 1)
      }
    }
  }

  _makeTextSprite(text, opts) {
    const canvas = document.createElement("canvas")
    const width = opts.width || 400
    const maxWidth = opts.maxWidth || width - 40
    const lineHeight = opts.lineHeight || 32
    const pad = opts.pad || 14
    const fontSize = opts.fontSize || 22
    const ctx = canvas.getContext("2d")
    ctx.font = `600 ${fontSize}px Inter, sans-serif`

    // Word-wrap
    const words = String(text).split(/\s+/).filter(Boolean)
    const lines = []
    let cur = ""
    for (const w of words) {
      const test = cur ? cur + " " + w : w
      if (ctx.measureText(test).width > maxWidth && cur) {
        lines.push(cur)
        cur = w
      } else {
        cur = test
      }
    }
    if (cur) lines.push(cur)
    const labelH = opts.label ? 22 : 0
    const bodyH = lines.length * lineHeight
    const height = pad * 2 + labelH + bodyH

    canvas.width = width
    canvas.height = height

    // Background
    const g = ctx.createLinearGradient(0, 0, 0, height)
    g.addColorStop(0, opts.bg || "rgba(10, 14, 24, 0.92)")
    g.addColorStop(1, opts.bg || "rgba(10, 14, 24, 0.82)")
    ctx.fillStyle = g
    this._roundRect(ctx, 2, 2, width - 4, height - 4, 14)
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = opts.border || "#ffc072"
    this._roundRect(ctx, 2, 2, width - 4, height - 4, 14)
    ctx.stroke()

    let y = pad
    if (opts.label) {
      ctx.fillStyle = opts.accent || "#ffc072"
      ctx.font = "700 13px 'JetBrains Mono', monospace"
      ctx.textAlign = "left"
      ctx.textBaseline = "top"
      ctx.fillText(opts.label, pad, y)
      y += labelH
    }
    ctx.fillStyle = opts.textColor || "#f0f4ff"
    ctx.font = `600 ${fontSize}px Inter, sans-serif`
    ctx.textAlign = "left"
    ctx.textBaseline = "top"
    for (const line of lines) {
      ctx.fillText(line, pad, y)
      y += lineHeight
    }

    const tex = new THREE.CanvasTexture(canvas)
    tex.anisotropy = 4
    tex.needsUpdate = true
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false,
    })
    const sprite = new THREE.Sprite(mat)
    sprite.renderOrder = 999
    // Scale carries a default aspect ratio that caller will overwrite
    sprite.scale.set(width / 60, height / 60, 1)
    return { sprite, mat, tex }
  }

  _animate = () => {
    this.raf = requestAnimationFrame(this._animate)
    if (!this.ready) return
    try { this._renderFrame() } catch (err) { console.error('[CityScene render]', err) }
  }

  _renderFrame() {
    const t = this.clock.getElapsedTime()
    const dt = Math.min(0.05, this.clock.getDelta())

    // Agents: lerp toward target, gentle bob + walk sway
    for (const entry of this.agents.values()) {
      const cur = entry.group.position
      cur.x += (entry.targetX - cur.x) * 0.09
      cur.z += (entry.targetZ - cur.z) * 0.09
      // Smooth head color transition (prevent red↔yellow snaps between ticks)
      if (entry.targetHeadColor) {
        entry.headMat.color.lerp(entry.targetHeadColor, 0.08)
        if (entry.headMat.emissive.getHex() !== 0) {
          entry.headMat.emissive.lerp(entry.targetHeadColor, 0.08)
        }
      }
      const speed = Math.hypot(entry.targetX - cur.x, entry.targetZ - cur.z)
      entry.walkPhase += dt * (4 + speed * 2)
      const bob = Math.sin(entry.walkPhase) * 0.05
      entry.body.position.y = 0.55 + bob
      entry.head.position.y = 1.15 + bob
      // Face direction of travel
      if (speed > 0.02) {
        const angle = Math.atan2(entry.targetX - cur.x, entry.targetZ - cur.z)
        entry.group.rotation.y += (angle - entry.group.rotation.y) * 0.2
      }
      // Emissive decay — settles to steady-state glow for informed, zero for uninformed
      if (entry.flipDecay > 0) {
        entry.flipDecay -= 0.012
        const baseline = entry.headMat.emissive.getHex() === 0 ? 0 : 1.3
        entry.headMat.emissiveIntensity = Math.max(baseline, entry.flipDecay * 3.4)
      }
      // Halo pulse — base opacity is driven by stance intensity (set in _applyAgentColor)
      if (entry.haloBase && entry.haloBase > 0) {
        const pulse = Math.sin(t * 2.4 + entry.walkPhase) * 0.06
        entry.haloMat.opacity = Math.max(0, entry.haloBase + pulse)
        const hs = 1 + Math.sin(t * 1.8 + entry.walkPhase) * 0.06
        entry.halo.scale.set(hs, hs, hs)
      }
    }

    // Speech bubbles + dispatch chips: float up, face camera, fade
    if (this.bubbles && this.bubbles.length) {
      for (let i = this.bubbles.length - 1; i >= 0; i--) {
        const b = this.bubbles[i]
        b.life -= dt
        b.sprite.position.y += b.riseSpeed * dt
        if (b.life <= 0) {
          this.scene.remove(b.sprite)
          b.mat.dispose()
          b.tex.dispose()
          this.bubbles.splice(i, 1)
          continue
        }
        // Fade out over the last half-second
        const fade = b.life > 0.5 ? 1.0 : Math.max(0, b.life / 0.5)
        b.mat.opacity = fade
      }
    }

    // Transfer beams — short fade (life starts at 0.4s)
    for (let i = this.flows.length - 1; i >= 0; i--) {
      const f = this.flows[i]
      f.life -= dt
      if (f.life <= 0) {
        this.scene.remove(f.mesh)
        f.mesh.geometry.dispose()
        f.mat.dispose()
        this.flows.splice(i, 1)
        continue
      }
      const k = Math.max(0, f.life / 0.4)
      f.mat.opacity = 0.55 * k * k
    }

    // Ripples with optional delay + variable strength
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i]
      if (r.delay > 0) { r.delay -= dt; continue }
      r.life -= dt * 1.4
      if (r.life <= 0) {
        this.scene.remove(r.mesh)
        r.mesh.geometry.dispose()
        r.mesh.material.dispose()
        this.ripples.splice(i, 1)
        continue
      }
      const progress = 1 - r.life / 1.2
      const s = 1 + progress * 8
      r.mesh.scale.set(s, s, s)
      r.mesh.material.opacity = r.life * 0.85 * r.strength
    }

    // Billboards: face camera for panels tagged userData.billboard
    this.scene.traverse((obj) => {
      if (obj.userData?.billboard && this.camera) {
        obj.lookAt(this.camera.position)
      }
    })

    // Re-enable auto-orbit after 8 seconds of idle
    if (!this.controls.autoRotate && this._userInteractedAt && performance.now() - this._userInteractedAt > 8000) {
      this.controls.autoRotate = true
    }

    this.controls?.update()
    if (this.composer) this.composer.render()
    else this.renderer.render(this.scene, this.camera)
  }

  _resize() {
    if (!this.canvas) return
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    if (w === 0 || h === 0) return
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h, false)
    if (this.composer) this.composer.setSize(w, h)
    if (this.bloomPass) this.bloomPass.setSize(w, h)
  }

  dispose() {
    this.ready = false
    if (this.raf) cancelAnimationFrame(this.raf)
    if (this.resizeObserver) this.resizeObserver.disconnect()
    if (this.canvas && this._handlers) {
      this.canvas.removeEventListener('pointermove', this._handlers.onMove)
      this.canvas.removeEventListener('pointerleave', this._handlers.onLeave)
      this.canvas.removeEventListener('click', this._handlers.onClick)
    }
    if (this.controls) this.controls.dispose()
    if (this.composer) {
      this.composer.dispose?.()
      this.composer = null
    }
    if (this.renderer) {
      this.renderer.dispose()
      this.renderer.forceContextLoss?.()
    }
    this.scene?.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose?.()
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.())
        else obj.material.dispose?.()
      }
    })
    this.scene = null
    this.camera = null
    this.renderer = null
    this.controls = null
    this.canvas = null
    this.agents.clear()
    this.ripples = []
    this.flows = []
    if (this.bubbles) {
      for (const b of this.bubbles) {
        b.mat?.dispose?.()
        b.tex?.dispose?.()
      }
      this.bubbles = []
    }
  }

  focusAgent(id) {
    const entry = this.agents.get(id)
    if (!entry || !this.controls) return
    this.controls.target.set(entry.targetX, 1.0, entry.targetZ)
    this.selectedId = id
    this._refreshSelectionRing()
  }
}

// ============================================================
// Zone builders — each one composes recognizable landmarks
// ============================================================

function boxMat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.08, ...extra })
}

function addBox(parent, w, h, d, mat, x, y, z, shadow = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
  m.position.set(x, y + h / 2, z)
  if (shadow) {
    m.castShadow = true
    m.receiveShadow = true
  }
  parent.add(m)
  return m
}

function addWindows(parent, mesh, rows, cols, side = 'front') {
  // Adds a window lattice as emissive dots on the front face of a box
  const geo = mesh.geometry.parameters
  const w = geo.width
  const h = geo.height
  const d = geo.depth
  const gap = 0.12
  const winW = (w - (cols + 1) * gap) / cols
  const winH = (h - (rows + 1) * gap) / rows
  const mat = new THREE.MeshStandardMaterial({
    color: 0x1a1f2b,
    emissive: 0xffb55a,
    emissiveIntensity: 1.1,
    roughness: 0.4,
  })
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (Math.random() < 0.35) continue // dark windows for realism
      const win = new THREE.Mesh(new THREE.PlaneGeometry(winW, winH), mat)
      const x = -w / 2 + gap + winW / 2 + c * (winW + gap)
      const y = -h / 2 + gap + winH / 2 + r * (winH + gap)
      if (side === 'front') {
        win.position.set(x, y, d / 2 + 0.01)
      } else {
        win.position.set(x, y, -d / 2 - 0.01)
        win.rotation.y = Math.PI
      }
      mesh.add(win)
    }
  }
}

function buildGovernmentZone(group, x0, y0, x1, y1, theme) {
  const cx = (x0 + x1) / 2
  const cz = (y0 + y1) / 2
  const wallMat = boxMat(theme.wall)
  const roofMat = boxMat(theme.roof)
  const goldMat = boxMat(0xd4af37, { metalness: 0.7, roughness: 0.3 })

  // Central capitol building
  const base = addBox(group, 7, 1.4, 6, wallMat, cx, 0.35, cz)
  // Columned portico
  for (let i = -2; i <= 2; i++) {
    const col = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.25, 3.0, 10),
      wallMat
    )
    col.position.set(cx + i * 1.3, 1.75 + 0.35, cz + 3.2)
    col.castShadow = true
    group.add(col)
  }
  // Entablature
  addBox(group, 7, 0.4, 0.6, roofMat, cx, 3.25 + 0.35, cz + 3.2)
  // Main block with windows
  const main = addBox(group, 7, 3.5, 6, wallMat, cx, 1.4 + 0.35, cz - 0.4)
  addWindows(main, main, 2, 5, 'front')
  addWindows(main, main, 2, 5, 'back')
  // Dome base
  const drum = new THREE.Mesh(
    new THREE.CylinderGeometry(1.8, 2.0, 1.0, 24),
    wallMat
  )
  drum.position.set(cx, 5.05 + 0.35, cz - 0.4)
  drum.castShadow = true
  group.add(drum)
  // Dome
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1.8, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    goldMat
  )
  dome.position.set(cx, 5.55 + 0.35, cz - 0.4)
  dome.castShadow = true
  group.add(dome)
  // Flag pole + flag
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 2.5, 8),
    boxMat(0x9ca3af, { metalness: 0.8 })
  )
  pole.position.set(cx, 8.15, cz - 0.4)
  group.add(pole)
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.55),
    new THREE.MeshStandardMaterial({ color: 0xff9933, side: THREE.DoubleSide })
  )
  flag.position.set(cx + 0.45, 9.0, cz - 0.4)
  group.add(flag)

  // Side wings
  addBox(group, 2.0, 2.4, 5.0, wallMat, x0 + 1.9, 0.35, cz)
  addBox(group, 2.0, 2.4, 5.0, wallMat, x1 - 1.9, 0.35, cz)
  // Plaza planters
  for (const p of [[cx - 3, cz + 4.3], [cx + 3, cz + 4.3]]) {
    addBox(group, 1.0, 0.5, 1.0, boxMat(0x374151), p[0], 0.35, p[1])
    const tree = buildTree(0.8, 1.6, 0x166534)
    tree.position.set(p[0], 0.85, p[1])
    group.add(tree)
  }
}

function buildUniversityZone(group, x0, y0, x1, y1, theme) {
  const cx = (x0 + x1) / 2
  const cz = (y0 + y1) / 2
  const wallMat = boxMat(0x8b5cf6)
  const brickMat = boxMat(0x7e22ce)
  const roofMat = boxMat(theme.roof)

  // Library tower
  const tower = addBox(group, 3.2, 6.5, 3.2, brickMat, cx, 0.35, cz)
  addWindows(tower, tower, 4, 3, 'front')
  addWindows(tower, tower, 4, 3, 'back')
  // Pyramidal roof
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(2.4, 1.6, 4),
    roofMat
  )
  roof.rotation.y = Math.PI / 4
  roof.position.set(cx, 6.85 + 0.35 + 0.8, cz)
  roof.castShadow = true
  group.add(roof)
  // Clock face
  const clock = new THREE.Mesh(
    new THREE.CircleGeometry(0.7, 24),
    new THREE.MeshStandardMaterial({ color: 0xfef3c7, emissive: 0xfde68a, emissiveIntensity: 0.6 })
  )
  clock.position.set(cx, 5.2, cz + 1.61)
  group.add(clock)

  // Left classroom block
  addBox(group, 3.5, 2.4, 2.6, wallMat, x0 + 2.2, 0.35, cz - 2.8)
  addBox(group, 3.5, 2.4, 2.6, wallMat, x0 + 2.2, 0.35, cz + 2.8)
  // Right dorm
  addBox(group, 2.6, 3.6, 5.0, brickMat, x1 - 1.8, 0.35, cz)

  // Quad bench + trees
  for (const p of [[cx - 2.4, cz + 3], [cx + 2.4, cz + 3]]) {
    const tree = buildTree(0.7, 1.3, 0x22c55e)
    tree.position.set(p[0], 0.35, p[1])
    group.add(tree)
  }
  // Bicycle racks (abstracted)
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(
      new THREE.TorusGeometry(0.18, 0.03, 8, 16),
      boxMat(0x1f2937, { metalness: 0.8 })
    )
    b.position.set(cx - 1.5 + i * 0.4, 0.55, cz - 2.0)
    b.rotation.y = Math.PI / 2
    group.add(b)
  }
}

function buildMarketZone(group, x0, y0, x1, y1, theme) {
  const cx = (x0 + x1) / 2
  const cz = (y0 + y1) / 2
  const roofColors = [0xef4444, 0xf59e0b, 0x10b981, 0x3b82f6, 0xf97316, 0xa855f7]

  // Row of market stalls in a 3x2 grid
  let idx = 0
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 4; c++) {
      const sx = x0 + 2.5 + c * 2.8
      const sz = y0 + 2.5 + r * 4.0
      // Base crates
      addBox(group, 1.6, 0.8, 1.4, boxMat(0x78350f), sx, 0.35, sz)
      // Posts
      const post1 = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.07, 2.2, 6),
        boxMat(0x422006)
      )
      post1.position.set(sx - 0.7, 1.45, sz - 0.5)
      group.add(post1)
      const post2 = post1.clone()
      post2.position.set(sx + 0.7, 1.45, sz - 0.5)
      group.add(post2)
      const post3 = post1.clone()
      post3.position.set(sx - 0.7, 1.45, sz + 0.5)
      group.add(post3)
      const post4 = post1.clone()
      post4.position.set(sx + 0.7, 1.45, sz + 0.5)
      group.add(post4)
      // Awning
      const awning = new THREE.Mesh(
        new THREE.BoxGeometry(1.9, 0.1, 1.4),
        boxMat(roofColors[idx % roofColors.length], { roughness: 1 })
      )
      awning.position.set(sx, 2.5, sz)
      awning.castShadow = true
      group.add(awning)
      // Flag topper
      const flag = new THREE.Mesh(
        new THREE.PlaneGeometry(0.35, 0.2),
        new THREE.MeshStandardMaterial({ color: roofColors[idx % roofColors.length], side: THREE.DoubleSide })
      )
      flag.position.set(sx, 2.75, sz - 0.65)
      group.add(flag)
      idx++
    }
  }

  // Central fountain
  const fountain = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.1, 0.4, 20),
    boxMat(0x475569)
  )
  fountain.position.set(cx, 0.55, cz)
  fountain.castShadow = true
  group.add(fountain)
  const water = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 0.9, 0.1, 20),
    new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0ea5e9, emissiveIntensity: 0.3, roughness: 0.2, metalness: 0.6 })
  )
  water.position.set(cx, 0.82, cz)
  group.add(water)

  // Scooters scattered (small capsules)
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.15, 0.6, 4, 8),
      boxMat(0xdc2626)
    )
    s.rotation.z = Math.PI / 2
    s.position.set(x0 + 1.5 + Math.random() * 3, 0.5, y1 - 1.2)
    group.add(s)
  }
}

function buildIndustrialZone(group, x0, y0, x1, y1, theme) {
  const cx = (x0 + x1) / 2
  const cz = (y0 + y1) / 2
  const wallMat = boxMat(0x4b5563)
  const roofMat = boxMat(0x1f2937)
  const metalMat = boxMat(0x9ca3af, { metalness: 0.7, roughness: 0.4 })

  // Main factory shed
  addBox(group, 10, 3.5, 6, wallMat, cx, 0.35, cz + 0.5)
  // Sawtooth roof
  for (let i = -4; i <= 4; i += 1.5) {
    const g = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.8, 6),
      roofMat
    )
    g.position.set(cx + i, 4.4 + 0.35, cz + 0.5)
    g.rotation.x = Math.PI / 8
    g.castShadow = true
    group.add(g)
  }

  // Tall smokestack
  const stack = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.7, 6.5, 16),
    boxMat(0x6b7280)
  )
  stack.position.set(x1 - 2, 3.25 + 0.35, y0 + 2)
  stack.castShadow = true
  group.add(stack)
  // Red band
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(0.52, 0.52, 0.5, 16),
    boxMat(0xdc2626, { emissive: 0xdc2626, emissiveIntensity: 0.3 })
  )
  band.position.set(x1 - 2, 5.8, y0 + 2)
  group.add(band)
  // Smoke (translucent puff)
  const smoke = new THREE.Mesh(
    new THREE.SphereGeometry(0.9, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xcbd5e1, transparent: true, opacity: 0.55, roughness: 1 })
  )
  smoke.position.set(x1 - 2, 7.8, y0 + 2)
  group.add(smoke)

  // Silos
  for (let i = 0; i < 3; i++) {
    const silo = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.7, 3.0, 16),
      metalMat
    )
    silo.position.set(x0 + 1.6 + i * 1.6, 1.85, y1 - 1.5)
    silo.castShadow = true
    group.add(silo)
    const cap = new THREE.Mesh(
      new THREE.ConeGeometry(0.72, 0.6, 16),
      metalMat
    )
    cap.position.set(x0 + 1.6 + i * 1.6, 3.65, y1 - 1.5)
    group.add(cap)
  }

  // Shipping containers
  const contColors = [0xdc2626, 0x2563eb, 0x059669]
  for (let i = 0; i < 3; i++) {
    addBox(group, 2.4, 1.0, 1.0, boxMat(contColors[i], { roughness: 0.9 }),
      x0 + 2 + i * 2.6, 0.35, y0 + 2)
  }
  // Crane
  const craneBase = addBox(group, 0.5, 3.5, 0.5, boxMat(0xf59e0b), x0 + 1, 0.35, cz - 1)
  const craneArm = addBox(group, 3.5, 0.3, 0.3, boxMat(0xf59e0b), x0 + 2.6, 3.5, cz - 1)
  craneArm.position.y = 3.7
}

function buildResidentialZone(group, x0, y0, x1, y1, theme) {
  const houseColors = [0xfef3c7, 0xfbcfe8, 0xc7d2fe, 0xbbf7d0, 0xfed7aa]
  const roofColors = [0xb91c1c, 0x7c2d12, 0x991b1b, 0x6b21a8]

  // 2x3 grid of little houses
  const rows = 2
  const cols = 3
  const marginX = 1.2
  const marginZ = 1.2
  const cellW = (x1 - x0 - marginX * 2) / cols
  const cellH = (y1 - y0 - marginZ * 2) / rows
  let idx = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const sx = x0 + marginX + cellW * (c + 0.5)
      const sz = y0 + marginZ + cellH * (r + 0.5)
      const wallColor = houseColors[idx % houseColors.length]
      const roofColor = roofColors[idx % roofColors.length]
      // Body
      const body = addBox(group, 2.0, 1.6, 2.0, boxMat(wallColor), sx, 0.35, sz)
      // Windows
      addWindows(body, body, 1, 2, 'front')
      // Door
      const door = new THREE.Mesh(
        new THREE.PlaneGeometry(0.35, 0.7),
        new THREE.MeshStandardMaterial({ color: 0x78350f })
      )
      door.position.set(sx, 0.7, sz + 1.01)
      group.add(door)
      // Pitched roof (prism)
      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(1.45, 0.9, 4),
        boxMat(roofColor)
      )
      roof.rotation.y = Math.PI / 4
      roof.position.set(sx, 2.4, sz)
      roof.castShadow = true
      group.add(roof)
      idx++
    }
  }

  // Garden trees scattered
  for (let i = 0; i < 4; i++) {
    const tree = buildTree(0.55, 1.1, 0x15803d)
    tree.position.set(x0 + 1 + Math.random() * (x1 - x0 - 2), 0.35, y0 + 0.5 + Math.random() * (y1 - y0 - 1))
    group.add(tree)
  }
  // Parked car
  const car = new THREE.Group()
  const cbody = addBox(car, 1.3, 0.4, 0.7, boxMat(0x1e40af), 0, 0, 0)
  const ccab = addBox(car, 0.7, 0.35, 0.65, boxMat(0x1e40af), 0.0, 0.4, 0)
  car.position.set(x1 - 1.8, 0.55, y1 - 1.0)
  group.add(car)
}

function buildParkZone(group, x0, y0, x1, y1, theme) {
  // Grass tint is the zone plot color already; add paths + trees + lake
  const cx = (x0 + x1) / 2
  const cz = (y0 + y1) / 2

  // Curved path (approximated with thin box arcs)
  const pathMat = boxMat(0x78350f)
  for (let t = 0; t < 12; t++) {
    const a = (t / 12) * Math.PI * 2
    const r = 3.8
    const px = cx + Math.cos(a) * r
    const pz = cz + Math.sin(a) * r
    const tile = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.6), pathMat)
    tile.position.set(px, 0.38, pz)
    group.add(tile)
  }

  // Small lake
  const lake = new THREE.Mesh(
    new THREE.CircleGeometry(1.4, 24),
    new THREE.MeshStandardMaterial({
      color: 0x0ea5e9,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.25,
      roughness: 0.2,
      metalness: 0.6,
    })
  )
  lake.rotation.x = -Math.PI / 2
  lake.position.set(cx - 1.5, 0.38, cz + 1.5)
  group.add(lake)

  // Gazebo in the center
  const gazeboBase = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.1, 0.2, 16),
    boxMat(0xf3f4f6)
  )
  gazeboBase.position.set(cx, 0.45, cz)
  group.add(gazeboBase)
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2
    const col = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 1.5, 8),
      boxMat(0xf3f4f6)
    )
    col.position.set(cx + Math.cos(ang) * 0.9, 1.25, cz + Math.sin(ang) * 0.9)
    group.add(col)
  }
  const gRoof = new THREE.Mesh(
    new THREE.ConeGeometry(1.35, 0.7, 8),
    boxMat(0x166534)
  )
  gRoof.position.set(cx, 2.25, cz)
  group.add(gRoof)

  // Lots of trees
  for (let i = 0; i < 10; i++) {
    const t = buildTree(0.7 + Math.random() * 0.3, 1.3 + Math.random() * 0.6, [0x166534, 0x15803d, 0x22c55e][i % 3])
    t.position.set(
      x0 + 0.8 + Math.random() * (x1 - x0 - 1.6),
      0.38,
      y0 + 0.8 + Math.random() * (y1 - y0 - 1.6)
    )
    group.add(t)
  }
  // Benches
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI * 2
    const b = addBox(group, 0.9, 0.15, 0.3, boxMat(0x422006),
      cx + Math.cos(ang) * 2.5, 0.55, cz + Math.sin(ang) * 2.5)
    b.rotation.y = -ang
  }
}

function buildAirportZone(group, x0, y0, x1, y1, theme) {
  const cx = (x0 + x1) / 2
  const cz = (y0 + y1) / 2
  const tarmacMat = boxMat(0x374151, { roughness: 1 })
  const glassMat = boxMat(theme.wall, { metalness: 0.4, roughness: 0.2 })

  // Terminal building — long horizontal hall
  addBox(group, x1 - x0 - 3, 2.8, 3.5, glassMat, cx, 0.35, cz)
  // Glass roof strip
  addBox(group, x1 - x0 - 3, 0.2, 3.6, boxMat(0x7dd3fc, { metalness: 0.5, roughness: 0.1 }), cx, 3.2, cz)
  // Jet bridge arms
  for (let i = -1; i <= 1; i++) {
    addBox(group, 0.3, 0.4, 2.5, tarmacMat, cx + i * 3.5, 2.2, cz - 3)
  }
  // Control tower
  const tower = addBox(group, 1.2, 7.0, 1.2, glassMat, x1 - 2.5, 0.35, y0 + 2.5)
  addWindows(tower, tower, 3, 2, 'front')
  // Tower cab (glass box on top)
  addBox(group, 2.0, 1.0, 2.0, boxMat(0x7dd3fc, { metalness: 0.6, roughness: 0.1, emissive: 0x0ea5e9, emissiveIntensity: 0.3 }), x1 - 2.5, 7.9, y0 + 2.5)

  // Runway — horizontal strip
  addBox(group, x1 - x0 - 1, 0.05, 1.5, tarmacMat, cx, 0.38, y0 + 1.2)
  // Runway — vertical strip
  addBox(group, 1.5, 0.05, y1 - y0 - 5, tarmacMat, x0 + 2.5, 0.38, cz + 1)

  // Runway centerline dashes
  for (let i = 0; i < 5; i++) {
    addBox(group, 1.2, 0.06, 0.2, boxMat(0xffffff, { roughness: 1 }), x0 + 3 + i * 2.2, 0.4, y0 + 1.2)
  }
  // Taxiway edge lights
  for (let i = 0; i < 6; i++) {
    const light = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 6, 6),
      new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x22d3ee, emissiveIntensity: 2.5 })
    )
    light.position.set(x0 + 1 + i * 2, 0.5, y0 + 0.4)
    group.add(light)
  }
}

function buildHospitalZone(group, x0, y0, x1, y1, theme) {
  const cx = (x0 + x1) / 2
  const cz = (y0 + y1) / 2
  const wallMat = boxMat(0xf1f5f9, { roughness: 0.6 })
  const roofMat = boxMat(theme.roof)

  // H-shaped building: left wing, right wing, central connector
  const leftWing  = addBox(group, 3.5, 4.0, 6.0, wallMat, cx - 3.5, 0.35, cz)
  const rightWing = addBox(group, 3.5, 4.0, 6.0, wallMat, cx + 3.5, 0.35, cz)
  const connector = addBox(group, 3.5, 3.0, 2.5, wallMat, cx,        0.35, cz)
  addWindows(leftWing,  leftWing,  3, 2, 'front')
  addWindows(rightWing, rightWing, 3, 2, 'front')
  addWindows(connector, connector, 2, 2, 'front')
  // Flat roofs
  addBox(group, 3.6, 0.2, 6.1, roofMat, cx - 3.5, 4.4, cz)
  addBox(group, 3.6, 0.2, 6.1, roofMat, cx + 3.5, 4.4, cz)

  // Red cross on front face (two overlapping boxes)
  addBox(group, 0.25, 1.6, 0.08, boxMat(0xef4444, { emissive: 0xef4444, emissiveIntensity: 0.6 }), cx, 2.2, cz + 1.26)
  addBox(group, 1.6, 0.25, 0.08, boxMat(0xef4444, { emissive: 0xef4444, emissiveIntensity: 0.6 }), cx, 2.2, cz + 1.26)

  // Ambulance bay canopy
  addBox(group, 4.0, 0.2, 2.5, boxMat(0x64748b, { metalness: 0.5 }), cx, 3.2, y0 + 1.5)
  for (const sx of [cx - 1.5, cx + 1.5]) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 3.2, 8), boxMat(0x94a3b8))
    col.position.set(sx, 1.6, y0 + 1.5)
    group.add(col)
  }
  // Helipad marker on roof
  const pad = new THREE.Mesh(new THREE.CircleGeometry(1.0, 24), boxMat(0x22c55e, { roughness: 1 }))
  pad.rotation.x = -Math.PI / 2
  pad.position.set(cx + 3.5, 4.52, cz)
  group.add(pad)
}

function buildMilitaryZone(group, x0, y0, x1, y1, theme) {
  const cx = (x0 + x1) / 2
  const cz = (y0 + y1) / 2
  const wallMat = boxMat(theme.wall, { roughness: 0.9 })
  const khakiMat = boxMat(0x4b5320, { roughness: 1 })

  // Perimeter walls (4 sides, thin boxes)
  const W = x1 - x0, H = y1 - y0
  addBox(group, W, 1.2, 0.5, wallMat, cx, 0.35, y0 + 0.25)
  addBox(group, W, 1.2, 0.5, wallMat, cx, 0.35, y1 - 0.25)
  addBox(group, 0.5, 1.2, H, wallMat, x0 + 0.25, 0.35, cz)
  addBox(group, 0.5, 1.2, H, wallMat, x1 - 0.25, 0.35, cz)

  // Barracks — 3 identical rectangular blocks
  for (let i = 0; i < 3; i++) {
    const bx = cx - 3 + i * 3
    const bar = addBox(group, 2.4, 1.8, 4.0, wallMat, bx, 0.35, cz - 1)
    addWindows(bar, bar, 1, 3, 'front')
    addBox(group, 2.5, 0.15, 4.1, khakiMat, bx, 2.3, cz - 1)
  }

  // Watchtowers at corners
  for (const [wx, wz] of [[x0+1, y0+1],[x1-1, y0+1],[x0+1, y1-1],[x1-1, y1-1]]) {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 3.5, 10), wallMat)
    base.position.set(wx, 1.75 + 0.35, wz)
    base.castShadow = true
    group.add(base)
    addBox(group, 1.4, 0.9, 1.4, khakiMat, wx, 3.9, wz)
  }

  // Open parade ground (flat darker slab)
  const parade = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 3),
    new THREE.MeshStandardMaterial({ color: 0x3a3c28, roughness: 1 })
  )
  parade.rotation.x = -Math.PI / 2
  parade.position.set(cx, 0.37, cz + 2.5)
  group.add(parade)

  // Flag pole
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4.0, 8), boxMat(0x9ca3af, { metalness: 0.8 }))
  pole.position.set(cx, 2.35, cz + 2.5)
  group.add(pole)
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.6), new THREE.MeshStandardMaterial({ color: 0x16a34a, side: THREE.DoubleSide }))
  flag.position.set(cx + 0.5, 4.1, cz + 2.5)
  group.add(flag)
}

function buildMediaZone(group, x0, y0, x1, y1, theme) {
  const cx = (x0 + x1) / 2
  const cz = (y0 + y1) / 2
  const wallMat = boxMat(theme.wall)
  const orangeMat = boxMat(0xf97316, { emissive: 0xf97316, emissiveIntensity: 0.25 })

  // Main production building
  const studio = addBox(group, x1 - x0 - 4, 3.0, y1 - y0 - 3, wallMat, cx - 1, 0.35, cz)
  addWindows(studio, studio, 2, 4, 'front')
  addWindows(studio, studio, 2, 4, 'back')

  // Broadcast tower — tapered cylinder
  const towerBase = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.6, 7.0, 12), boxMat(0x374151, { metalness: 0.6 }))
  towerBase.position.set(x1 - 1.5, 3.85 + 0.35, y0 + 1.5)
  towerBase.castShadow = true
  group.add(towerBase)
  // Emissive tip
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.12, 2.0, 8),
    new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xef4444, emissiveIntensity: 3.0 }))
  tip.position.set(x1 - 1.5, 8.35, y0 + 1.5)
  group.add(tip)

  // Satellite dish — flat disc + small offset disc
  const dish = new THREE.Mesh(new THREE.CircleGeometry(1.0, 20), orangeMat)
  dish.rotation.x = -Math.PI / 4
  dish.position.set(x0 + 1.5, 2.5, y0 + 1.2)
  group.add(dish)
  const dishArm = addBox(group, 0.1, 1.5, 0.1, boxMat(0x6b7280), x0 + 1.5, 1.5, y0 + 1.2)

  // Antenna cluster on roof
  for (let i = 0; i < 3; i++) {
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.5, 6),
      boxMat(0x9ca3af, { metalness: 0.7 }))
    ant.position.set(cx - 2 + i * 1.8, 3.85, cz - (y1-y0)/2 + 0.5 + 0.35)
    group.add(ant)
  }
}

function buildPortZone(group, x0, y0, x1, y1, theme) {
  const cx = (x0 + x1) / 2
  const cz = (y0 + y1) / 2
  const wallMat = boxMat(theme.wall, { roughness: 0.9 })
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x0369a1, emissive: 0x0369a1, emissiveIntensity: 0.15, roughness: 0.3, metalness: 0.5 })

  // Dock edge — water strip along bottom of zone
  const dock = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, 3.0), waterMat)
  dock.rotation.x = -Math.PI / 2
  dock.position.set(cx, 0.38, y1 - 1.5)
  group.add(dock)
  // Dock planks
  for (let i = 0; i < 5; i++) {
    addBox(group, x1 - x0 - 0.5, 0.12, 0.2, boxMat(0x78350f, { roughness: 1 }), cx, 0.45, y1 - 0.4 - i * 0.5)
  }

  // Warehouse
  const warehouse = addBox(group, 6.0, 3.5, 4.0, wallMat, cx - 1, 0.35, cz - 1)
  addWindows(warehouse, warehouse, 2, 3, 'front')
  addBox(group, 6.1, 0.2, 4.1, boxMat(theme.roof), cx - 1, 4.05, cz - 1)

  // Crane — vertical mast + horizontal arm
  addBox(group, 0.5, 6.0, 0.5, boxMat(0xf59e0b), x1 - 2, 0.35, y1 - 2.5)
  addBox(group, 4.0, 0.35, 0.35, boxMat(0xf59e0b), x1 - 4, 6.5, y1 - 2.5)
  // Cable (thin vertical)
  addBox(group, 0.08, 3.5, 0.08, boxMat(0x9ca3af, { metalness: 0.8 }), x1 - 4.5, 3.5, y1 - 2.5)

  // Shipping containers
  const contColors = [0xef4444, 0x2563eb, 0x16a34a, 0xf59e0b]
  for (let i = 0; i < 4; i++) {
    addBox(group, 2.0, 1.0, 0.9, boxMat(contColors[i], { roughness: 0.9 }), x0 + 1.5 + i * 2.2, 0.35, y0 + 1.5)
  }
  // Second row, stacked
  for (let i = 0; i < 3; i++) {
    addBox(group, 2.0, 1.0, 0.9, boxMat(contColors[(i + 2) % 4], { roughness: 0.9 }), x0 + 2.6 + i * 2.2, 1.4, y0 + 1.5)
  }
}

function buildBorderZone(group, x0, y0, x1, y1, theme) {
  const cx = (x0 + x1) / 2
  const cz = (y0 + y1) / 2
  const wallMat = boxMat(theme.wall, { roughness: 0.9 })
  const redMat  = boxMat(0xef4444)
  const whiteMat = boxMat(0xf8fafc)

  // Checkpoint barrier — spanning width with red/white stripes
  for (let i = 0; i < Math.floor((x1 - x0) / 1.4); i++) {
    addBox(group, 1.3, 0.3, 0.25, i % 2 === 0 ? redMat : whiteMat, x0 + 0.7 + i * 1.4, 1.4, cz)
  }
  // Barrier poles
  for (const px of [cx - 3, cx + 3]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.5, 8), boxMat(0x374151))
    pole.position.set(px, 1.1, cz)
    group.add(pole)
  }

  // Guard booths
  for (const [bx, bz] of [[cx - 4, cz - 1], [cx + 4, cz - 1]]) {
    addBox(group, 1.4, 2.4, 1.4, wallMat, bx, 0.35, bz)
    addBox(group, 1.5, 0.2, 1.5, boxMat(theme.roof), bx, 2.6, bz)
    // Window
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.6),
      new THREE.MeshStandardMaterial({ color: 0x7dd3fc, emissive: 0x7dd3fc, emissiveIntensity: 0.4 }))
    win.position.set(bx, 1.6, bz + 0.71)
    group.add(win)
  }

  // Watchtowers at zone corners
  for (const [wx, wz] of [[x0 + 1, y0 + 1], [x1 - 1, y0 + 1]]) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 4.0, 10), wallMat)
    t.position.set(wx, 2.35, wz)
    t.castShadow = true
    group.add(t)
    addBox(group, 1.4, 0.9, 1.4, boxMat(0x374151), wx, 4.9, wz)
    // Searchlight
    const sl = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.1, 0.4, 8),
      new THREE.MeshStandardMaterial({ color: 0xfde047, emissive: 0xfde047, emissiveIntensity: 1.5 }))
    sl.rotation.z = Math.PI / 4
    sl.position.set(wx, 5.6, wz)
    group.add(sl)
  }

  // Fence line
  for (let i = 0; i < Math.floor((x1 - x0) / 1.5); i++) {
    const fp = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.8, 6), boxMat(0x6b7280, { metalness: 0.6 }))
    fp.position.set(x0 + 0.75 + i * 1.5, 1.3, y0 + 0.3)
    group.add(fp)
  }
  addBox(group, x1 - x0, 0.06, 0.06, boxMat(0x9ca3af, { metalness: 0.7 }), cx, 2.1, y0 + 0.3)
}

function buildReligiousZone(group, x0, y0, x1, y1, theme) {
  const cx = (x0 + x1) / 2
  const cz = (y0 + y1) / 2
  const wallMat = boxMat(theme.wall, { roughness: 0.6 })
  const goldMat = boxMat(0xfbbf24, { metalness: 0.6, roughness: 0.3 })

  // Main prayer hall
  const hall = addBox(group, 5.5, 2.8, 4.5, wallMat, cx, 0.35, cz)
  addWindows(hall, hall, 2, 3, 'front')
  addWindows(hall, hall, 2, 3, 'back')

  // Central dome
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 0.8, 20), wallMat)
  drum.position.set(cx, 3.55, cz)
  drum.castShadow = true
  group.add(drum)
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1.4, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    goldMat
  )
  dome.position.set(cx, 3.95, cz)
  dome.castShadow = true
  group.add(dome)
  // Finial
  const finial = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.12, 0.8, 8), goldMat)
  finial.position.set(cx, 5.45, cz)
  group.add(finial)

  // Minaret — tall cylindrical tower
  const minaret = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 6.5, 16), wallMat)
  minaret.position.set(x0 + 1.2, 3.6, y0 + 1.2)
  minaret.castShadow = true
  group.add(minaret)
  const minaretTop = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.8, 16), goldMat)
  minaretTop.position.set(x0 + 1.2, 7.25, y0 + 1.2)
  group.add(minaretTop)

  // Courtyard plane
  const yard = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 3.0),
    new THREE.MeshStandardMaterial({ color: 0xd6c9a0, roughness: 1 }))
  yard.rotation.x = -Math.PI / 2
  yard.position.set(cx, 0.38, y1 - 2.0)
  group.add(yard)

  // Arch gate
  const gateL = addBox(group, 0.4, 2.2, 0.4, wallMat, cx - 1.2, 0.35, y1 - 0.8)
  const gateR = addBox(group, 0.4, 2.2, 0.4, wallMat, cx + 1.2, 0.35, y1 - 0.8)
  addBox(group, 2.4, 0.35, 0.5, wallMat, cx, 2.45, y1 - 0.8)
}

function buildSlumZone(group, x0, y0, x1, y1, theme) {
  const rng = (min, max) => min + Math.random() * (max - min)
  const roughMat = (c) => boxMat(c, { roughness: 1.0, metalness: 0 })
  const colors = [0x78716c, 0x6b7280, 0x57534e, 0x737373, 0x854d0e, 0x713f12]

  // Dense irregular small structures
  const count = 18
  for (let i = 0; i < count; i++) {
    const sw = rng(1.2, 2.8)
    const sh = rng(0.8, 2.2)
    const sd = rng(1.0, 2.4)
    const sx = rng(x0 + 0.8, x1 - 0.8)
    const sz = rng(y0 + 0.8, y1 - 0.8)
    addBox(group, sw, sh, sd, roughMat(colors[i % colors.length]), sx, 0.35, sz)
    // Corrugated roof — slightly wider flat slab
    addBox(group, sw + 0.3, 0.12, sd + 0.3, roughMat(0x6b7280), sx, 0.35 + sh + 0.06, sz)
  }

  // Narrow winding path
  const pathMat = boxMat(0x44403c, { roughness: 1 })
  for (let i = 0; i < 8; i++) {
    const px = cx_slum(x0, x1, i)
    const pz = y0 + 1 + i * ((y1 - y0 - 2) / 7)
    addBox(group, 1.2, 0.05, 0.8, pathMat, px, 0.4, pz)
  }

  // Overhead wire lines (thin boxes)
  addBox(group, x1 - x0 - 1, 0.04, 0.04, boxMat(0x292524, { metalness: 0.5 }), (x0 + x1) / 2, 3.5, (y0 + y1) / 2)
  addBox(group, 0.04, 0.04, y1 - y0 - 1, boxMat(0x292524, { metalness: 0.5 }), (x0 + x1) / 2 + 1, 3.0, (y0 + y1) / 2)

  function cx_slum(x0, x1, i) {
    return (x0 + x1) / 2 + Math.sin(i * 0.9) * ((x1 - x0) * 0.18)
  }
}

function buildTechCampusZone(group, x0, y0, x1, y1, theme) {
  const cx = (x0 + x1) / 2
  const cz = (y0 + y1) / 2
  const glassMat = boxMat(theme.wall, { metalness: 0.5, roughness: 0.15 })
  const concreteMat = boxMat(0x475569, { roughness: 0.7 })

  // Three modern glass office blocks
  const blocks = [
    { x: cx - 3.5, z: cz, w: 3.5, h: 5.0, d: 3.0 },
    { x: cx + 3.0, z: cz - 1, w: 3.0, h: 7.0, d: 2.5 },
    { x: cx,       z: cz + 3, w: 4.5, h: 3.5, d: 2.2 },
  ]
  for (const b of blocks) {
    const block = addBox(group, b.w, b.h, b.d, glassMat, b.x, 0.35, b.z)
    addWindows(block, block, Math.floor(b.h / 1.4), 3, 'front')
    addWindows(block, block, Math.floor(b.h / 1.4), 3, 'back')
    // Reflective roof trim
    addBox(group, b.w + 0.2, 0.15, b.d + 0.2, boxMat(0x94a3b8, { metalness: 0.8, roughness: 0.1 }), b.x, 0.35 + b.h + 0.075, b.z)
  }

  // Open courtyard — paved slab
  const court = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 3.5),
    new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.8, metalness: 0.1 }))
  court.rotation.x = -Math.PI / 2
  court.position.set(cx, 0.38, cz - 2)
  group.add(court)

  // Campus path arc (approximated with short segments)
  const pathMat = boxMat(0x64748b, { roughness: 0.9 })
  for (let t = 0; t < 10; t++) {
    const a = (t / 10) * Math.PI
    const r = 3.0
    const px = cx + Math.cos(a + Math.PI) * r
    const pz = cz - 2 + Math.sin(a) * 1.5
    addBox(group, 0.5, 0.05, 0.5, pathMat, px, 0.4, pz)
  }

  // Trees cluster
  for (let i = 0; i < 5; i++) {
    const t = buildTree(0.5 + Math.random() * 0.3, 1.1 + Math.random() * 0.5, [0x166534, 0x15803d, 0x4ade80][i % 3])
    t.position.set(x0 + 0.8 + Math.random() * 2.5, 0.38, y0 + 0.8 + Math.random() * (y1 - y0 - 2))
    group.add(t)
  }

  // Glowing logo slab on main building
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x8b5cf6, emissive: 0x8b5cf6, emissiveIntensity: 1.2, side: THREE.DoubleSide }))
  logo.position.set(cx - 3.5, 4.0, cz + 1.52)
  group.add(logo)
}

function buildGenericZone(group, x0, y0, x1, y1, theme) {
  const cx = (x0 + x1) / 2
  const cz = (y0 + y1) / 2
  const wallMat = boxMat(theme.wall)
  const roofMat = boxMat(theme.roof)

  // Central building
  const main = addBox(group, 4.5, 3.0, 3.5, wallMat, cx, 0.35, cz)
  addWindows(main, main, 2, 3, 'front')
  addBox(group, 4.6, 0.2, 3.6, roofMat, cx, 3.5, cz)

  // Two smaller flanking buildings
  addBox(group, 2.2, 2.0, 2.2, wallMat, cx - 3.5, 0.35, cz - 1)
  addBox(group, 2.2, 2.0, 2.2, wallMat, cx + 3.5, 0.35, cz + 1)

  // Ground-level detail
  addBox(group, 1.0, 0.4, 1.0, boxMat(0x374151), cx - 1.5, 0.35, cz + 2.5)
  const t = buildTree(0.6, 1.2, 0x166534)
  t.position.set(cx + 1.5, 0.35, cz + 2.5)
  group.add(t)
}

function buildTree(radius, height, leafColor) {
  const tree = new THREE.Group()
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.14, height * 0.6, 8),
    new THREE.MeshStandardMaterial({ color: 0x4a2b0f, roughness: 1 })
  )
  trunk.position.y = height * 0.3
  trunk.castShadow = true
  tree.add(trunk)
  const foliage = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 10, 8),
    new THREE.MeshStandardMaterial({ color: leafColor, roughness: 0.9 })
  )
  foliage.position.y = height * 0.6 + radius * 0.6
  foliage.castShadow = true
  tree.add(foliage)
  return tree
}
