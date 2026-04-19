import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

// Zone theming: each zone has a palette and a builder that composes distinctive 3D structures.
const ZONE_THEMES = {
  Government: {
    accent: 0x2563eb,
    wall: 0xe2e8f0,
    roof: 0xcbd5e1,
    ground: 0xcfd8e3,
    build: buildGovernmentZone,
  },
  University: {
    accent: 0x7c3aed,
    wall: 0xd8b4fe,
    roof: 0x7e22ce,
    ground: 0xe4d7f5,
    build: buildUniversityZone,
  },
  Market: {
    accent: 0xea580c,
    wall: 0xfde68a,
    roof: 0xb45309,
    ground: 0xf5e6c8,
    build: buildMarketZone,
  },
  Industrial: {
    accent: 0x4b5563,
    wall: 0x6b7280,
    roof: 0x374151,
    ground: 0xced4de,
    build: buildIndustrialZone,
  },
  Residential: {
    accent: 0x059669,
    wall: 0xfef3c7,
    roof: 0x15803d,
    ground: 0xcfe8d6,
    build: buildResidentialZone,
  },
  Park: {
    accent: 0x65a30d,
    wall: 0x4d7c0f,
    roof: 0x166534,
    ground: 0xbde39a,
    build: buildParkZone,
  },
}

