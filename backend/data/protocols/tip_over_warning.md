---
id: PRT-TIPOVER
title: Low tip-over margin
applies_to_events: [tip_over_warning]
severity: critical
roles: [operator, supervisor]
steps:
  - "Stop slewing and bring the load in close to the machine."
  - "Lower the load to the ground slowly; do not swing it over the side on the slope."
  - "Move the machine to level ground before lifting again."
  - "Reduce the load or reposition so the margin gauge stays green before continuing."
escalation:
  - "Red margin (below 1.2): supervisor reviews the lift plan before work continues."
source: "Demo site SOP (CAT Copilot hackathon)"
regulation:
  citation: "29 CFR 1926.602(a)(6)"
  quote: "Rollover protective structures (ROPS). See subpart W of this part for requirements for rollover protective structures and overhead protection."
---
