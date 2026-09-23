"use client";

import * as React from "react";
import {
  Bell,
  Gauge,
  Globe,
  Languages,
  Monitor,
  Radio,
  Ruler,
  Shield,
  UserCog,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/navigation/dashboard-shell";
import { Button, Select } from "@/components/ui/primitives";
import { Switch } from "@/components/ui/overlays";
import { DEVICE_SIZES, type DeviceSizeKey, useMachineStore } from "@/store/machine-store";

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel-raised p-4">
      <div className="flex items-start gap-3">
        <span className="rounded bg-cat-500/12 p-2 text-cat-500">
          <Icon className="size-5" aria-hidden />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
          <p className="text-xs text-muted">{description}</p>
        </div>
      </div>
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

function Row({ label, hint, control }: { label: string; hint?: string; control: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded border border-white/8 bg-ink-850 px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm text-zinc-200">{label}</p>
        {hint ? <p className="text-[11px] text-muted">{hint}</p> : null}
      </div>
      {control}
    </div>
  );
}

export default function SettingsPage() {
  const deviceSize = useMachineStore((s) => s.deviceSize);
  const setDeviceSize = useMachineStore((s) => s.setDeviceSize);
  const [toggles, setToggles] = React.useState({
    highContrast: true,
    criticalPush: true,
    quietHours: false,
    proximity: true,
    seatbelt: true,
    autoInspection: true,
    voice: true,
    offlineCache: true,
  });

  const toggle = (key: keyof typeof toggles) => (v: boolean) => setToggles((t) => ({ ...t, [key]: v }));

  return (
    <div className="pb-10">
      <PageHeader
        title="Settings"
        subtitle="Display, safety, operator and connectivity configuration for the fleet."
        actions={<Button variant="primary" onClick={() => toast.success("Settings saved to all connected displays")}>Save changes</Button>}
      />

      <div className="grid gap-4 p-6 xl:grid-cols-2">
        <Section icon={Monitor} title="Display" description="How the in-cab screen renders in the field.">
          <Row
            label="Default machine screen size"
            hint="Used by the simulator and newly provisioned displays"
            control={
              <Select
                value={deviceSize}
                onChange={(e) => setDeviceSize(e.target.value as DeviceSizeKey)}
                aria-label="Default machine screen size"
              >
                {(Object.keys(DEVICE_SIZES) as DeviceSizeKey[]).map((k) => (
                  <option key={k} value={k}>
                    {DEVICE_SIZES[k].label}
                  </option>
                ))}
              </Select>
            }
          />
          <Row
            label="High contrast mode"
            hint="Boosts contrast for direct sunlight"
            control={<Switch checked={toggles.highContrast} onCheckedChange={toggle("highContrast")} />}
          />
          <Row
            label="Theme"
            control={
              <Select defaultValue="dark" aria-label="Theme">
                <option value="dark">Dark (default)</option>
                <option value="night">Night shift</option>
              </Select>
            }
          />
        </Section>

        <Section icon={Bell} title="Notifications" description="What reaches the operator and the supervisor.">
          <Row
            label="Critical alerts push to cab"
            control={<Switch checked={toggles.criticalPush} onCheckedChange={toggle("criticalPush")} />}
          />
          <Row
            label="Quiet hours"
            hint="Suppress informational messages 22:00 – 05:00"
            control={<Switch checked={toggles.quietHours} onCheckedChange={toggle("quietHours")} />}
          />
          <Row
            label="Digest frequency"
            control={
              <Select defaultValue="shift" aria-label="Digest frequency">
                <option value="shift">End of shift</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </Select>
            }
          />
        </Section>

        <Section icon={Gauge} title="Machine configuration" description="Thresholds applied to CAT 320 telemetry.">
          <Row
            label="Hydraulic temperature warning"
            control={
              <Select defaultValue="90" aria-label="Hydraulic temperature warning threshold">
                <option value="85">85 °C</option>
                <option value="90">90 °C</option>
                <option value="95">95 °C</option>
              </Select>
            }
          />
          <Row
            label="Low fuel warning"
            control={
              <Select defaultValue="20" aria-label="Low fuel warning threshold">
                <option value="15">15 %</option>
                <option value="20">20 %</option>
                <option value="25">25 %</option>
              </Select>
            }
          />
          <Row
            label="Service interval"
            control={
              <Select defaultValue="500" aria-label="Service interval">
                <option value="250">250 hours</option>
                <option value="500">500 hours</option>
                <option value="1000">1000 hours</option>
              </Select>
            }
          />
        </Section>

        <Section icon={Shield} title="Safety" description="Interlocks and detection behaviour.">
          <Row
            label="Proximity detection"
            hint="Warns when a person enters the 5 m zone"
            control={<Switch checked={toggles.proximity} onCheckedChange={toggle("proximity")} />}
          />
          <Row
            label="Seatbelt interlock"
            control={<Switch checked={toggles.seatbelt} onCheckedChange={toggle("seatbelt")} />}
          />
          <Row
            label="Block operation without daily inspection"
            control={<Switch checked={toggles.autoInspection} onCheckedChange={toggle("autoInspection")} />}
          />
        </Section>

        <Section icon={UserCog} title="Operator preferences" description="Defaults applied when an operator signs in.">
          <Row
            label="Voice assistant"
            control={<Switch checked={toggles.voice} onCheckedChange={toggle("voice")} />}
          />
          <Row
            label="Home screen"
            control={
              <Select defaultValue="overview" aria-label="Operator home screen">
                <option value="overview">Machine overview</option>
                <option value="assistant">Machine Assistant</option>
                <option value="camera">Camera</option>
              </Select>
            }
          />
          <Row
            label="Seat profile"
            control={
              <Select defaultValue="2" aria-label="Seat profile">
                <option value="1">Profile 1</option>
                <option value="2">Profile 2</option>
                <option value="3">Profile 3</option>
              </Select>
            }
          />
        </Section>

        <Section icon={Ruler} title="Units" description="Measurement system used across both applications.">
          <Row
            label="Temperature"
            control={
              <Select defaultValue="c" aria-label="Temperature units">
                <option value="c">Celsius</option>
                <option value="f">Fahrenheit</option>
              </Select>
            }
          />
          <Row
            label="Pressure"
            control={
              <Select defaultValue="psi" aria-label="Pressure units">
                <option value="psi">PSI</option>
                <option value="bar">bar</option>
              </Select>
            }
          />
          <Row
            label="Distance"
            control={
              <Select defaultValue="metric" aria-label="Distance units">
                <option value="metric">Metric</option>
                <option value="imperial">Imperial</option>
              </Select>
            }
          />
        </Section>

        <Section icon={Languages} title="Language" description="Display language for the in-cab application.">
          <Row
            label="Interface language"
            control={
              <Select defaultValue="en" aria-label="Interface language">
                <option value="en">English (UK)</option>
                <option value="es">Español</option>
                <option value="pt">Português</option>
                <option value="hi">हिन्दी</option>
              </Select>
            }
          />
          <Row
            label="Voice prompts"
            control={
              <Select defaultValue="en" aria-label="Voice prompt language">
                <option value="en">English (UK)</option>
                <option value="es">Español</option>
              </Select>
            }
          />
        </Section>

        <Section icon={Radio} title="Connectivity" description="How the machine reports back to the site network.">
          <Row
            label="Telemetry interval"
            control={
              <Select defaultValue="1" aria-label="Telemetry interval">
                <option value="1">1 second</option>
                <option value="5">5 seconds</option>
                <option value="30">30 seconds</option>
              </Select>
            }
          />
          <Row
            label="Cache telemetry when offline"
            hint="Uploads once the machine re-enters coverage"
            control={<Switch checked={toggles.offlineCache} onCheckedChange={toggle("offlineCache")} />}
          />
          <Row
            label="Network"
            control={
              <span className="inline-flex items-center gap-2 text-sm text-status-ok">
                <Globe className="size-4" aria-hidden /> LTE · 24 machines online
              </span>
            }
          />
        </Section>
      </div>
    </div>
  );
}