const AGENT_BODY_COLOR = {
  official:   0x1e3a8a,
  student:    0x7e22ce,
  vendor:     0xb45309,
  worker:     0x374151,
  citizen:    0x047857,
  visitor:    0x4d7c0f,
  journalist: 0xf3f4f6,
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
    this.canvas = canvas
    this.grid = grid
    this.zones = zones

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0xf4f6fb)
    this.scene.fog = new THREE.FogExp2(0xe4e9f2, 0.0065)

    const w = canvas.clientWidth
    const h = canvas.clientHeight
    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 600)
    this.camera.position.set(grid.w * 1.05, 62, grid.h * 1.55)
    this.camera.lookAt(grid.w / 2, 0, grid.h / 2)

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(w, h, false)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.1

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.minDistance = 35
    this.controls.maxDistance = 180
    this.controls.maxPolarAngle = Math.PI / 2.15
    this.controls.target.set(grid.w / 2, 0, grid.h / 2)

    this._setupLights()
    this._setupGround()
    this._setupStreets()
    this._setupZones()

    this.agentGroup = new THREE.Group()
    this.scene.add(this.agentGroup)
    this.flowGroup = new THREE.Group()
    this.scene.add(this.flowGroup)

    this.resizeObserver = new ResizeObserver(() => this._resize())
    this.resizeObserver.observe(canvas)

    this._bindPointerEvents()

    this.ready = true
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

  _setupLights() {
    const hemi = new THREE.HemisphereLight(0xdfeaff, 0x8a7f70, 0.9)
    this.scene.add(hemi)

    const sun = new THREE.DirectionalLight(0xfff1cf, 1.6)
    sun.position.set(80, 110, 40)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.left = -80
    sun.shadow.camera.right = 160
    sun.shadow.camera.top = 120
    sun.shadow.camera.bottom = -40
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.05
    this.scene.add(sun)

    // Soft fill from the opposite side for daylight
    const fill = new THREE.DirectionalLight(0xcfe3ff, 0.35)
    fill.position.set(-40, 50, -20)
    this.scene.add(fill)
  }

  _setupGround() {
    const g = new THREE.Mesh(
      new THREE.PlaneGeometry(this.grid.w * 3, this.grid.h * 3),
      new THREE.MeshStandardMaterial({ color: 0xe6eaf1, roughness: 0.95, metalness: 0 })
    )
    g.rotation.x = -Math.PI / 2
    g.position.set(this.grid.w / 2, -0.05, this.grid.h / 2)
    g.receiveShadow = true
    this.scene.add(g)

    // Subtle cool-grid underlay
    const grid = new THREE.GridHelper(Math.max(this.grid.w, this.grid.h) * 2, 40, 0xb4bccc, 0xcbd3df)
    grid.position.set(this.grid.w / 2, 0.01, this.grid.h / 2)
    grid.material.opacity = 0.45
    grid.material.transparent = true
    this.scene.add(grid)
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
      const theme = ZONE_THEMES[z.name] || {}
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
    // Spawn arc arrows for this tick's information transfers
    if (Array.isArray(snapshot.transfers)) {
      for (const t of snapshot.transfers) {
        const from = this.agents.get(t.from)
        const to = this.agents.get(t.to)
        if (!from || !to) continue
        const colorHex = (this.beliefs.length >= 2 && t.belief === this.beliefs[1])
          ? BELIEF_HEAD_COLOR.b
          : BELIEF_HEAD_COLOR.a
        this._spawnFlow(from.targetX, from.targetZ, to.targetX, to.targetZ, colorHex)
      }
    }
    this._refreshSelectionRing()
  }

  _createAgent(a) {
    const group = new THREE.Group()
    const bodyColor = AGENT_BODY_COLOR[a.archetype] || 0x64748b
    const isJournalist = a.archetype === 'journalist'

    // Body (torso)
    const bodyGeo = new THREE.CapsuleGeometry(0.28, 0.5, 4, 10)
    const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.55, metalness: 0.1 })
    const body = new THREE.Mesh(bodyGeo, bodyMat)
    body.position.y = 0.55
    body.castShadow = true
    body.userData.agentId = a.id
    group.add(body)

    // Head
    const headGeo = new THREE.SphereGeometry(0.25, 16, 12)
    const headMat = new THREE.MeshStandardMaterial({
      color: BELIEF_HEAD_COLOR.uninformed,
      emissive: 0x000000,
      emissiveIntensity: 0,
      roughness: 0.4,
      metalness: 0.2,
    })
    const head = new THREE.Mesh(headGeo, headMat)
    head.position.y = 1.15
    head.castShadow = true
    head.userData.agentId = a.id
    group.add(head)

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
      body,
      head,
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
    entry.headMat.color.setHex(headHex)
    if (a.flipped_this_tick) {
      entry.headMat.emissive.setHex(headHex)
      entry.headMat.emissiveIntensity = 2.0
      entry.flipDecay = 1.0
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

  _spawnRipple(x, z, colorHex) {
    const geo = new THREE.RingGeometry(0.6, 0.78, 32)
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(x, 0.08, z)
    this.scene.add(mesh)
    this.ripples.push({ mesh, life: 1.0 })
  }

  _animate = () => {
    this.raf = requestAnimationFrame(this._animate)
    if (!this.ready) return
    const t = this.clock.getElapsedTime()
    const dt = Math.min(0.05, this.clock.getDelta())

    // Agents: lerp toward target, gentle bob + walk sway
    for (const entry of this.agents.values()) {
      const cur = entry.group.position
      cur.x += (entry.targetX - cur.x) * 0.12
      cur.z += (entry.targetZ - cur.z) * 0.12
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
      // Emissive decay
      if (entry.flipDecay > 0) {
        entry.flipDecay -= 0.018
        entry.headMat.emissiveIntensity = Math.max(0, entry.flipDecay * 2.0)
      }
    }

    // Flow arcs (data transfer arrows)
    for (let i = this.flows.length - 1; i >= 0; i--) {
      const f = this.flows[i]
      f.life -= dt
      f.t += dt * 0.7
      if (f.life <= 0 || f.t >= 1) {
        this.flowGroup.remove(f.line)
        this.flowGroup.remove(f.dot)
        f.lineGeo.dispose()
        f.lineMat.dispose()
        f.dotGeo.dispose()
        f.dotMat.dispose()
        this.flows.splice(i, 1)
        continue
      }
      const p = f.curve.getPoint(Math.min(1, f.t))
      f.dot.position.copy(p)
      const fade = Math.max(0, f.life / 1.6)
      f.lineMat.opacity = 0.2 + 0.55 * fade
      f.dotMat.opacity = 0.4 + 0.6 * fade
    }

    // Ripples
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i]
      r.life -= 0.022
      if (r.life <= 0) {
        this.scene.remove(r.mesh)
        r.mesh.geometry.dispose()
        r.mesh.material.dispose()
        this.ripples.splice(i, 1)
        continue
      }
      const s = 1 + (1 - r.life) * 7
      r.mesh.scale.set(s, s, s)
      r.mesh.material.opacity = r.life * 0.9
    }

    // Billboards: face camera for panels tagged userData.billboard
    this.scene.traverse((obj) => {
      if (obj.userData?.billboard && this.camera) {
        obj.lookAt(this.camera.position)
      }
    })

    this.controls?.update()
    this.renderer.render(this.scene, this.camera)
  }

  _resize() {
    if (!this.canvas) return
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    if (w === 0 || h === 0) return
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h, false)
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
    color: 0xffffff,
    emissive: 0xffe28a,
    emissiveIntensity: 0.75,
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
