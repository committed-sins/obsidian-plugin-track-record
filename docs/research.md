# Existing plugins and naming research

Checked 2026-11-18 using the Obsidian community registry, repository documentation and targeted web/GitHub repository searches. No live plugin tests were performed. Search results are not proof that no unlisted plugin or trademark exists.

## Name

Confirmed: **Track Record**. Subtitle: **Time tracking & status history for your notes.** Provisional ID: `track-record`. No exact name or ID match was found in the [community registry](https://github.com/obsidianmd/obsidian-releases/blob/master/community-plugins.json); the targeted `obsidian track-record` GitHub repository search returned no results before this repository was created.

Earlier candidates Chronicle and Tracker are already used by [Chronicle](https://github.com/cubiclewar/obsidian-chronicle) and [Tracker](https://github.com/pyrochlore/obsidian-tracker). Chronicle catalogs media; Tracker collects and visualizes note data.

## Related functionality

| Plugin | Documented capabilities | Difference from this proposal |
| --- | --- | --- |
| [Sheiko Task Lifecycle](https://github.com/Ashura-Sheikh/Sheiko-obsidian-plugin) | TaskNotes lifecycle, status history and time per status; desktop only at the time of review. | Depends on TaskNotes. Writes history into task-note sections rather than independent linked time/status records. Closest functional overlap. |
| [Status Date Tracker](https://github.com/whiletruegeek/status-date-tracker) | Writes a date property named after the destination status; supports preserving the first date. | A compact set of status dates does not retain each repeated visit as an independent transition event. |
| [Automatic Time Tracker](https://github.com/kluesn/automatic-time-tracker) | Per-document work tracking, project grouping, manual entries and overview note; desktop only at review. | Source tracking data is in plugin `data.json`; no documented linked status-record model. |
| [Star Tracker](https://github.com/divyaraj-m/star-tracker) | Bases boards, sprints, status history and activity timeline. | Uses task `status_log` and JSONL activity journals; different storage/workflow focus. |
| [TaskNotes](https://github.com/callumalpass/tasknotes) | Note-based task management with calendar and time tracking. | Broader task-management workflow; Track Record is intended to work independently on notes. |

The reviewed documentation did not establish a direct replacement for independently linked Markdown records covering both work intervals and note status transitions. That is a scoped documentation finding, not an exhaustive ecosystem audit.
