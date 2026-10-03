// 시제품: takram 대기(Bruneton 미리 계산) + 볼륨 구름으로 같은 장면을 그립니다.
// 쿼리: lat, lon, h(m), iso(UTC), az, el, fov(세로), low/mid/high(운량 0~1), altL/altM/altH(km), q(품질), frames
import {
  CanvasTexture, Data3DTexture, HalfFloatType, LinearFilter, LinearMipMapLinearFilter, Matrix4, NoColorSpace,
  PerspectiveCamera, RedFormat, RepeatWrapping, Scene, TextureLoader, Vector3, WebGLRenderer,
} from 'three'
import { EffectComposer, EffectPass, RenderPass, ToneMappingEffect, ToneMappingMode } from 'postprocessing'
import { AerialPerspectiveEffect, PrecomputedTexturesLoader, getSunDirectionECEF } from '@takram/three-atmosphere'
import { CloudsEffect, CloudLayer, CLOUD_SHAPE_TEXTURE_SIZE, CLOUD_SHAPE_DETAIL_TEXTURE_SIZE } from '@takram/three-clouds'
import { DataTextureLoader, Ellipsoid, Geodetic, parseUint8Array, radians, STBNLoader } from '@takram/three-geospatial'
import { DataTexture, RGBAFormat, UnsignedByteType, Vector4 } from 'three'
import { GENUS, makeGenusWeather, patchGenusShader, setGenusUniforms, setGenusFrame, cubeSphereUv } from './genus.js'

const errors = []
window.addEventListener('error', e => errors.push(String(e.message)))
const Q = new URLSearchParams(location.search)
const num = (k, d) => (Q.has(k) ? Number(Q.get(k)) : d)

const W = num('w', 390), H = num('hpx', 584)
const lat = num('lat', 36.5679), lon = num('lon', 136.6774), hM = num('h', 103)
const date = new Date(Q.get('iso') || '2026-10-03T01:29:00Z')
const az = num('az', 161.6), el = num('el', 13.9), fov = num('fov', 60)
const cover = [num('low', 0.06), num('mid', 0), num('high', 0)]
const alt = [num('altL', 1.5), num('altM', 4.5), num('altH', 10)]

const canvas = document.createElement('canvas')
canvas.width = W; canvas.height = H
document.body.style.margin = '0'
document.body.appendChild(canvas)
const renderer = new WebGLRenderer({ canvas, antialias: false, depth: false, logarithmicDepthBuffer: false, preserveDrawingBuffer: true })
renderer.setPixelRatio(1); renderer.setSize(W, H, false)
renderer.toneMappingExposure = num('ev', 10)

// 관측점 — 장면 좌표는 관측점 기준 북·위·동(NUE), worldToECEFMatrix 로 지구에 붙입니다.
const position = new Geodetic(radians(lon), radians(lat), hM).toECEF()
const worldToECEF = Ellipsoid.WGS84.getNorthUpEastFrame(position, new Matrix4())

const camera = new PerspectiveCamera(fov, W / H, 1, 1e7)
camera.position.set(0, 2, 0)
const dir = new Vector3(Math.cos(radians(el)) * Math.cos(radians(az)), Math.sin(radians(el)), Math.cos(radians(el)) * Math.sin(radians(az)))
camera.lookAt(dir.clone().add(camera.position))
camera.updateMatrixWorld(true)

const scene = new Scene()

const aerial = new AerialPerspectiveEffect(camera)
aerial.sky = true
aerial.sunLight = false
aerial.skyLight = false
aerial.correctGeometricError = true
aerial.worldToECEFMatrix.copy(worldToECEF)

