import { useState, useRef, useEffect } from 'react'
import supabase from './supabase'
import HOWTO_CONTENT from './howto-content.js'

const SVH_SCAN_WEBHOOK    = 'https://n8n.tekguy.au/webhook/svh-vin-scan'
const SVH_ADD_USER_WEBHOOK = 'https://n8n.tekguy.au/webhook/svh-add-user'
const SVH_EXPORT_WEBHOOK   = 'https://n8n.tekguy.au/webhook/svh-export'

const STD_ACTIONS = [
  { key: 'check_in',   label: 'Check Car In',  mod: 'in'     },
  { key: 'check_out',  label: 'Check Car Out', mod: 'out'    },
  { key: 'add_client', label: 'Add Client',    mod: 'client' },
  { key: 'howto',      label: 'How To',        mod: 'howto'  },
]

const ADMIN_ACTIONS = [
  { key: 'new_vin',   label: 'Scan New VIN',   mod: 'admin'  },
  { key: 'add_staff', label: 'Add / Update User', mod: 'admin'  },
  { key: 'export',    label: 'Export Data',    mod: 'export' },
]

const ACTION_HOWTO_KEY = {
  check_in:   'check-car-in',
  check_out:  'check-car-out',
  add_client: 'add-client',
  new_vin:    'scan-new-vin',
  add_staff:  'add-staff-user',
  export:     'export-data',
}

// ── Camera viewfinder ────────────────────────────────────────────────────────

function CameraViewfinder({ onCapture, color = 'vin' }) {
  const videoRef  = useRef(null)
  const streamRef = useRef(null)
  const fileRef   = useRef(null)
  const [state, setState] = useState('starting') // 'starting' | 'live' | 'fallback'

  useEffect(() => {
    let active = true

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        if (active) setState('fallback')
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } }
        })
        if (!active) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        if (active) setState('live')
      } catch {
        if (active) setState('fallback')
      }
    }

    start()
    return () => {
      active = false
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [])

  function capture() {
    const video = videoRef.current
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    streamRef.current?.getTracks().forEach(t => t.stop())
    onCapture(canvas.toDataURL('image/jpeg', 0.92))
  }

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => onCapture(ev.target.result)
    reader.readAsDataURL(file)
  }

  if (state === 'fallback') {
    return (
      <>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleFile} />
        <button className={`scan-submit scan-submit--${color}`} onClick={() => fileRef.current.click()}>Open Camera</button>
      </>
    )
  }

  return (
    <div className="camera-viewfinder">
      <video ref={videoRef} autoPlay playsInline muted className="camera-video" />
      {state === 'starting' && <p className="scan-feedback">Starting camera…</p>}
      {state === 'live' && (
        <button className={`scan-submit scan-submit--${color}`} onClick={capture}>Capture Photo</button>
      )}
    </div>
  )
}

// ── Login ────────────────────────────────────────────────────────────────────

function Login({ onLogin }) {
  const [pins, setPins]     = useState(['', '', '', ''])
  const [error, setError]   = useState('')
  const [loading, setLoading] = useState(false)
  const inputRefs = useRef([])

  useEffect(() => { inputRefs.current[0]?.focus() }, [])

  async function validate(pinArr) {
    const pin = pinArr.join('')
    setLoading(true)
    setError('')
    const { data: staff } = await supabase
      .from('svh_staff')
      .select('*')
      .eq('pin', pin)
      .eq('app_access', true)
      .single()

    if (!staff) {
      setError('Invalid PIN')
      setPins(['', '', '', ''])
      setTimeout(() => inputRefs.current[0]?.focus(), 50)
      setLoading(false)
      return
    }
    onLogin({ firstname: staff.firstname, lastname: staff.lastname, app_admin: staff.app_admin })
  }

  function handleChange(i, val) {
    const digit = val.replace(/\D/g, '').slice(-1)
    const next = [...pins]
    next[i] = digit
    setPins(next)
    if (digit && i < 3) inputRefs.current[i + 1]?.focus()
    if (digit && i === 3) validate(next)
  }

  function handleKeyDown(i, e) {
    if (e.key === 'Backspace' && !pins[i] && i > 0) {
      inputRefs.current[i - 1]?.focus()
    }
  }

  return (
    <div className="login-container">
      <div className="login-brand">
        <h1 className="login-heading">ClearPath<span className="login-accent">-Ai</span></h1>
        <p className="login-tagline">SuzieV-Holdings</p>
        <p className="login-app-name">Fleet Control</p>
      </div>

      <div className="pin-row">
        {pins.map((p, i) => (
          <input
            key={i}
            ref={el => inputRefs.current[i] = el}
            className="pin-box"
            type="tel"
            inputMode="numeric"
            maxLength={1}
            value={p}
            onChange={e => handleChange(i, e.target.value)}
            onKeyDown={e => handleKeyDown(i, e)}
            disabled={loading}
          />
        ))}
      </div>

      {error   && <p className="login-error">{error}</p>}
      {loading && <p className="login-feedback">Checking...</p>}

      <div className="login-footer">
        <p className="login-powered">Online Systems &copy;2026</p>
        <p className="login-powered">Powered by ClearPath-Ai</p>
      </div>
    </div>
  )
}

