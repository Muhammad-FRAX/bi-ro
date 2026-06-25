import { ThemeProvider } from './components/ThemeProvider.tsx'
import { AppShell } from './components/AppShell.tsx'
import { Button } from './components/ui/Button.tsx'
import { Input } from './components/ui/Input.tsx'
import { Card } from './components/ui/Card.tsx'

export default function App() {
  return (
    <ThemeProvider>
      <AppShell>
        <div style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h1
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: 'var(--text)',
              margin: 0,
              letterSpacing: '-0.01em',
            }}
          >
            Dashboard
          </h1>

          <Card title="Controls (C0.4 Gate)">
            <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-muted)' }}>
              Button sizes and intents — default height 30px.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <Button intent="primary">Primary</Button>
              <Button intent="secondary">Secondary</Button>
              <Button intent="danger">Danger</Button>
              <Button intent="ghost">Ghost</Button>
            </div>
            <div
              style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}
            >
              <Button size="sm" intent="secondary">Small (26px)</Button>
              <Button size="md" intent="secondary">Medium (30px)</Button>
              <Button size="lg" intent="secondary">Large (34px)</Button>
              <Button disabled>Disabled</Button>
            </div>
          </Card>

          <Card title="Input">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Input label="Server hostname" placeholder="e.g. etl-01" />
              <Input label="Port" placeholder="5432" type="number" />
            </div>
          </Card>

          <Card title="System">
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
              Use the theme toggle in the top-right corner to switch between dark and light
              mode.
            </p>
          </Card>
        </div>
      </AppShell>
    </ThemeProvider>
  )
}
