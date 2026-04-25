import { useState, useRef } from 'react'
import supabase from './supabase'

const GB_SCAN_WEBHOOK    = 'https://n8n.tekguy.au/webhook/gb-vin-scan'
const GB_CHECKIN_WEBHOOK = '' // TODO: n8n webhook for check in/out

const SCAN_ACTIONS = [
  { key: 'new_vin',    label: 'Scan New VIN',  mod: 'vin'    },
  { key: 'check_in',  label: 'Check In Car',   mod: 'in'     },
  { key: 'check_out', label: 'Check Out Car',  mod: 'out'    },
  { key: 'add_client', label: 'Add Client',    mod: 'client' },
]

// ── Login ────────────────────────────────────────────────────────────────────

function Login({ onLogin }) {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')

  async function handleLogin(e) {
    e.preventDefault()
    setError('')

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (authError || !authData.user) {
      setError('Invalid email or password.')
      return
    }

    const { data: profile } = await supabase
      .from('gb_user_roles')
      .select('role')
      .eq('user_id', authData.user.id)
      .single()

    if (!profile || profile.role !== 'scan') {
      await supabase.auth.signOut()
      setError('Access denied.')
      return
    }

    onLogin({ email: authData.user.email, clientName: 'Glen Barry Panels' })
  }

  return (
    <div className="login-container">
      <div className="login-brand">
        <h1 className="login-heading">ClearPath<span className="login-accent">-Ai</span></h1>
        <p className="login-tagline">Glen Barry Panels</p>
        <p className="login-app-name">Fleet Management</p>
      </div>

      <form className="login-box" onSubmit={handleLogin}>
        <input
          className="login-input"
          type="email"
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          autoFocus
        />
        <input
          className="login-input"
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
        />
        {error && <p className="login-error">{error}</p>}
        <button className="login-btn" type="submit">Login</button>
      </form>

      <div className="login-footer">
        <p className="login-powered">Online Systems &copy;2026</p>
        <p className="login-powered">Powered by ClearPath-Ai</p>
      </div>
    </div>
  )
}

// ── Scan New VIN flow ────────────────────────────────────────────────────────

function ScanNewVin({ onBack, onRecord }) {
  const [phase, setPhase]         = useState('photo') // 'photo' | 'rego' | 'saving' | 'done'
  const [imageData, setImageData] = useState(null)
  const [rego, setRego]           = useState('')
  const [error, setError]         = useState('')
  const fileRef                   = useRef(null)

  function handlePhotoTaken(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      setImageData(ev.target.result)
      setPhase('rego')
    }
    reader.readAsDataURL(file)
  }

  async function handleSubmit() {
    if (!rego.trim()) return
    setPhase('saving')

    const payload = {
      action: 'new_vin',
      rego: rego.trim().toUpperCase(),
      image: imageData,
      timestamp: new Date().toISOString(),
      client: 'Glenbarry Panels',
    }

    try {
      if (GB_SCAN_WEBHOOK) {
        await fetch(GB_SCAN_WEBHOOK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      }
      onRecord({ action: 'new_vin', value: rego.trim().toUpperCase(), id: Date.now(), timestamp: payload.timestamp })
      setPhase('done')
    } catch {
      setError('Failed to send — check connection and try again.')
      setPhase('rego')
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

        {error && <p className="scan-feedback scan-feedback--error">{error}</p>}
        {!GB_SCAN_WEBHOOK && <p className="scan-feedback scan-feedback--warn">n8n webhook not yet configured</p>}

        <button
          className="scan-submit scan-submit--vin"
          onClick={handleSubmit}
          disabled={!rego.trim()}
        >
          Save Vehicle
        </button>
      </div>
    )
  }

  return (
    <div className="scan-action">
      <button className="scan-back" onClick={onBack}>← Back</button>
      <h2 className="scan-action-title">Scan New VIN</h2>
      <p className="vin-instruction">Point your camera at the VIN plate and take a photo.</p>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handlePhotoTaken}
      />
      <button className="scan-submit scan-submit--vin" onClick={() => fileRef.current.click()}>
        Open Camera
      </button>
    </div>
  )
}

