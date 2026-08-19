[Manual](README.md) › Quests

# Quests

A quest module is a pure `decide(QuestSnapshot) → QuestStep`; the engine owns
provisioning, the queue, the watchdog and execution.

## Pages

| Page | Covers |
|---|---|
| [Module shape](reference/quest-module-shape.md) | what a quest def looks like |
| [Quest engine](reference/quest-engine.md) | quest state, provisioning, the queue and watchdog |
| [Exec primitives](reference/quest-primitives.md) | the shared step executors |
| [Eligibility](reference/quest-eligibility.md) | requirement gating, official reqs vs bot-proven floors |
| [Why quest state is not read from varps](decisions/quest-state-not-varps.md) | what the client cannot see, and what to read instead |
| [Add a quest](how-to/add-a-quest.md) | the six steps, and which def to start from |
| Quest pitfalls: [the map](decisions/quest-pitfalls.md), [engine behaviour](decisions/quest-pitfalls-engine.md), [habits](decisions/quest-pitfalls-habits.md), [per-quest](decisions/quest-pitfalls-2.md), [later quests](decisions/quest-pitfalls-3.md), [Fight Arena](decisions/quest-pitfalls-4.md), [Clock Tower](decisions/quest-pitfalls-5.md), [Nature Spirit](decisions/quest-pitfalls-6.md), [Shield of Arrav](decisions/quest-pitfalls-7.md), [Sea Slug](decisions/quest-pitfalls-8.md), [Murder Mystery](decisions/quest-pitfalls-9.md), [Monk's Friend](decisions/quest-pitfalls-10.md), [Tribal Totem](decisions/quest-pitfalls-11.md), [Hazeel Cult](decisions/quest-pitfalls-12.md), [Fishing Contest](decisions/quest-pitfalls-13.md), [Tai Bwo Wannai Trio](decisions/quest-pitfalls-14.md), [Biohazard](decisions/quest-pitfalls-15.md), [Holy Grail](decisions/quest-pitfalls-16.md), [Tree Gnome Village](decisions/quest-pitfalls-17.md), [Shades of Mort'ton](decisions/quest-pitfalls-18.md), [Gertrude's Cat](decisions/quest-pitfalls-19.md), [The Grand Tree](decisions/quest-pitfalls-20.md), [Scorpion Catcher](decisions/quest-pitfalls-21.md), [Eadgar's Ruse](decisions/quest-pitfalls-22.md), [Sheep Herder](decisions/quest-pitfalls-23.md), [Temple of Ikov](decisions/quest-pitfalls-24.md), [Temple of Ikov: the route](decisions/quest-pitfalls-25.md), [Temple of Ikov: the fights](decisions/quest-pitfalls-26.md), [Observatory Quest](decisions/quest-pitfalls-27.md), [The Dig Site](decisions/quest-pitfalls-28.md), [Underground Pass: the map](decisions/quest-pitfalls-29.md), [Underground Pass: reach](decisions/quest-pitfalls-30.md), [Underground Pass: the live legs](decisions/quest-pitfalls-31.md), [Big Chompy Bird Hunting](decisions/quest-pitfalls-32.md), [The Fremennik Trials](decisions/quest-pitfalls-33.md), [Regicide](decisions/quest-pitfalls-34.md), [Hero's Quest](decisions/quest-pitfalls-35.md) | the lessons each quest paid for in live runs |