// ── Scan New VIN flow ────────────────────────────────────────────────────────

function ScanNewVin({ onBack, onRecord }) {
  const [phase, setPhase]             = useState('photo') // 'photo' | 'rego' | 'type' | 'saving' | 'done'
  const [imageData, setImageData]     = useState(null)
  const [rego, setRego]               = useState('')
  const [isClientVehicle, setIsClientVehicle] = useState(null)
  const [error, setError]             = useState('')

  async function handleSubmit(clientVehicle) {
    setPhase('saving')

    const payload = {
      action: 'new_vin',
      rego: rego.trim().toUpperCase(),
      image: imageData,
      is_client_vehicle: clientVehicle,
      timestamp: new Date().toISOString(),
      client: 'Suzie V Holdings',
    }

    try {
      if (SVH_SCAN_WEBHOOK) {
        await fetch(SVH_SCAN_WEBHOOK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      }
      onRecord({ action: 'new_vin', value: rego.trim().toUpperCase(), id: Date.now(), timestamp: payload.timestamp })
      setPhase('done')
    } catch {
      setError('Failed to send — check connection and try again.')
      setPhase('type')
    }
  }

  if (phase === 'done') {
    return (
      <div className="scan-action">
        <p className="scan-feedback scan-feedback--ok" style={{ fontSize: '1.1rem', marginTop: '2rem' }}>Vehicle recorded</p>
        <button className="scan-submit scan-submit--vin" style={{ marginTop: '1.5rem' }} onClick={onBack}>Done</button>
      </div>
    )
  }

  if (phase === 'saving') {
    return (
      <div className="scan-action">
        <p className="scan-feedback" style={{ marginTop: '2rem' }}>Saving...</p>
      </div>
    )
  }

  if (phase === 'type') {
    return (
      <div className="scan-action">
        <button className="scan-back" onClick={() => setPhase('rego')}>← Back</button>
        <h2 className="scan-action-title">Vehicle Type</h2>
        <p className="scan-label" style={{ marginBottom: '1.5rem' }}>Is this a client vehicle or a business asset?</p>

        {error && <p className="scan-feedback scan-feedback--error">{error}</p>}

        <button
          className="scan-submit scan-submit--vin"
          style={{ marginBottom: '1rem' }}
          onClick={() => handleSubmit(true)}
        >
          Client's Vehicle
        </button>
        <button
          className="scan-submit scan-submit--out"
          onClick={() => handleSubmit(false)}
        >
          Business Asset
        </button>
      </div>
    )
  }

  if (phase === 'rego') {
    return (
      <div className="scan-action">
        <button className="scan-back" onClick={() => setPhase('photo')}>← Retake</button>
        <h2 className="scan-action-title">New VIN</h2>

        {imageData && <img src={imageData} alt="VIN" className="vin-preview" />}

        <p className="scan-label">Registration Plate</p>
        <input
          className="scan-input"
          type="text"
          placeholder="e.g. ABC123"
          value={rego}
          onChange={e => setRego(e.target.value.toUpperCase())}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          autoFocus
        />

        {!SVH_SCAN_WEBHOOK && <p className="scan-feedback scan-feedback--warn">n8n webhook not yet configured</p>}

        <button
          className="scan-submit scan-submit--vin"
          onClick={() => { if (rego.trim()) setPhase('type') }}
          disabled={!rego.trim()}
        >
          Next
        </button>
      </div>
    )
  }

  return (
    <div className="scan-action">
      <button className="scan-back" onClick={onBack}>← Back</button>
      <h2 className="scan-action-title">Scan New VIN</h2>
      <p className="vin-instruction">Point at the VIN plate and capture.</p>
      <CameraViewfinder onCapture={dataURL => { setImageData(dataURL); setPhase('rego') }} />
    </div>
  )
}

// ── Check In / Check Out flow ────────────────────────────────────────────────

function ScanCheckFlow({ action, user, onBack, recentScans, onRecord }) {
  const [phase, setPhase]       = useState('rego') // 'rego' | 'odo' | 'saving' | 'done' | 'error'
  const [rego, setRego]         = useState('')
  const [odometer, setOdometer] = useState('')
  const [errMsg, setErrMsg]     = useState('')

  async function handleSave() {
    if (!rego.trim() || !odometer.trim()) return
    setPhase('saving')

    try {
      const regoUpper = rego.trim().toUpperCase()
      const odoInt    = parseInt(odometer.trim(), 10)
      const recordedBy = `${user.firstname} ${user.lastname}`

      const { data: vehicles } = await supabase
        .from('svh_vehicles')
        .select('id')
        .eq('rego', regoUpper)
        .limit(1)

      if (!vehicles?.length) throw new Error('Vehicle not found — check rego.')
      const vehicleId = vehicles[0].id

      if (action.key === 'check_out') {
        const { error: mvErr } = await supabase.from('car_movements').insert({
          vehicle_id:     vehicleId,
          checked_out_at: new Date().toISOString(),
          odometer_out:   odoInt,
          recorded_by:    recordedBy,
        })
        if (mvErr) throw mvErr
        await supabase.from('svh_vehicles').update({ status: 'out' }).eq('id', vehicleId)
      } else {
        const { data: openMovements } = await supabase
          .from('car_movements')
          .select('id')
          .eq('vehicle_id', vehicleId)
          .is('checked_in_at', null)
          .order('checked_out_at', { ascending: false })
          .limit(1)

        if (!openMovements?.length) throw new Error('No open checkout found for this vehicle.')

        const { error: updErr } = await supabase.from('car_movements').update({
          checked_in_at: new Date().toISOString(),
          odometer_in:   odoInt,
          recorded_by:   recordedBy,
        }).eq('id', openMovements[0].id)
        if (updErr) throw updErr
        await supabase.from('svh_vehicles').update({ status: 'in' }).eq('id', vehicleId)
      }

      onRecord({ action: action.key, value: regoUpper, id: Date.now(), timestamp: new Date().toISOString() })
      setPhase('done')
    } catch (err) {
      setErrMsg(err.message || 'Failed — try again.')
      setPhase('error')
    }
  }

  if (phase === 'saving') {
    return (
      <div className="scan-action">
        <p className="scan-feedback" style={{ marginTop: '2rem' }}>Saving...</p>
      </div>
    )
  }

  if (phase === 'done') {
    return (
      <div className="scan-action">
        <p className="scan-feedback scan-feedback--ok" style={{ fontSize: '1.1rem', marginTop: '2rem' }}>Recorded</p>
        <button
          className={`scan-submit scan-submit--${action.mod}`}
          style={{ marginTop: '1.5rem' }}
          onClick={() => { setRego(''); setOdometer(''); setPhase('rego') }}
        >
          Next vehicle
        </button>
        <button className="scan-submit scan-submit--vin" style={{ marginTop: '0.5rem' }} onClick={onBack}>Done</button>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="scan-action">
        <button className="scan-back" onClick={() => { setErrMsg(''); setPhase('rego') }}>← Back</button>
        <p className="scan-feedback scan-feedback--error" style={{ marginTop: '2rem' }}>{errMsg}</p>
        <button
          className={`scan-submit scan-submit--${action.mod}`}
          style={{ marginTop: '1.5rem' }}
          onClick={() => { setErrMsg(''); setPhase('rego') }}
        >
          Try again
        </button>
      </div>
    )
  }

  if (phase === 'odo') {
    return (
      <div className="scan-action">
        <button className="scan-back" onClick={() => setPhase('rego')}>← Back</button>
        <h2 className="scan-action-title">{action.label}</h2>

        <p className="scan-label">Odometer (km)</p>
        <input
          className="scan-input"
          type="tel"
          inputMode="numeric"
          placeholder="000000"
          value={odometer}
          onChange={e => setOdometer(e.target.value.replace(/\D/g, '').slice(0, 6))}
          autoFocus
        />

        <button
          className={`scan-submit scan-submit--${action.mod}`}
          onClick={handleSave}
          disabled={!odometer.trim()}
        >
          Confirm
        </button>
      </div>
    )
  }

  // phase === 'rego'
  return (
    <div className="scan-action">
      <button className="scan-back" onClick={onBack}>← Back</button>
      <h2 className="scan-action-title">{action.label}</h2>

      <p className="scan-label">Registration Plate</p>
      <input
        className="scan-input"
        type="text"
        placeholder="e.g. ABC123"
        value={rego}
        onChange={e => setRego(e.target.value.toUpperCase())}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        autoFocus
      />

      <button
        className={`scan-submit scan-submit--${action.mod}`}
        onClick={() => setPhase('odo')}
        disabled={!rego.trim()}
      >
        Next
      </button>

      {recentScans.filter(s => s.action === action.key).slice(0, 5).map(s => (
        <div key={s.id} className="scan-recent-row" style={{ width: '100%' }}>
          <span className="scan-recent-rego">{s.value}</span>
          <span className="scan-recent-time">{new Date(s.timestamp).toLocaleTimeString()}</span>
        </div>
      ))}
    </div>
  )
}

// ── Add Client flow ───────────────────────────────────────────────────────────

function dataURLtoBlob(dataURL) {
  const [header, data] = dataURL.split(',')
  const mime = header.match(/:(.*?);/)[1]
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

function LicenceProgress({ frontDone, backDone }) {
  return (
    <div className="licence-progress">
      <span className={`lp-step ${frontDone ? 'lp-done' : 'lp-pending'}`}>
        {frontDone ? '✓' : '○'} Front
      </span>
      <span className="lp-divider">·</span>
      <span className={`lp-step ${backDone ? 'lp-done' : 'lp-pending'}`}>
        {backDone ? '✓' : '○'} Back
      </span>
    </div>
  )
}

function LicenceCamera({ title, frontDone, backDone, onCapture, onBack }) {
  const [preview, setPreview] = useState(null)

  if (preview) {
    return (
      <div className="scan-action">
        <h2 className="scan-action-title">{title}</h2>
        <LicenceProgress frontDone={frontDone} backDone={backDone} />
        <img src={preview} alt="Captured" className="vin-preview" style={{ maxHeight: '200px' }} />
        <button className="scan-submit scan-submit--vin" onClick={() => setPreview(null)}>Retake</button>
        <button className="scan-submit scan-submit--client" onClick={() => onCapture(preview)}>Use This Photo</button>
      </div>
    )
  }

  return (
    <div className="scan-action">
      <button className="scan-back" onClick={onBack}>← Back</button>
      <h2 className="scan-action-title">{title}</h2>
      <LicenceProgress frontDone={frontDone} backDone={backDone} />
      <p className="vin-instruction">Keep the licence flat and well-lit.</p>
      <CameraViewfinder onCapture={dataURL => setPreview(dataURL)} color="client" />
    </div>
  )
}

const CLIENT_FIELDS = [
  { name: 'first_name',      label: 'First Name',          type: 'text',     cap: 'words'      },
  { name: 'last_name',       label: 'Last Name',           type: 'text',     cap: 'words'      },
  { name: 'alias',           label: 'Alias / Known As',    type: 'text',     cap: 'words'      },
  { name: 'date_of_birth',   label: 'Date of Birth',       type: 'date',     cap: 'none'       },
  { name: 'address',         label: 'Address',             type: 'text',     cap: 'sentences'  },
  { name: 'licence_number',  label: 'Licence Number',      type: 'text',     cap: 'characters' },
]

function AddClient({ onBack, user }) {
  const [phase, setPhase]               = useState('form') // 'form' | 'front' | 'back' | 'confirm' | 'saving' | 'done'
  const [form, setForm]                 = useState({ first_name: '', last_name: '', alias: '', date_of_birth: '', address: '', licence_number: '' })
  const [frontPreview, setFrontPreview] = useState(null)
  const [backPreview, setBackPreview]   = useState(null)
  const [error, setError]               = useState('')

  function handleChange(e) {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: name === 'licence_number' ? value.toUpperCase() : value }))
  }

  async function handleSave() {
    setError('')
    setPhase('saving')
    const licNo = form.licence_number.trim().toUpperCase()
    try {
      const now = new Date()
      const year = now.getFullYear()
      const month = String(now.getMonth() + 1).padStart(2, '0')
      const dayOfYear = Math.ceil((now - new Date(year, 0, 0)) / 86400000)
      const todayPrefix = `${year}${month}${dayOfYear}`
      const { count } = await supabase
        .from('svh_rental_clients')
        .select('*', { count: 'exact', head: true })
        .like('client_ref', `${todayPrefix}%`)
      const clientRef = `${todayPrefix}${(count ?? 0) + 1}`

      let frontPath = null
      let backPath  = null

      if (frontPreview) {
        const { error: upErr } = await supabase.storage
          .from('licence-images')
          .upload(`${clientRef}/front.jpg`, dataURLtoBlob(frontPreview), { upsert: true, contentType: 'image/jpeg' })
        if (upErr) throw upErr
        frontPath = `${clientRef}/front.jpg`
      }

      if (backPreview) {
        const { error: upErr } = await supabase.storage
          .from('licence-images')
          .upload(`${clientRef}/back.jpg`, dataURLtoBlob(backPreview), { upsert: true, contentType: 'image/jpeg' })
        if (upErr) throw upErr
        backPath = `${clientRef}/back.jpg`
      }

      const { error: dbErr } = await supabase
        .from('svh_rental_clients')
        .insert({
          client_ref:        clientRef,
          first_name:        form.first_name.trim(),
          last_name:         form.last_name.trim(),
          alias:             form.alias.trim() || null,
          date_of_birth:     form.date_of_birth || null,
          address:           form.address.trim(),
          licence_number:    licNo,
          licence_front_url: frontPath,
          licence_back_url:  backPath,
          recorded_by:       `${user.firstname} ${user.lastname}`,
        })

      if (dbErr) throw dbErr
      setPhase('done')
    } catch (err) {
      setError(err.message || 'Failed to save — try again.')
      setPhase('confirm')
    }
  }

  if (phase === 'done') {
    return (
      <div className="scan-action">
        <p className="scan-feedback scan-feedback--ok" style={{ fontSize: '1.1rem', marginTop: '2rem' }}>Client saved</p>
        <button className="scan-submit scan-submit--vin" style={{ marginTop: '1.5rem' }} onClick={onBack}>Done</button>
      </div>
    )
  }

  if (phase === 'saving') {
    return (
      <div className="scan-action">
        <p className="scan-feedback" style={{ marginTop: '2rem' }}>Saving...</p>
      </div>
    )
  }

  if (phase === 'front') {
    return (
      <LicenceCamera
        key="front"
        title="Licence — Front"
        frontDone={!!frontPreview}
        backDone={!!backPreview}
        onBack={() => setPhase('form')}
        onCapture={dataURL => { setFrontPreview(dataURL); setPhase('back') }}
      />
    )
  }

  if (phase === 'back') {
    return (
      <LicenceCamera
        key="back"
        title="Licence — Back"
        frontDone={!!frontPreview}
        backDone={!!backPreview}
        onBack={() => setPhase('front')}
        onCapture={dataURL => { setBackPreview(dataURL); setPhase('confirm') }}
      />
    )
  }

  if (phase === 'confirm') {
    return (
      <div className="scan-action">
        <button className="scan-back" onClick={() => setPhase('back')}>← Retake Back</button>
        <h2 className="scan-action-title">Confirm Scans</h2>
        <LicenceProgress frontDone={!!frontPreview} backDone={!!backPreview} />
        <div style={{ display: 'flex', gap: '0.75rem', width: '100%' }}>
          {frontPreview && <img src={frontPreview} alt="Front" className="vin-preview" style={{ flex: 1, maxHeight: '120px' }} />}
          {backPreview  && <img src={backPreview}  alt="Back"  className="vin-preview" style={{ flex: 1, maxHeight: '120px' }} />}
        </div>
        {error && <p className="scan-feedback scan-feedback--error">{error}</p>}
        <button
          className="scan-submit scan-submit--client"
          onClick={handleSave}
          disabled={!frontPreview || !backPreview}
        >
          Save Client
        </button>
      </div>
    )
  }

  // phase === 'form'
  const canProceed = form.first_name.trim() && form.last_name.trim() && form.licence_number.trim()
  return (
    <div className="scan-action">
      <button className="scan-back" onClick={onBack}>← Back</button>
      <h2 className="scan-action-title">Add Client</h2>

      {CLIENT_FIELDS.map(f => (
        <div key={f.name} style={{ width: '100%' }}>
          <p className="scan-label">{f.label}</p>
          <input
            className="scan-input client-input"
            type={f.type}
            name={f.name}
            value={form[f.name]}
            onChange={handleChange}
            autoCapitalize={f.cap}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      ))}

      <button
        className="scan-submit scan-submit--client"
        onClick={() => setPhase('front')}
        disabled={!canProceed}
        style={{ marginTop: '0.5rem' }}
      >
        Next — Scan Licence
      </button>
    </div>
  )
}