const clouds = new CloudsEffect(camera)
clouds.worldToECEFMatrix.copy(worldToECEF)
clouds.qualityPreset = Q.get('q') || 'high'
// 셰이더: 밀도 = remap(mix(날씨, 1, w), 1 − coverage·h, … + w). 층 가운데(h=1)에서 날씨 0.5 가 문턱이
// 되려면 coverage = 0.5·(1 − w) — 모든 층을 같은 w(0.6)로 둡니다.
const CFW = 0.6
const SHADOW = !Q.get('noshadow')
clouds.coverage = num('coverage', 0.5 * (1 - CFW))
if (Q.has('shapeRep')) clouds.shapeRepeat.setScalar(num('shapeRep', 0.0003))
if (Q.has('march')) { const m = JSON.parse(Q.get('march')); clouds.clouds.maxIterationCountToSun = m[0]; clouds.clouds.minSecondaryStepSize = m[1]; clouds.clouds.secondaryStepScale = m[2] }
// 예보 운량 → 층 세 개. 지역 날씨 텍스처의 r/g/b 를 층별 운량으로 씁니다(아래 makeWeather).
// C3: 층별 구름 종류(gL/gM/gH) — 없으면 대조군과 똑같습니다.
const gk = [Q.get('gL'), Q.get('gM'), Q.get('gH')]
const GO = Q.has('go') ? JSON.parse(Q.get('go')) : {}
const genusLayers = gk.map((g, i) => (g ? { genus: g, cover: cover[i], opts: GO['LMH'[i]] || {} } : null))
const GEN = genusLayers.some(Boolean)
const gp = (i, key, d) => (genusLayers[i] ? (genusLayers[i].opts[key] ?? GENUS[genusLayers[i].genus][key]) : d)
clouds.cloudLayers.length = 0
clouds.cloudLayers.push(
  new CloudLayer({ channel: 'r', altitude: alt[0] * 1000, height: gp(0, 'height', num('hL', 1200)), densityScale: gp(0, 'densityScale', num('densL', 0.2)), shapeAmount: gp(0, 'shapeAmount', 1), shapeDetailAmount: gp(0, 'shapeDetailAmount', num('detL', 1)), shapeAlteringBias: num('biasL', 0.35), coverageFilterWidth: CFW, shadow: SHADOW }),
  new CloudLayer({ channel: 'g', altitude: alt[1] * 1000, height: gp(1, 'height', 900), densityScale: gp(1, 'densityScale', 0.2), shapeAmount: gp(1, 'shapeAmount', 1), shapeDetailAmount: gp(1, 'shapeDetailAmount', 1), coverageFilterWidth: CFW, shadow: SHADOW }),
  new CloudLayer({ channel: 'b', altitude: alt[2] * 1000, height: gp(2, 'height', 400), densityScale: gp(2, 'densityScale', 0.003), shapeAmount: gp(2, 'shapeAmount', 0.4), shapeDetailAmount: gp(2, 'shapeDetailAmount', 0), coverageFilterWidth: CFW, shadow: GEN && genusLayers[2] ? SHADOW : undefined }),
  new CloudLayer({ channel: 'a', altitude: 0, height: 0, densityScale: 0 }),   // 셰이더가 늘 4층을 받습니다 — 빈 층
)
if (GEN) {
  patchGenusShader(clouds.cloudsPass.currentMaterial, Vector4)
  patchGenusShader(clouds.shadowPass.currentMaterial, Vector4)
  setGenusUniforms(clouds.cloudsPass.currentMaterial, genusLayers)
  setGenusUniforms(clouds.shadowPass.currentMaterial, genusLayers)
  // 텍스처 한 장 = tileKm — 관측점에서 북·동 1km 의 uv 변화로 반복 수를 잡습니다.
  const tileKm = num('tileKm', 24)
  const p0 = position.clone(), e = worldToECEF.elements
  const nrt = new Vector3(e[0], e[1], e[2]).normalize(), est = new Vector3(e[8], e[9], e[10]).normalize()
  const uv0 = cubeSphereUv(p0), uvN = cubeSphereUv(p0.clone().addScaledVector(nrt, 1000)), uvE = cubeSphereUv(p0.clone().addScaledVector(est, 1000))
  const dn = Math.hypot(uvN[0] - uv0[0], uvN[1] - uv0[1]), de = Math.hypot(uvE[0] - uv0[0], uvE[1] - uv0[1])
  const mPerUv = 1000 / ((dn + de) / 2)
  window.__genusTile = { cubeMPerUvN: 1000 / dn, cubeMPerUvE: 1000 / de }
  // 접평면 좌표(셰이더의 getGlobeUv 를 바꿈) — 반복 1, 한 장 = tileKm.
  clouds.localWeatherRepeat.setScalar(1)
  for (const m of [clouds.cloudsPass.currentMaterial, clouds.shadowPass.currentMaterial]) setGenusFrame(m, p0, est, nrt, tileKm * 1000)
}
clouds.events.addEventListener('change', () => {
  aerial.overlay = clouds.atmosphereOverlay
  aerial.shadow = clouds.atmosphereShadow
  aerial.shadowLength = clouds.atmosphereShadowLength
})

const composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType, multisampling: 0 })
composer.addPass(new RenderPass(scene, camera))
composer.addPass(Q.get('noclouds') ? new EffectPass(camera, aerial) : new EffectPass(camera, clouds, aerial))
composer.addPass(new EffectPass(camera, new ToneMappingEffect({ mode: ToneMappingMode[(Q.get('tm') || 'AGX')] })))
composer.setSize(W, H)

