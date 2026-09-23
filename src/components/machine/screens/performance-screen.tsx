"use client";

import { TrendAreaChart, CHART_COLORS } from "@/components/charts/charts";
import { BarGauge, SensorGauge } from "@/components/gauges/sensor-gauge";
import { formatNumber } from "@/lib/utils";
import { lowReadingStatus, readingStatus, useMachineStore } from "@/store/machine-store";
import { useSensorHistory } from "@/store/use-sensor-history";
import { ScreenPad, SectionTitle } from "../touch";

export function PerformanceScreen() {
  const s = useMachineStore((st) => st.sensors);
  const history = useSensorHistory(40);

  return (
    <ScreenPad className="space-y-5">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <div className="flex justify-center rounded border border-white/10 bg-ink-900 p-3">
          <SensorGauge label="Engine speed" value={s.rpm} min={0} max={2400} unit="RPM" redlineFrom={2200} status={readingStatus(s.rpm, 2200, 2350)} />
        </div>
        <div className="flex justify-center rounded border border-white/10 bg-ink-900 p-3">
          <SensorGauge label="Engine temp" value={s.engineTemperature} min={40} max={120} unit="°C" redlineFrom={104} status={readingStatus(s.engineTemperature, 92, 104)} />
        </div>
        <div className="flex justify-center rounded border border-white/10 bg-ink-900 p-3">
          <SensorGauge label="Fuel" value={s.fuelLevel} min={0} max={100} unit="%" status={lowReadingStatus(s.fuelLevel, 20, 10)} />
        </div>
        <div className="flex justify-center rounded border border-white/10 bg-ink-900 p-3">
          <SensorGauge label="Hydraulic pressure" value={s.hydraulicPressure} min={0} max={4000} unit="PSI" redlineFrom={3650} status={readingStatus(s.hydraulicPressure, 3400, 3650)} />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded border border-white/10 bg-ink-900 p-4">
          <SectionTitle right={<span className="text-xs text-muted">Live · last 40 samples</span>}>
            Engine temperature
          </SectionTitle>
          <TrendAreaChart data={history} dataKey="temp" xKey="t" color={CHART_COLORS.warn} unit="°" height={180} />
        </section>
        <section className="rounded border border-white/10 bg-ink-900 p-4">
          <SectionTitle right={<span className="text-xs text-muted">Live · last 40 samples</span>}>
            Hydraulic pressure
          </SectionTitle>
          <TrendAreaChart data={history} dataKey="psi" xKey="t" color={CHART_COLORS.info} height={180} />
        </section>
      </div>

      <section className="rounded border border-white/10 bg-ink-900 p-4">
        <SectionTitle>Load and consumption</SectionTitle>
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <BarGauge label="Engine load" value={s.engineLoad} max={100} unit="%" status={readingStatus(s.engineLoad, 85, 95)} />
          <BarGauge label="Ground speed" value={s.machineSpeed} max={12} unit="km/h" />
          <BarGauge label="DEF level" value={s.defLevel} max={100} unit="%" status={lowReadingStatus(s.defLevel, 20, 10)} />
          <BarGauge label="Battery" value={s.battery} max={100} unit="%" status={lowReadingStatus(s.battery, 40, 20)} />
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { k: "Operating hours", v: `${formatNumber(s.operatingHours)} h` },
            { k: "Fuel remaining", v: `${s.fuelLitres.toFixed(0)} L` },
            { k: "Fuel rate", v: "26.4 L/h" },
            { k: "Oil pressure", v: `${s.oilPressure.toFixed(0)} PSI` },
          ].map((row) => (
            <div key={row.k} className="rounded border border-white/10 bg-ink-850 p-3">
              <dt className="label-xs">{row.k}</dt>
              <dd className="font-mono text-2xl font-bold text-zinc-50">{row.v}</dd>
            </div>
          ))}
        </dl>
      </section>
    </ScreenPad>
  );
}