// ── Add / Update Staff User ───────────────────────────────────────────────────

function AddStaffUser({ onBack }) {
  const [phase, setPhase]   = useState('search') // 'search' | 'form' | 'saving' | 'done'
  const [mobile, setMobile] = useState('')
  const [mode, setMode]     = useState('create') // 'create' | 'update'
  const [existingId, setExistingId] = useState(null)
  const [form, setForm]     = useState({ firstname: '', lastname: '', pin: '' })
  const [flags, setFlags]   = useState({ app_access: true, app_admin: false, portal_admin: false })
  const [errMsg, setErrMsg] = useState('')

  async function handleSearch() {
    if (!mobile.trim()) return
    setErrMsg('')
    const { data } = await supabase
      .from('svh_staff')
      .select('*')
      .eq('mobile', mobile.trim())
      .single()

    if (data) {
      setExistingId(data.id)
      setForm({ firstname: data.firstname, lastname: data.lastname, pin: data.pin })
      setFlags({ app_access: data.app_access, app_admin: data.app_admin, portal_admin: data.portal_admin })
      setMode('update')
    } else {
      setExistingId(null)
      setForm({ firstname: '', lastname: '', pin: '' })
      setFlags({ app_access: true, app_admin: false, portal_admin: false })
      setMode('create')
    }
    setPhase('form')
  }

  function handleChange(e) {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: name === 'pin' ? value.replace(/\D/g, '').slice(0, 4) : value }))
  }

  function handleFlag(e) {
    const { name, checked } = e.target
    setFlags(prev => ({ ...prev, [name]: checked }))
  }

  async function handleSubmit() {
    if (!form.firstname.trim() || !form.lastname.trim() || form.pin.length !== 4) return
    setPhase('saving')
    const payload = {
      firstname:    form.firstname.trim(),
      lastname:     form.lastname.trim(),
      mobile:       mobile.trim(),
      pin:          form.pin,
      app_access:   flags.app_access,
      app_admin:    flags.app_admin,
      portal_admin: flags.portal_admin,
    }
    const { error } = mode === 'update'
      ? await supabase.from('svh_staff').update(payload).eq('id', existingId)
      : await supabase.from('svh_staff').insert(payload)

    if (error) {
      setErrMsg(error.code === '23505' ? 'That PIN is already in use.' : 'Failed to save — try again.')
      setPhase('form')
    } else {
      setPhase('done')
    }
  }

  if (phase === 'done') {
    return (
      <div className="scan-action">
        <p className="scan-feedback scan-feedback--ok" style={{ fontSize: '1.1rem', marginTop: '2rem' }}>
          {mode === 'update' ? 'User updated' : 'User created'}
        </p>
        <button className="scan-submit scan-submit--vin" style={{ marginTop: '1.5rem' }} onClick={onBack}>Done</button>
      </div>
    )
  }

  if (phase === 'saving') {
    return (
      <div className="scan-action">
        <p className="scan-feedback" style={{ marginTop: '2rem' }}>Saving...</p>
      </div>
    )
  }

  if (phase === 'search') {
    return (
      <div className="scan-action">
        <button className="scan-back" onClick={onBack}>← Back</button>
        <h2 className="scan-action-title">Add / Update User</h2>
        <p className="scan-label">Mobile Number</p>
        <input
          className="scan-input client-input"
          type="tel"
          value={mobile}
          onChange={e => setMobile(e.target.value)}
          autoComplete="off"
          placeholder="04xx xxx xxx"
          autoFocus
        />
        {errMsg && <p className="scan-feedback scan-feedback--error">{errMsg}</p>}
        <button className="scan-submit scan-submit--admin" onClick={handleSearch} disabled={!mobile.trim()} style={{ marginTop: '0.5rem' }}>
          Find / New
        </button>
      </div>
    )
  }

  const canSubmit = form.firstname.trim() && form.lastname.trim() && form.pin.length === 4

  return (
    <div className="scan-action">
      <button className="scan-back" onClick={() => setPhase('search')}>← Back</button>
      <h2 className="scan-action-title">{mode === 'update' ? 'Update User' : 'New User'}</h2>

      <p className="scan-label">Mobile</p>
      <input className="scan-input client-input" type="tel" value={mobile} disabled style={{ opacity: 0.5 }} />

      <p className="scan-label">First Name</p>
      <input className="scan-input client-input" type="text" name="firstname" value={form.firstname} onChange={handleChange} autoCapitalize="words" autoComplete="off" spellCheck={false} />

      <p className="scan-label">Last Name</p>
      <input className="scan-input client-input" type="text" name="lastname" value={form.lastname} onChange={handleChange} autoCapitalize="words" autoComplete="off" spellCheck={false} />

      <p className="scan-label">PIN (4 digits)</p>
      <input className="scan-input client-input" type="tel" inputMode="numeric" name="pin" value={form.pin} onChange={handleChange} maxLength={4} placeholder="0000" />

      <div className="staff-flags">
        {[['app_access', 'App Access'], ['app_admin', 'App Admin'], ['portal_admin', 'Portal Admin']].map(([key, label]) => (
          <label key={key} className="staff-flag-row">
            <input type="checkbox" name={key} checked={flags[key]} onChange={handleFlag} />
            <span>{label}</span>
          </label>
        ))}
      </div>

      {errMsg && <p className="scan-feedback scan-feedback--error">{errMsg}</p>}

      <button className="scan-submit scan-submit--admin" onClick={handleSubmit} disabled={!canSubmit} style={{ marginTop: '0.5rem' }}>
        {mode === 'update' ? 'Update User' : 'Create User'}
      </button>
    </div>
  )
}

