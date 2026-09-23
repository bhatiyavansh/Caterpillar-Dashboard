---
id: PRT-HYD-OVERHEAT
title: Hydraulic oil over-temperature (HYD-118)
applies_to_events: [maintenance_due]
match:
  component: hydraulic_pump
severity: medium
roles: [operator, technician]
steps:
  - "Reduce continuous high-load work."
  - "Let the machine idle so the hydraulic oil can cool below 90 °C."
  - "At the next safe stop, check the hydraulic oil level and the cooler for blockage."
  - "Raise a work order if HYD-118 returns during the same shift."
escalation:
  - "Temperature keeps rising at idle: shut down and call a technician."
source: "Demo site SOP (CAT Copilot hackathon); thresholds from the demo site manual page 2"
---