// ── Check In / Check Out flow ────────────────────────────────────────────────

function ScanCheckFlow({ action, onBack, recentScans, onRecord }) {
  const [value, setValue]   = useState('')
  const [status, setStatus] = useState(null)

  async function handleSubmit() {
    if (!value.trim()) return
    setStatus('sending')
    const payload = {
      action: action.key,
      rego: value.trim().toUpperCase(),
      timestamp: new Date().toISOString(),
      client: 'Glenbarry Panels',
    }
    try {
      if (GB_CHECKIN_WEBHOOK) {
        await fetch(GB_CHECKIN_WEBHOOK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      }
      onRecord({ action: action.key, value: payload.rego, id: Date.now(), timestamp: payload.timestamp })
      setStatus('ok')
      setValue('')
      setTimeout(() => setStatus(null), 2000)
    } catch {
      setStatus('error')
      setTimeout(() => setStatus(null), 3000)
    }
  }

  return (
    <div className="scan-action">
      <button className="scan-back" onClick={onBack}>← Back</button>
      <h2 className="scan-action-title">{action.label}</h2>

      <p className="scan-label">Registration Plate</p>
      <input
        className="scan-input"
        type="text"
        placeholder="e.g. ABC123"
        value={value}
        onChange={e => setValue(e.target.value.toUpperCase())}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        autoFocus
      />

      {status === 'ok'      && <p className="scan-feedback scan-feedback--ok">Recorded</p>}
      {status === 'error'   && <p className="scan-feedback scan-feedback--error">Failed — try again</p>}
      {status === 'sending' && <p className="scan-feedback">Sending...</p>}
      {!status && !GB_CHECKIN_WEBHOOK && <p className="scan-feedback scan-feedback--warn">n8n webhook not yet configured</p>}

      <button
        className={`scan-submit scan-submit--${action.mod}`}
        onClick={handleSubmit}
        disabled={!value.trim() || status === 'sending'}
      >
        Confirm
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

const CLIENT_FIELDS = [
  { name: 'first_name',      label: 'First Name',          type: 'text',     cap: 'words'      },
  { name: 'last_name',       label: 'Last Name',           type: 'text',     cap: 'words'      },
  { name: 'date_of_birth',   label: 'Date of Birth',       type: 'date',     cap: 'none'       },
  { name: 'address',         label: 'Address',             type: 'text',     cap: 'sentences'  },
  { name: 'licence_number',  label: 'Licence Number',      type: 'text',     cap: 'characters' },
]

function AddClient({ onBack }) {
  const [phase, setPhase]           = useState('form') // 'form' | 'front' | 'back' | 'saving' | 'done'
  const [form, setForm]             = useState({ first_name: '', last_name: '', date_of_birth: '', address: '', licence_number: '' })
  const [frontFile, setFrontFile]   = useState(null)
  const [backFile, setBackFile]     = useState(null)
  const [frontPreview, setFrontPreview] = useState(null)
  const [backPreview, setBackPreview]   = useState(null)
  const [error, setError]           = useState('')
  const frontRef                    = useRef(null)
  const backRef                     = useRef(null)

  function handleChange(e) {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: name === 'licence_number' ? value.toUpperCase() : value }))
  }

  function handleFrontTaken(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setFrontFile(file)
    const reader = new FileReader()
    reader.onload = ev => setFrontPreview(ev.target.result)
    reader.readAsDataURL(file)
  }

  function handleBackTaken(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setBackFile(file)
    const reader = new FileReader()
    reader.onload = ev => setBackPreview(ev.target.result)
    reader.readAsDataURL(file)
  }

  async function handleSave() {
    setError('')
    setPhase('saving')

    const licNo = form.licence_number.trim().toUpperCase()

    try {
      let frontPath = null
      let backPath  = null

      if (frontFile) {
        const { error: upErr } = await supabase.storage
          .from('licence-images')
          .upload(`${licNo}/front.jpg`, frontFile, { upsert: true })
        if (upErr) throw upErr
        frontPath = `${licNo}/front.jpg`
      }

      if (backFile) {
        const { error: upErr } = await supabase.storage
          .from('licence-images')
          .upload(`${licNo}/back.jpg`, backFile, { upsert: true })
        if (upErr) throw upErr
        backPath = `${licNo}/back.jpg`
      }

      const { error: dbErr } = await supabase
        .from('gb_rental_clients')
        .insert({
          first_name:        form.first_name.trim(),
          last_name:         form.last_name.trim(),
          date_of_birth:     form.date_of_birth || null,
          address:           form.address.trim(),
          licence_number:    licNo,
          licence_front_url: frontPath,
          licence_back_url:  backPath,
        })

      if (dbErr) throw dbErr
      setPhase('done')
    } catch (err) {
      setError(err.message || 'Failed to save — try again.')
      setPhase('back')
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

  if (phase === 'form') {
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

  if (phase === 'front') {
    return (
      <div className="scan-action">
        <button className="scan-back" onClick={() => setPhase('form')}>← Back</button>
        <h2 className="scan-action-title">Licence — Front</h2>
        <p className="vin-instruction">Take a photo of the front of the licence.</p>

        {frontPreview && <img src={frontPreview} alt="Licence front" className="vin-preview" />}

        <input
          ref={frontRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={handleFrontTaken}
        />
        <button className="scan-submit scan-submit--vin" onClick={() => frontRef.current.click()}>
          {frontPreview ? 'Retake' : 'Open Camera'}
        </button>

        {frontPreview && (
          <button className="scan-submit scan-submit--client" onClick={() => setPhase('back')}>
            Next — Back of Licence
          </button>
        )}
      </div>
    )
  }

  // phase === 'back'
  return (
    <div className="scan-action">
      <button className="scan-back" onClick={() => setPhase('front')}>← Back</button>
      <h2 className="scan-action-title">Licence — Back</h2>
      <p className="vin-instruction">Take a photo of the back of the licence.</p>

      {backPreview && <img src={backPreview} alt="Licence back" className="vin-preview" />}

      <input
        ref={backRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleBackTaken}
      />
      <button className="scan-submit scan-submit--vin" onClick={() => backRef.current.click()}>
        {backPreview ? 'Retake' : 'Open Camera'}
      </button>

      {error && <p className="scan-feedback scan-feedback--error">{error}</p>}

      <button
        className="scan-submit scan-submit--client"
        onClick={handleSave}
        disabled={!backPreview}
      >
        Save Client
      </button>
    </div>
  )
}

// ── Scan screen ──────────────────────────────────────────────────────────────

function ScanScreen({ user, onLogout }) {
  const [activeAction, setActiveAction] = useState(null)
  const [recentScans, setRecentScans]   = useState([])

  function handleRecord(entry) {
    setRecentScans(prev => [entry, ...prev].slice(0, 30))
  }

  function renderAction() {
    if (!activeAction) return null
    if (activeAction.key === 'new_vin') {
      return <ScanNewVin onBack={() => setActiveAction(null)} onRecord={handleRecord} />
    }
    if (activeAction.key === 'add_client') {
      return <AddClient onBack={() => setActiveAction(null)} />
    }
    return (
      <ScanCheckFlow
        action={activeAction}
        onBack={() => setActiveAction(null)}
        recentScans={recentScans}
        onRecord={handleRecord}
      />
    )
  }

  return (
    <div className="scan-app">
      <header className="scan-header">
        <span className="scan-brand">Glen Barry Panels</span>
        <span className="scan-client">{user.email}</span>
        <button className="scan-logout" onClick={onLogout}>Logout</button>
      </header>

      <main className="scan-main">
        {activeAction ? renderAction() : (
          <div className="scan-home">
            {SCAN_ACTIONS.map(a => (
              <button
                key={a.key}
                className={`scan-action-btn scan-action-btn--${a.mod}`}
                onClick={() => setActiveAction(a)}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

// ── App root ─────────────────────────────────────────────────────────────────

export default function App() {
  const [user, setUser] = useState(null)

  if (!user) {
    return <Login onLogin={setUser} />
  }

  return <ScanScreen user={user} onLogout={() => setUser(null)} />
}
