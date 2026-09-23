---
id: PRT-PROXIMITY
title: Person inside the machine safety zone
applies_to_events: [proximity_alert]
severity: critical
roles: [operator, ground crew, supervisor]
steps:
  - "Stop all travel and implement movement immediately."
  - "Sound the horn and make eye contact with the person before doing anything else."
  - "Wait until the person has moved outside the red safety zone and the bubble shows green."
  - "If the person was behind the machine, use a spotter before reversing."
escalation:
  - "Person closer than 3 m: supervisor is notified and the event is reviewed as a near miss."
  - "Second proximity alert with the same machine in one shift: stop work in that area until the supervisor re-briefs the crew."
source: "Demo site SOP (CAT Copilot hackathon)"
regulation:
  citation: "29 CFR 1926.651(e)"
  quote: "No employee shall be permitted underneath loads handled by lifting or digging equipment."
---