// 날씨 텍스처: 층마다 같은 잡음장(기본 날씨 텍스처의 r)을 쓰되, 문턱을 예보 운량으로 정합니다.
// 셰이더는 채널 값이 (1 − coverage·높이모양) 을 넘는 곳에 구름을 둡니다 — coverage 0.5 로 고정하면 층 가운데
// 문턱이 0.5 이므로, 채널 = 잡음 − 분위수(1 − 운량) + 0.5 로 두면 넘는 면적이 운량이 됩니다.
function makeWeather(base) {
  const img = base.image
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
  const g = c.getContext('2d'); g.drawImage(img, 0, 0)
  const d = g.getImageData(0, 0, c.width, c.height)
  const vals = []; for (let i = 0; i < d.data.length; i += 4) vals.push(d.data[i] / 255)
  const sorted = vals.slice().sort((a, b) => a - b)
  const quant = q => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))]
  const shift = cover.map(cv => (cv <= 0 ? -9 : 0.5 - quant(1 - cv)))
  for (let i = 0, j = 0; i < d.data.length; i += 4, j++) {
    for (let k = 0; k < 3; k++) d.data[i + k] = Math.round(Math.min(1, Math.max(0, vals[j] + shift[k])) * 255)
    d.data[i + 3] = 255
  }
  g.putImageData(d, 0, 0)
  // ⚠ 데이터 URL 로 다시 읽으면 비동기라 첫 프레임들이 빈 텍스처를 씁니다 — 캔버스를 그대로 씁니다.
  const t = new CanvasTexture(c)
  t.minFilter = LinearMipMapLinearFilter; t.magFilter = LinearFilter
  t.wrapS = t.wrapT = RepeatWrapping; t.colorSpace = NoColorSpace; t.flipY = false
  return t
}

const load3D = (url, size) => new Promise((res, rej) => new DataTextureLoader(Data3DTexture, parseUint8Array, {
  width: size, height: size, depth: size, format: RedFormat, minFilter: LinearFilter, magFilter: LinearFilter,
  wrapS: RepeatWrapping, wrapT: RepeatWrapping, wrapR: RepeatWrapping, colorSpace: NoColorSpace,
}).load(url, res, undefined, rej))
const load2D = url => new Promise((res, rej) => new TextureLoader().load(url, res, undefined, rej))

;(async () => {
  try {
    const texLoader = new PrecomputedTexturesLoader({ format: 'binary' }).setType(renderer)
    const textures = await new Promise((res, rej) => texLoader.load('assets', res, undefined, rej))
    Object.assign(aerial, textures)
    Object.assign(clouds, textures)
    const [weatherBase, turb, shape, shapeDetail, stbn] = await Promise.all([
      load2D('assets/local_weather.png'), load2D('assets/turbulence.png'),
      load3D('assets/shape.bin', CLOUD_SHAPE_TEXTURE_SIZE), load3D('assets/shape_detail.bin', CLOUD_SHAPE_DETAIL_TEXTURE_SIZE),
      new Promise((res, rej) => new STBNLoader().load('assets/stbn.bin', res, undefined, rej)),
    ])
    turb.wrapS = turb.wrapT = RepeatWrapping; turb.colorSpace = NoColorSpace
    if (GEN) {
      const S = num('ws', 1024), t0w = performance.now()
      const d = makeGenusWeather(genusLayers, S, num('tileKm', 24), num('seed', 7))
      const t = new DataTexture(d, S, S, RGBAFormat, UnsignedByteType)
      t.minFilter = LinearMipMapLinearFilter; t.magFilter = LinearFilter; t.generateMipmaps = true
      t.wrapS = t.wrapT = RepeatWrapping; t.colorSpace = NoColorSpace; t.flipY = false; t.needsUpdate = true
      clouds.localWeatherTexture = t
      window.__genusWeatherMs = performance.now() - t0w
    } else clouds.localWeatherTexture = Q.get('weather') === 'default' ? weatherBase : makeWeather(weatherBase)
    clouds.turbulenceTexture = turb
    clouds.shapeTexture = shape
    clouds.shapeDetailTexture = shapeDetail
    clouds.stbnTexture = stbn

    const sun = getSunDirectionECEF(date, new Vector3())
    aerial.sunDirection.copy(sun)
    clouds.sunDirection.copy(sun)

    // 시간 업스케일(1/16 씩)이 다 차도록 여러 프레임을 돌립니다.
    const frames = num('frames', 24)
    const t0 = performance.now()
    for (let i = 0; i < frames; i++) composer.render(1 / 60)
    const gl = renderer.getContext()
    const inv = worldToECEF.clone().invert(); const sl = sun.clone().transformDirection(inv)
    window.__stats = { sunLocal: [sl.x, sl.y, sl.z].map(v => +v.toFixed(3)), sunAltDeg: +(Math.asin(sl.y) * 180 / Math.PI).toFixed(2), ms: (performance.now() - t0) / frames, glError: gl.getError(), webgl2: gl instanceof WebGL2RenderingContext, genusTile: window.__genusTile, genusWeatherMs: window.__genusWeatherMs }
  } catch (e) { errors.push('예외: ' + (e && e.stack || e)) }
  window.__errors = errors
  document.title = 'DONE::' + (errors.length ? 'ERR' : 'OK')
})()
