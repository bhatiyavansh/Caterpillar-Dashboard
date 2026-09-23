---
doc_id: demo_site_manual
title: "Demo site manual: CAT Copilot alerts and fault codes"
citation: "Demo site manual (CAT Copilot hackathon)"
source: "Demo site SOP written by the CAT Copilot team from the simulator's own rules (simulator/safety.py, simulator/machine.py, simulator/physics.py). Not a Caterpillar publication."
license: "Team-authored demo document"
retrieved: "2026-09-23"
---
<!-- page 1 -->
# How to use this manual
This manual explains the alerts and fault codes shown on the CAT Copilot cab display at the demo site. Every threshold in it is the value the site simulator actually uses. Safety alerts are raised by fixed rules on the machine, never by the assistant.

<!-- page 2 -->
# Fault code HYD-118: hydraulic oil over-temperature
HYD-118 is set when the hydraulic oil temperature reaches 95 °C or more. It clears when the temperature falls below 90 °C. While HYD-118 is active the site raises a maintenance_due alert for the hydraulic system.
What to do when HYD-118 is active: reduce continuous high-load work, let the machine idle so the oil can cool, check the hydraulic oil level and the cooler for blockage at the next safe stop, and raise a work order if the code returns during the same shift.

<!-- page 3 -->
# Seatbelt escalation
When the seatbelt is unfastened while the engine is on, the cab escalates in three steps: level 1 immediately (warning chime), level 2 after 5 seconds (voice warning), level 3 after 10 seconds (travel locked message). Fastening the seatbelt clears the alert and records a seatbelt_fastened event.

<!-- page 4 -->
# Tip-over margin gauge
The tip-over margin is the ratio of the restoring moment to the overturning moment. Green means a margin above 1.5, amber means 1.2 to 1.5, and red means below 1.2. A red margin raises a critical tip_over_warning; amber raises a medium warning. Heavy loads carried low and far out over the side on a slope reduce the margin the most.

<!-- page 5 -->
# Safety bubble around the machine
The safety bubble is green, amber or red. The red radius is 5 m plus 1.5 m for every metre per second of travel speed, plus the swing radius while an excavator is slewing. A person inside the red radius raises a proximity_alert: critical below 3 m, otherwise high. The amber radius is 10 m plus 2 m per metre per second, plus the swing radius.

<!-- page 6 -->
# Machine-to-machine (V2V) collision warning
Each machine's path is projected in a straight line for 5 seconds in half-second steps. When two machines' projected safety envelopes overlap and they are closing by at least 1 m, a v2v_collision_risk alert is raised for the pair, with both predicted paths. Warnings near the loader, dump, stockpile and fuel bay are suppressed because traffic there is controlled by the site plan.

<!-- page 7 -->
# Operator fatigue
The fatigue score runs from 0 to 1. A score of 0.75 or higher raises a fatigue_alert. The webcam fatigue detector raises the same alert when both eyes stay closed for 2 seconds or more.
