---
name: wolvenkit-q003-inspector
description: Use when reading the q003 metadata report from WolvenKit, tracing its scene exits, or editing local WolvenKit WScript automation.
---

# WolvenKit Q003 Inspector workflow

This is a local Codex plugin for WolvenKit. It returns a compact metadata report for three q003 archive resources and offers guarded tools for `.wscript` source files. It does not run scripts or modify game resources.

## Produce and read the q003 report

1. Use `install_q003_report_script` to copy the bundled script into WolvenKit's WScript directory when the filename is absent. If the file already exists, read it first and preserve its current SHA-256. Use `update_q003_report_script` only when replacing that file with this plugin's bundled version is intended; it verifies the hash and saves a timestamped backup.
2. Ask the user to open `q003_wolvenkit_readonly_report.wscript` in WolvenKit's Script Manager and run it. Do not invoke UI automation or run the script without the user's explicit request.
3. Call `read_q003_report` to retrieve the latest `WOLVENKIT_Q003_REPORT_V1` record from WolvenKit's app log.
4. Explain unresolved handle references, missing resources, and scene exit sockets without a path to a fact write as unresolved. Do not infer a route solely from similarly named nodes.

The bundled WScript reads:

- `base\quest\main_quests\prologue\q003\q003.questphase`
- `base\quest\main_quests\prologue\q003\phases\q003_royce_deal.questphase`
- `base\quest\main_quests\prologue\q003\scenes\q003_03_deal.scene`

It uses only `wkit.GetFileFromArchive(..., OpenAs.Json)` and `Logger.Info`. It does not save, export, or package vanilla resources, or write to project Raw or Resources folders.

## Edit WScript automation

1. Call `get_script_directory` and `list_scripts` to locate the script.
2. Call `read_script` first and retain the returned SHA-256.
3. Make the smallest change that fulfills the user's request.
4. For new files, call `create_script`. For existing files, call `write_script` with the exact SHA-256 from `read_script`; a mismatch requires rereading and reconciling. Replacements save a timestamped backup.
5. Report the saved path and the backup path when a file was replaced.

The script tools only address top-level `.wscript` files in `%APPDATA%\REDModding\WolvenKit\WScript`. The server never executes scripts. Before preparing a script that saves or deletes project files, explain those effects. Avoid destructive calls such as `wkit.DeleteFile` unless the user explicitly requests deletion.

## Use WolvenKit APIs carefully

Read `references/wscript-api.md` before authoring code that uses WolvenKit APIs. Check the linked official API documentation for current names and argument shapes; do not guess. In particular, saving with `wkit.SaveToRaw`, `wkit.SaveToResources`, or `wkit.SaveToProject` changes project data.