// ── Export Data ───────────────────────────────────────────────────────────────

function ExportData({ onBack }) {
  const [status, setStatus] = useState(null) // null | 'sending' | 'done' | 'error'

  async function handleExport() {
    setStatus('sending')
    try {
      await fetch(SVH_EXPORT_WEBHOOK)
      setStatus('done')
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="scan-action">
      <button className="scan-back" onClick={onBack}>← Back</button>
      <h2 className="scan-action-title">Export Data</h2>
      <p className="vin-instruction" style={{ marginBottom: '1rem' }}>
        Exports all client records as a CSV to support@progresstech.au.
        Also runs automatically every Sunday at 9pm.
      </p>

      {status === 'done'    && <p className="scan-feedback scan-feedback--ok">Export sent</p>}
      {status === 'error'   && <p className="scan-feedback scan-feedback--error">Export failed — try again</p>}
      {status === 'sending' && <p className="scan-feedback">Sending...</p>}

      <button
        className="scan-submit scan-submit--export"
        onClick={handleExport}
        disabled={status === 'sending' || status === 'done'}
        style={{ marginTop: '0.5rem' }}
      >
        Export Now
      </button>
    </div>
  )
}

// ── How To ───────────────────────────────────────────────────────────────────

const HOWTO_TOPICS = [
  { key: 'check-car-in',   label: 'Check Car In'   },
  { key: 'check-car-out',  label: 'Check Car Out'  },
  { key: 'add-client',     label: 'Add Client'     },
  { key: 'scan-new-vin',   label: 'Scan New VIN'   },
  { key: 'add-staff-user', label: 'Add Staff User' },
  { key: 'export-data',    label: 'Export Data'    },
]

const STD_HOWTO_KEYS = new Set(['check-car-in', 'check-car-out', 'add-client'])

function renderMarkdown(text) {
  return text.split('\n').map((line, i) => {
    if (line.startsWith('## ')) return <p key={i} className="howto-h2">{line.slice(3)}</p>
    if (line.startsWith('# '))  return null // title already shown as page heading
    if (line.startsWith('- ') || line.match(/^\d+\. /)) {
      const content = line.replace(/^\d+\.\s*/, '').replace(/^-\s*/, '')
      return <p key={i} className="howto-li">{parseBold(content)}</p>
    }
    if (line.trim() === '') return <div key={i} className="howto-gap" />
    return <p key={i} className="howto-p">{parseBold(line)}</p>
  })
}

function parseBold(text) {
  const parts = text.split(/\*\*(.*?)\*\*/)
  return parts.map((part, i) => i % 2 === 1 ? <strong key={i}>{part}</strong> : part)
}

function HowTo({ onBack, role, initialTopic }) {
  const [selected, setSelected] = useState(
    initialTopic ? HOWTO_TOPICS.find(t => t.key === initialTopic) ?? null : null
  )
  const topics = role === 'admin'
    ? HOWTO_TOPICS
    : HOWTO_TOPICS.filter(t => STD_HOWTO_KEYS.has(t.key))

  if (selected) {
    const content = HOWTO_CONTENT[selected.key] || 'No instructions found.'
    return (
      <div className="scan-action howto-detail">
        <button className="scan-back" onClick={() => setSelected(null)}>← Back</button>
        <h2 className="scan-action-title">{selected.label}</h2>
        <div className="howto-body">{renderMarkdown(content)}</div>
      </div>
    )
  }

  return (
    <div className="scan-action">
      <button className="scan-back" onClick={onBack}>← Back</button>
      <h2 className="scan-action-title">How To</h2>
      <p className="howto-intro">Select a function for step-by-step instructions.</p>
      {topics.map(t => (
        <button key={t.key} className="howto-topic-btn" onClick={() => setSelected(t)}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

// ── Scan screen ──────────────────────────────────────────────────────────────

function ScanScreen({ user, onLogout }) {
  const [activeAction, setActiveAction]         = useState(null)
  const [howtoInitialTopic, setHowtoInitialTopic] = useState(null)
  const [recentScans, setRecentScans]           = useState([])

  function handleRecord(entry) {
    setRecentScans(prev => [entry, ...prev].slice(0, 30))
  }

  function handleInfoTap(e, howtoKey) {
    e.stopPropagation()
    setHowtoInitialTopic(howtoKey)
    setActiveAction({ key: 'howto', label: 'How To', mod: 'howto' })
  }

  function handleBack() {
    setActiveAction(null)
    setHowtoInitialTopic(null)
  }

  function renderAction() {
    if (!activeAction) return null
    if (activeAction.key === 'new_vin') {
      return <ScanNewVin onBack={handleBack} onRecord={handleRecord} />
    }
    if (activeAction.key === 'add_client') {
      return <AddClient onBack={handleBack} user={user} />
    }
    if (activeAction.key === 'add_staff') {
      return <AddStaffUser onBack={handleBack} />
    }
    if (activeAction.key === 'export') {
      return <ExportData onBack={handleBack} />
    }
    if (activeAction.key === 'howto') {
      return <HowTo onBack={handleBack} role={user.app_admin ? 'admin' : 'std'} initialTopic={howtoInitialTopic} />
    }
    return (
      <ScanCheckFlow
        action={activeAction}
        user={user}
        onBack={handleBack}
        recentScans={recentScans}
        onRecord={handleRecord}
      />
    )
  }

  return (
    <div className="scan-app">
      <header className="scan-header">
        <span className="scan-brand">Fleet Control</span>
        <div className="scan-header-user">
          <span className="scan-client">{user.firstname} {user.lastname}</span>
          <button className="scan-logout" onClick={onLogout}>Logout</button>
        </div>
      </header>

      <main className="scan-main">
        {activeAction ? renderAction() : (
          <div className="scan-home">
            <p className="scan-section-title">Tasks</p>
            {STD_ACTIONS.map(a => {
              const howtoKey = ACTION_HOWTO_KEY[a.key]
              return (
                <button
                  key={a.key}
                  className={`scan-action-btn scan-action-btn--${a.mod}`}
                  onClick={() => setActiveAction(a)}
                >
                  <span className="action-btn-label">{a.label}</span>
                  {howtoKey && (
                    <span
                      className="action-btn-info"
                      onClick={e => handleInfoTap(e, howtoKey)}
                      role="button"
                      aria-label={`How to use ${a.label}`}
                    >i</span>
                  )}
                </button>
              )
            })}

            {user.app_admin && (
              <>
                <p className="scan-section-title scan-section-title--admin">Admin</p>
                {ADMIN_ACTIONS.map(a => {
                  const howtoKey = ACTION_HOWTO_KEY[a.key]
                  return (
                    <button
                      key={a.key}
                      className={`scan-action-btn scan-action-btn--${a.mod}`}
                      onClick={() => setActiveAction(a)}
                    >
                      <span className="action-btn-label">{a.label}</span>
                      {howtoKey && (
                        <span
                          className="action-btn-info"
                          onClick={e => handleInfoTap(e, howtoKey)}
                          role="button"
                          aria-label={`How to use ${a.label}`}
                        >i</span>
                      )}
                    </button>
                  )
                })}
              </>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

// ── App root ─────────────────────────────────────────────────────────────────

function DesktopBlock() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: '#1a1c1e', color: '#fff', textAlign: 'center', padding: '2rem'
    }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>
        ClearPath<span style={{ color: '#6399d2' }}>-Ai</span>
      </h1>
      <p style={{ color: '#aaa', maxWidth: '320px', lineHeight: 1.6 }}>
        Fleet Control is designed for mobile devices only.<br />
        Please open this app on your smartphone.
      </p>
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState(null)

  if (window.innerWidth >= 768) {
    return <DesktopBlock />
  }

  if (!user) {
    return <Login onLogin={setUser} />
  }

  return <ScanScreen user={user} onLogout={() => setUser(null)} />
}
